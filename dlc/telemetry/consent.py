"""
Research consent state (IRB), kept on the student's machine.

The course server declares a study (its /v1/health carries `study_id`);
only then does the tool ask for consent, and only an "agreed" decision lets
telemetry leave the machine. A declined decision stops local recording as
well and purges whatever was spooled but never shipped. A new version of
the consent text asks again.

Files (all under ~/.dlc unless an env var points elsewhere):
    consent.json   the decision: study id, text version, agreed/declined,
                   typed name, optional drawn signature, sync flag
    study.json     the last study declaration read from the course server
"""

from __future__ import annotations

import hashlib
import json
import os
import time
from pathlib import Path

_APP_ROOT = Path(__file__).resolve().parent.parent.parent
_STUDY_TTL = 600.0 # seconds before the study cache is refreshed


def state_path() -> Path:
    env = os.environ.get("DLC_CONSENT_PATH")
    return Path(env) if env else Path.home() / ".dlc" / "consent.json"


def study_cache_path() -> Path:
    env = os.environ.get("DLC_STUDY_CACHE")
    return Path(env) if env else Path.home() / ".dlc" / "study.json"


def consent_text_path() -> Path:
    env = os.environ.get("DLC_CONSENT_TEXT")
    return Path(env) if env else _APP_ROOT / "data" / "consent" / "COMP311_fa26.md"


def consent_text() -> str:
    try:
        return consent_text_path().read_text(encoding="utf-8")
    except OSError:
        return ""


def consent_version() -> str:
    text = consent_text().replace("\r\n", "\n").strip()
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:12] if text else "none"


def _read_json(p: Path) -> dict:
    try:
        d = json.loads(p.read_text(encoding="utf-8"))
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def _write_json(p: Path, d: dict) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(d, indent=2), encoding="utf-8")


def load_state() -> dict:
    return _read_json(state_path())


def decision() -> str | None:
    """'agreed' | 'declined' | None. The last decision stands until the
    student changes it, even if the sheet text moved on (that only re-asks)."""
    d = load_state().get("decision")
    return d if d in ("agreed", "declined") else None


# study

def _fetch_study() -> dict | None:
    """Ask the configured course server whether a study is on."""
    try:
        from dlc.llm.client import _proxy_config
        url, _tok = _proxy_config()
        if not url:
            return {"study_id": None, "survey_rate": 0.0, "source": "no_proxy"}
        import httpx
        r = httpx.get(f"{url}/v1/health", timeout=4.0)
        if r.status_code // 100 != 2:
            return None
        h = r.json()
        sid = h.get("study_id") or None
        try:
            rate = float(h.get("survey_rate") or 0.0)
        except (TypeError, ValueError):
            rate = 0.0
        return {"study_id": sid, "survey_rate": max(0.0, min(1.0, rate)),
                "source": "proxy"}
    except Exception:
        return None


def study_info(refresh: bool = False) -> dict:
    """The study declaration, cached for ten minutes. DLC_LOCAL_STUDY_ID on
    the student machine overrides it (developer use, no server needed)."""
    env = os.environ.get("DLC_LOCAL_STUDY_ID", "").strip()
    if env:
        try:
            rate = float(os.environ.get("DLC_LOCAL_SURVEY_RATE", "0.35"))
        except ValueError:
            rate = 0.35
        return {"study_id": env, "survey_rate": rate, "source": "env"}
    cache = _read_json(study_cache_path())
    fresh = cache and (time.time() - float(cache.get("checked_at") or 0)) < _STUDY_TTL
    if fresh and not refresh:
        return cache
    got = _fetch_study()
    if got is None:
        return cache or {"study_id": None, "survey_rate": 0.0,
                         "source": "unreachable"}
    got["checked_at"] = time.time()
    try:
        _write_json(study_cache_path(), got)
    except OSError:
        pass
    return got


def study_active(refresh: bool = False) -> bool:
    return bool(study_info(refresh).get("study_id"))


# gating

def telemetry_allowed() -> bool:
    return not (decision() == "declined" and study_active())


def shipping_allowed() -> bool:
    if not study_active():
        return True
    return decision() == "agreed"


def consent_required() -> bool:
    if not study_active():
        return False
    st = load_state()
    if st.get("decision") not in ("agreed", "declined"):
        return True
    return st.get("version") != consent_version()


# decision

def _purge_unshipped() -> int:
    try:
        from dlc.telemetry import sink
        if not sink.db_path().exists():
            return 0
        conn = sink._connect()
        try:
            conn.executescript(
                "CREATE TABLE IF NOT EXISTS ship_state (id INTEGER PRIMARY KEY"
                " CHECK (id = 1), last_shipped INTEGER NOT NULL DEFAULT 0);"
                "INSERT OR IGNORE INTO ship_state (id, last_shipped) VALUES (1, 0);")
            (mark,) = conn.execute(
                "SELECT last_shipped FROM ship_state WHERE id = 1").fetchone()
            with conn:
                cur = conn.execute("DELETE FROM events WHERE id > ?", (mark,))
                return cur.rowcount
        finally:
            conn.close()
    except Exception:
        return 0


def record(decision_value: str, name: str = "", signature: str | None = None) -> dict:
    if decision_value not in ("agreed", "declined"):
        raise ValueError("decision must be 'agreed' or 'declined'")
    name = (name or "").strip()[:120]
    if decision_value == "agreed" and len(name) < 2:
        raise ValueError("a typed name is required to agree")
    sig = signature if (isinstance(signature, str)
                        and signature.startswith("data:image/png;base64,")
                        and len(signature) < 400_000) else None
    info = study_info()
    st = {
        "study_id": info.get("study_id"),
        "version": consent_version(),
        "decision": decision_value,
        "name": name if decision_value == "agreed" else "",
        "signature": sig if decision_value == "agreed" else None,
        "decided_at": time.time(),
        "synced": False,
    }
    _write_json(state_path(), st)
    purged = _purge_unshipped() if decision_value == "declined" else 0
    synced = sync_pending().get("synced", False)
    return {"ok": True, "decision": decision_value, "version": st["version"],
            "purged": purged, "synced": synced}


def sync_pending(timeout: float = 6.0) -> dict:
    st = load_state()
    if not st or st.get("synced") or st.get("decision") not in ("agreed", "declined"):
        return {"synced": bool(st.get("synced")), "reason": "nothing"}
    try:
        from dlc.llm.client import _proxy_config
        from dlc.telemetry.machine import machine_identity
        from dlc.version import __version__
        url, token = _proxy_config()
        if not url:
            return {"synced": False, "reason": "no_proxy"}
        ident = machine_identity()
        import httpx
        r = httpx.post(f"{url}/v1/consent", json={
            "install_id": ident["install_id"],
            "study_id": st.get("study_id"),
            "version": st.get("version"),
            "decision": st.get("decision"),
            "name": st.get("name") or "",
            "signature": st.get("signature"),
            "app_version": __version__,
            "decided_at": st.get("decided_at"),
        }, headers={"X-DLC-Token": token or ""}, timeout=timeout)
        if r.status_code // 100 != 2:
            return {"synced": False, "reason": f"http_{r.status_code}"}
        st["synced"] = True
        _write_json(state_path(), st)
        return {"synced": True, "reason": "ok"}
    except Exception as exc:
        return {"synced": False, "reason": type(exc).__name__}


def public_state(refresh: bool = False) -> dict:
    info = study_info(refresh)
    st = load_state()
    return {
        "study_id": info.get("study_id"),
        "study_source": info.get("source"),
        "survey_rate": info.get("survey_rate", 0.0),
        "version": consent_version(),
        "required": consent_required(),
        "decision": st.get("decision") if st.get("decision") in ("agreed", "declined") else None,
        "decided_version": st.get("version"),
        "name": st.get("name") or "",
        "decided_at": st.get("decided_at"),
        "has_signature": bool(st.get("signature")),
        "synced": bool(st.get("synced")),
    }
