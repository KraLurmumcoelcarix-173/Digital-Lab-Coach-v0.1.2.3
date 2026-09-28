"""
Pull one JSON object out of a model reply.
"""

from __future__ import annotations

import json
import re

_FENCE = re.compile(r"```(?:json)?\s*(.*?)```", re.S)
_DANGLING_KEY = re.compile(r',?\s*"(?:[^"\\]|\\.)*"\s*:\s*$')
_DANGLING_COMMA = re.compile(r",\s*$")
_MAX_STARTS = 8


def extract_json_object(text) -> tuple[dict | None, str | None]:
    if not isinstance(text, str) or not text.strip():
        return None, "empty reply"
    candidates = [text]
    m = _FENCE.search(text)
    if m and m.group(1).strip():
        candidates.insert(0, m.group(1))
    reason = "no JSON object found"
    for cand in candidates:
        starts = [i for i, ch in enumerate(cand) if ch == "{"][:_MAX_STARTS]
        for start in starts:
            body = cand[start:]
            obj, why = _read(body)
            if obj is not None:
                return obj, None
            if why and reason == "no JSON object found":
                reason = why
    return None, reason


def _read(body: str) -> tuple[dict | None, str | None]:
    why = None
    try:
        obj, _end = json.JSONDecoder().raw_decode(body)
        if isinstance(obj, dict):
            return obj, None
        why = "the JSON value is not an object"
    except json.JSONDecodeError as exc:
        why = f"{exc.msg} at char {exc.pos}"
    end = body.rfind("}")
    if end > 0:
        obj = _loads_dict(body[:end + 1])
        if obj is not None:
            return obj, None
    repaired = close_open_structures(body)
    if repaired is not None:
        obj = _loads_dict(repaired)
        if obj is not None:
            return obj, None
    return None, why


def _loads_dict(s: str) -> dict | None:
    try:
        obj = json.loads(s)
    except json.JSONDecodeError:
        return None
    return obj if isinstance(obj, dict) else None


def close_open_structures(s: str) -> str | None:
    stack: list[str] = []
    in_str = False
    esc = False
    str_start = -1
    for i, ch in enumerate(s):
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
            str_start = i
        elif ch in "{[":
            stack.append(ch)
        elif ch in "}]":
            if not stack:
                return None
            if (stack.pop() == "{") != (ch == "}"):
                return None
    out = s
    if in_str:
        before = out[:str_start].rstrip()
        if before.endswith(":"):
            out += '"'
        else:
            out = before
    out = out.rstrip()
    out = _DANGLING_KEY.sub("", out)
    out = _DANGLING_COMMA.sub("", out)
    while stack:
        out += "}" if stack.pop() == "{" else "]"
    return out
