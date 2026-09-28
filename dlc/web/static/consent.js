window.dlcFirstRun = new Promise((resolve) => { window.__dlcFirstRunDone = resolve; });

(function () {
  const SURVEY_MIN_GAP_MS = 20 * 60 * 1000;   // between two prompts
  const SURVEY_MAX_PER_FEATURE = 2;           // per browser session
  let studyState = null;
  const surveyShown = {};

  function esc(s) { return typeof escapeHtml === "function" ? escapeHtml(String(s)) : String(s); }
  function log(kind, details) { try { if (typeof logEvent === "function") logEvent(kind, details || {}); } catch {} }
  function flush() { try { if (typeof flushTelemetry === "function") flushTelemetry(); } catch {} }
  function el(html) { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; }
  async function getJson(url) { const r = await fetch(url); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }
  async function postJson(url, body) {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    let b = null; try { b = await r.json(); } catch {}
    return { ok: r.ok, status: r.status, body: b };
  }
  function renderMd(md) {
    if (typeof mdLiteRender === "function") return mdLiteRender(md);
    return `<pre style="white-space:pre-wrap">${esc(md)}</pre>`;
  }

  /* ---------------------------------------------------- 1. course server */
  const VERIFY_TEXT = {
    accepted: ["connected — token accepted ✓", false],
    bad_token: ["server reachable but the token was REJECTED — check the exact string from your instructor", true],
    unreachable: ["saved, but the course server can't be reached right now — check the URL", true],
  };

  async function courseServerGate() {
    let pr = null;
    try { pr = await getJson("/api/config/proxy"); } catch { return; }
    if (!pr || pr.configured) return;
    let skipped = false;
    try { skipped = localStorage.getItem("dlc_connect_asked") === "1"; } catch {}
    if (skipped) return;
    return new Promise((resolve) => {
      const gate = el(`
        <div class="dlc-gate" id="dlc-connect-gate" role="dialog" aria-modal="true">
          <div class="dlc-gate-card">
            <h3>Connect to your course server</h3>
            <p class="muted">Your instructor gave you a server URL and a course token. Paste them once;
              they land in Settings → Course server, where you can change them later.
              No personal API key is needed.</p>
            <label style="font-size:12.5px;color:#374151">Course server URL</label>
            <input id="dlc-connect-url" class="text-input" type="text" placeholder="https://dlc-proxy-....apps.cloudapps.unc.edu"/>
            <label style="font-size:12.5px;color:#374151;margin-top:8px;display:block">Course token</label>
            <input id="dlc-connect-token" class="text-input" type="password" placeholder="course-..."/>
            <div class="dlc-gate-msg" id="dlc-connect-msg"></div>
            <div class="dlc-gate-row">
              <button id="dlc-connect-skip" class="btn-ghost">I don't have one yet</button>
              <div class="spacer"></div>
              <button id="dlc-connect-go" class="btn">Connect</button>
            </div>
          </div>
        </div>`);
      document.body.appendChild(gate);
      const msg = gate.querySelector("#dlc-connect-msg");
      const done = () => { gate.remove(); try { localStorage.setItem("dlc_connect_asked", "1"); } catch {} resolve(); };
      gate.querySelector("#dlc-connect-skip").addEventListener("click", () => { log("connect_gate_skipped", {}); done(); });
      gate.querySelector("#dlc-connect-go").addEventListener("click", async () => {
        const url = (gate.querySelector("#dlc-connect-url").value || "").trim();
        const token = (gate.querySelector("#dlc-connect-token").value || "").trim();
        if (!url) { msg.textContent = "The course server URL is required."; msg.className = "dlc-gate-msg err"; return; }
        msg.textContent = "Connecting…"; msg.className = "dlc-gate-msg";
        const r = await postJson("/api/config/proxy", { url, token });
        if (!r.ok || !r.body || !r.body.ok) { msg.textContent = "Save failed."; msg.className = "dlc-gate-msg err"; return; }
        const [text, bad] = VERIFY_TEXT[r.body.verify] || ["Saved.", false];
        msg.textContent = text; msg.className = "dlc-gate-msg " + (bad ? "err" : "ok");
        log("connect_gate_saved", { verify: r.body.verify || "n/a" });
        if (typeof renderProxyState === "function") renderProxyState();
        if (typeof refreshKeyChip === "function") refreshKeyChip();
        if (r.body.verify === "accepted") setTimeout(done, 700);
      });
    });
  }

  /* ------------------------------------------------------- 2. consent */
  function signaturePad(canvas) {
    const ctx = canvas.getContext("2d");
    const scale = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 460, h = canvas.clientHeight || 110;
    canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale);
    ctx.scale(scale, scale);
    ctx.lineWidth = 2; ctx.lineCap = "round"; ctx.strokeStyle = "#111827";
    let drawing = false, drawn = false;
    const pos = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    canvas.addEventListener("pointerdown", (e) => { drawing = true; drawn = true; const [x, y] = pos(e); ctx.beginPath(); ctx.moveTo(x, y); canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener("pointermove", (e) => { if (!drawing) return; const [x, y] = pos(e); ctx.lineTo(x, y); ctx.stroke(); });
    const stop = () => { drawing = false; };
    canvas.addEventListener("pointerup", stop); canvas.addEventListener("pointercancel", stop);
    return {
      clear() { ctx.clearRect(0, 0, w, h); drawn = false; },
      dataUrl() { return drawn ? canvas.toDataURL("image/png") : null; },
    };
  }

  function showConsentModal(st, md) {
    return new Promise((resolve) => {
      const gate = el(`
        <div class="dlc-gate" id="dlc-consent-gate" role="dialog" aria-modal="true" data-i18n-skip>
          <div class="dlc-gate-card">
            <h3>Research participation</h3>
            <p class="muted">Please read the information sheet. Taking part is voluntary; every feature of
              DLC works either way.</p>
            <div class="dlc-consent-doc" id="dlc-consent-doc">${renderMd(md)}</div>
            <div class="dlc-consent-form">
              <label for="dlc-consent-name">Type your full name (this is your electronic signature)</label>
              <input id="dlc-consent-name" class="text-input" type="text" autocomplete="name" placeholder="First Last"/>
              <div class="dlc-sig-wrap">
                <label>Optional: draw your signature</label>
                <canvas id="dlc-consent-sig" class="dlc-sig-canvas"></canvas>
                <div class="dlc-sig-tools"><button type="button" id="dlc-sig-clear" class="btn-ghost">Clear</button>
                  <span>mouse or finger</span></div>
              </div>
              <label class="check"><input type="checkbox" id="dlc-consent-agree"/>
                <span>I am 18 or older, I have read the information above, and I agree to take part in this research study.</span></label>
            </div>
            <div class="dlc-gate-msg" id="dlc-consent-msg"></div>
            <div class="dlc-gate-row">
              <button id="dlc-consent-decline" class="btn-ghost">Decline</button>
              <div class="spacer"></div>
              <button id="dlc-consent-yes" class="btn" disabled>Agree and continue</button>
            </div>
          </div>
        </div>`);
      document.body.appendChild(gate);
      const name = gate.querySelector("#dlc-consent-name");
      const box = gate.querySelector("#dlc-consent-agree");
      const yes = gate.querySelector("#dlc-consent-yes");
      const msg = gate.querySelector("#dlc-consent-msg");
      const pad = signaturePad(gate.querySelector("#dlc-consent-sig"));
      gate.querySelector("#dlc-sig-clear").addEventListener("click", () => pad.clear());
      if (st && st.name) name.value = st.name;
      const update = () => { yes.disabled = !(box.checked && name.value.trim().length >= 2); };
      name.addEventListener("input", update); box.addEventListener("change", update);
      log("consent_shown", { version: st && st.version, study_id: st && st.study_id });

      const send = async (decision) => {
        msg.textContent = "Saving…"; msg.className = "dlc-gate-msg";
        const r = await postJson("/api/consent", {
          decision, name: name.value.trim(), signature: decision === "agreed" ? pad.dataUrl() : null,
        });
        if (!r.ok || !r.body || !r.body.ok) {
          msg.textContent = (r.body && r.body.detail) || "Could not save your answer. Please try again.";
          msg.className = "dlc-gate-msg err"; return;
        }
        studyState = r.body.state || studyState;
        if (decision === "agreed") { log("consent_agreed", { version: r.body.version }); flush(); }
        gate.remove();
        renderResearchCard();
        resolve(decision);
      };
      yes.addEventListener("click", () => send("agreed"));
      gate.querySelector("#dlc-consent-decline").addEventListener("click", () => {
        if (!confirm("Decline the research study? DLC keeps working with every feature; nothing about your use is recorded. You can change this later in Settings → Research participation.")) return;
        send("declined");
      });
    });
  }

  async function consentGate(force) {
    let st = null;
    try { st = await getJson("/api/consent/state?refresh=1"); } catch { return; }
    studyState = st;
    if (!st || (!st.required && !force)) return;
    if (!st.study_id) return;
    let md = "";
    try { md = await (await fetch("/api/consent/text")).text(); } catch {}
    if (!md.trim()) return;
    return showConsentModal(st, md);
  }

  /* ------------------------------------------------ 3. settings card */
  async function renderResearchCard() {
    const state = document.getElementById("set-research-state");
    const btn = document.getElementById("research-change-btn");
    if (!state) return;
    let st = studyState;
    try { st = await getJson("/api/consent/state"); studyState = st; } catch {}
    if (!st || !st.study_id) {
      state.textContent = "no study on this course server — nothing is asked";
      state.classList.remove("settings-bad");
      if (btn) btn.classList.add("hidden");
      return;
    }
    const when = st.decided_at ? new Date(st.decided_at * 1000).toLocaleDateString() : "";
    if (st.decision === "agreed") {
      state.textContent = `taking part (study ${st.study_id})${st.name ? ", signed " + st.name : ""}${when ? ", " + when : ""}${st.required ? " — the sheet changed, please review" : ""}`;
      state.classList.toggle("settings-bad", !!st.required);
    } else if (st.decision === "declined") {
      state.textContent = `declined${when ? " on " + when : ""} — nothing is recorded`;
      state.classList.remove("settings-bad");
    } else {
      state.textContent = `study ${st.study_id} is on — not answered yet`;
      state.classList.add("settings-bad");
    }
    if (btn) {
      btn.classList.remove("hidden");
      btn.textContent = st.decision ? "Change…" : "Answer…";
    }
  }

  /* ----------------------------------------------- 4. feedback survey */
  function surveyAllowed(feature) {
    if (!studyState || !studyState.study_id || studyState.decision !== "agreed") return false;
    const rate = Number(studyState.survey_rate || 0);
    if (!(rate > 0)) return false;
    if ((surveyShown[feature] || 0) >= SURVEY_MAX_PER_FEATURE) return false;
    if (document.getElementById("dlc-survey")) return false;
    let last = 0; try { last = Number(localStorage.getItem("dlc_survey_last") || 0); } catch {}
    if (Date.now() - last < SURVEY_MIN_GAP_MS) return false;
    return Math.random() < rate;
  }

  const FEATURE_LABEL = { modeA: "the Mode A fix analysis", modeB: "the Coverage Coach proposals", explain: "the Layer 2 summary" };

  window.dlcMaybeAskFeedback = function (feature, filename) {
    if (!surveyAllowed(feature)) return;
    surveyShown[feature] = (surveyShown[feature] || 0) + 1;
    try { localStorage.setItem("dlc_survey_last", String(Date.now())); } catch {}
    const box = el(`
      <div class="dlc-survey" id="dlc-survey" role="dialog" aria-label="Feedback">
        <button class="close" id="dlc-survey-x" title="Skip">&times;</button>
        <h4>Quick question about ${esc(FEATURE_LABEL[feature] || "that answer")}</h4>
        <div class="q">Was this feedback helpful?</div>
        <div class="opts">
          <label><input type="radio" name="dlc-sv-helpful" value="yes"/> Yes</label>
          <label><input type="radio" name="dlc-sv-helpful" value="somewhat"/> Somewhat</label>
          <label><input type="radio" name="dlc-sv-helpful" value="no"/> No</label>
        </div>
        <div class="q">Did it answer your question or help you identify the problem?</div>
        <div class="opts">
          <label><input type="radio" name="dlc-sv-answered" value="yes"/> Yes</label>
          <label><input type="radio" name="dlc-sv-answered" value="partially"/> Partially</label>
          <label><input type="radio" name="dlc-sv-answered" value="no"/> No</label>
        </div>
        <div class="q">Optional: what could have made it more helpful?</div>
        <textarea id="dlc-sv-comment" class="text-input" maxlength="300" placeholder="a sentence is plenty"></textarea>
        <div class="dlc-gate-row">
          <button id="dlc-sv-skip" class="btn-ghost">Skip</button>
          <div class="spacer"></div>
          <button id="dlc-sv-send" class="btn">Send</button>
        </div>
      </div>`);
    document.body.appendChild(box);
    log("feedback_survey_shown", { feature, filename });
    const pick = (n) => { const r = box.querySelector(`input[name="${n}"]:checked`); return r ? r.value : null; };
    const skip = () => { log("feedback_survey_skipped", { feature, filename }); box.remove(); };
    box.querySelector("#dlc-survey-x").addEventListener("click", skip);
    box.querySelector("#dlc-sv-skip").addEventListener("click", skip);
    box.querySelector("#dlc-sv-send").addEventListener("click", () => {
      const helpful = pick("dlc-sv-helpful"), answered = pick("dlc-sv-answered");
      if (!helpful && !answered) { box.querySelector("#dlc-sv-send").textContent = "Pick an answer first"; return; }
      const comment = (box.querySelector("#dlc-sv-comment").value || "").trim().slice(0, 300);
      log("feedback_survey", { feature, filename, helpful, answered, comment, comment_len: comment.length });
      flush();
      box.innerHTML = `<h4>Thank you.</h4>`;
      setTimeout(() => box.remove(), 1200);
    });
    setTimeout(() => { if (document.body.contains(box) && !box.querySelector("#dlc-sv-send")) return;
      if (document.body.contains(box)) { log("feedback_survey_timeout", { feature }); box.remove(); } }, 3 * 60 * 1000);
  };

  /* ---------------------------------------------------------- boot */
  document.addEventListener("DOMContentLoaded", async () => {
    try { await courseServerGate(); } catch {}
    try { await consentGate(false); } catch {}
    try { await renderResearchCard(); } catch {}
    const btn = document.getElementById("research-change-btn");
    if (btn) btn.addEventListener("click", () => consentGate(true).catch(() => {}));
    try { window.__dlcFirstRunDone(); } catch {}
  });
})();
