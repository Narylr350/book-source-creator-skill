// ── phase ordering ─────────────────────────────────────────────────────────

export const PHASE_ORDER = ["probe", "assess", "analyze", "generate", "validate", "deliver"];

export function currentPhaseIndex(state) {
  for (let i = 0; i < PHASE_ORDER.length; i++) {
    const p = state.phases[PHASE_ORDER[i]];
    if (p.status !== "completed") return i;
  }
  return PHASE_ORDER.length;
}

export function resetPhasesFrom(state, phase) {
  const start = PHASE_ORDER.indexOf(phase);
  if (start < 0) return;
  for (let i = start; i < PHASE_ORDER.length; i++) {
    const name = PHASE_ORDER[i];
    const p = state.phases[name];
    if (!p) continue;
    p.status = i === start ? "in_progress" : "pending";
    delete p.completedAt;
    if (name === "assess") {
      p.recorded = false;
      p.rating = null;
      delete p.recordedAt;
      delete p.factsHash;
    }
    if (name === "validate") {
      p.attempts = 0;
      p.lastStatus = null;
      p.lastError = "";
      p.consecutiveSame = 0;
      delete p.recordedAt;
    }
  }
  if (phase === "assess") {
    state.loginFeatures.hasWebView = false;
    state.loginFeatures.hasWebJs = false;
    state.loginFeatures.hasEnabledCookieJar = false;
    state.loginFeatures.hasAuthorization = false;
  }
}
