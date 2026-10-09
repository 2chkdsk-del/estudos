// Lógica pura do Pomodoro. Baseada em horário final (endAt) e não em contagem
// de "ticks", para continuar correta mesmo se o navegador atrasar os timers
// quando o app estiver em segundo plano.

export function makePomoState(settings) {
  return { mode: "work", running: false, endAt: null, remainingMs: settings.work * 60000, cycles: 0 };
}

export function pomoRemainingMs(state, now) {
  return state.running ? Math.max(0, state.endAt - now) : state.remainingMs;
}

export function pomoStart(state, now) {
  if (state.running) return state;
  return { ...state, running: true, endAt: now + state.remainingMs };
}

export function pomoPause(state, now) {
  if (!state.running) return state;
  return { ...state, running: false, remainingMs: Math.max(0, state.endAt - now), endAt: null };
}

export function pomoSwitch(state, mode, settings) {
  return { ...state, mode, running: false, endAt: null, remainingMs: settings[mode] * 60000 };
}

export function pomoReset(state, settings) {
  return pomoSwitch(state, state.mode, settings);
}

// Avança o relógio. Quando o foco termina, o descanso COMEÇA sozinho.
// Quando o descanso termina, o timer para e avisa (o próximo foco é iniciado pelo usuário).
export function pomoAdvance(state, now, settings) {
  let s = state;
  let alert = null;
  let guard = 0;
  while (s.running && now >= s.endAt && guard++ < 10) {
    if (s.mode === "work") {
      const cycles = s.cycles + 1;
      const every = Math.max(1, settings.cyclesUntilLong);
      const mode = cycles % every === 0 ? "long" : "short";
      const dur = settings[mode] * 60000;
      s = { mode, cycles, running: true, endAt: s.endAt + dur, remainingMs: dur };
      alert = { kind: "focus-done", breakMode: mode, breakMs: dur, at: now };
    } else {
      s = { mode: "work", cycles: s.cycles, running: false, endAt: null, remainingMs: settings.work * 60000 };
      alert = { kind: "break-done", at: now };
    }
  }
  return { state: s, alert, changed: s !== state };
}

export function formatClock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const mm = String(Math.floor(total / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}
