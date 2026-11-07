// Estimativa de quantos dias faltam para concluir os estudos.
// Modelo: cada submatéria pendente tem horas de estudo estimadas (padrão ou definidas
// pelo usuário). A capacidade vem dos horários cadastrados no cronograma semanal.
// Dia a dia, as horas disponíveis são divididas entre as matérias pendentes pelo mesmo
// peso usado na organização automática (prioridade x dificuldade). Quando uma matéria
// termina, as horas dela passam para as outras.

const JS_WEEKDAY = { dom: 0, seg: 1, ter: 2, qua: 3, qui: 4, sex: 5, sab: 6 };
const PRIORITY_WEIGHT = { alta: 3, media: 2, baixa: 1 };
export const MAX_DAYS = 3650;
const EPS = 1e-9;

export function slotHours(slot) {
  const [h1, m1] = String(slot.start || "0:0").split(":").map(Number);
  const [h2, m2] = String(slot.end || "0:0").split(":").map(Number);
  let d = h2 * 60 + m2 - (h1 * 60 + m1);
  if (d < 0) d += 24 * 60;
  return Math.max(0, d) / 60;
}

export function weeklyCapacity(schedule) {
  const cap = [0, 0, 0, 0, 0, 0, 0];
  Object.entries(schedule || {}).forEach(([key, slots]) => {
    const idx = JS_WEEKDAY[key];
    if (idx === undefined) return;
    (slots || []).forEach((s) => { cap[idx] += slotHours(s); });
  });
  return cap;
}

export function subtopicHours(t, defaultHours) {
  return Number(t.hours) > 0 ? Number(t.hours) : defaultHours;
}

export function pendingHours(subject, defaultHours) {
  return subject.subtopics.filter((t) => !t.done).reduce((n, t) => n + subtopicHours(t, defaultHours), 0);
}

function addDays(date, n) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
}

// Distribui `capacity` horas entre as matérias pendentes, proporcional ao peso.
function allocateDay(capacity, rem, weights) {
  let left = capacity;
  let active = Object.keys(rem).filter((id) => rem[id] > EPS);
  let guard = 0;
  while (left > EPS && active.length && guard++ < 20) {
    const totalW = active.reduce((n, id) => n + weights[id], 0);
    let spent = 0;
    const next = [];
    active.forEach((id) => {
      const give = Math.min((left * weights[id]) / totalW, rem[id]);
      rem[id] -= give;
      spent += give;
      if (rem[id] > EPS) next.push(id);
    });
    left -= spent;
    if (next.length === active.length) break;
    active = next;
  }
}

export function estimateCompletion({ subjects, schedule, defaultHours = 2, today = new Date() }) {
  const cap = weeklyCapacity(schedule);
  const weeklyHours = cap.reduce((n, x) => n + x, 0);
  const rem = {};
  const weights = {};
  const perSubject = {};
  let totalPending = 0;
  subjects.forEach((s) => {
    const p = pendingHours(s, defaultHours);
    totalPending += p;
    weights[s.id] = (PRIORITY_WEIGHT[s.priority] || 1) * (Number(s.difficulty) || 1);
    perSubject[s.id] = { pendingHours: p, days: p <= EPS ? 0 : null, date: null };
    if (p > EPS) rem[s.id] = p;
  });

  const result = { weeklyHours, totalPending, perSubject, overall: { days: totalPending <= EPS ? 0 : null, date: null }, noCapacity: false, over: false };
  if (totalPending <= EPS) return result;
  if (weeklyHours <= EPS) { result.noCapacity = true; return result; }

  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let remainingSubjects = Object.keys(rem).length;
  for (let d = 1; d <= MAX_DAYS && remainingSubjects > 0; d++) {
    const date = addDays(start, d - 1);
    const c = cap[date.getDay()];
    if (c > 0) {
      allocateDay(c, rem, weights);
      Object.keys(rem).forEach((id) => {
        if (rem[id] <= EPS && perSubject[id].days === null) {
          perSubject[id].days = d;
          perSubject[id].date = date;
          remainingSubjects--;
        }
      });
    }
    if (remainingSubjects === 0) result.overall = { days: d, date };
  }
  if (remainingSubjects > 0) result.over = true;
  return result;
}

// Compara a previsão com a próxima prova cadastrada na agenda.
export function examInfo({ agenda, today = new Date(), overallDays, totalPending, weeklyHours }) {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const exams = (agenda || [])
    .filter((e) => e.type === "prova" && /^\d{4}-\d{2}-\d{2}$/.test(e.date || ""))
    .map((e) => {
      const [y, m, d] = e.date.split("-").map(Number);
      return { title: e.title, date: new Date(y, m - 1, d) };
    })
    .filter((e) => e.date >= start)
    .sort((a, b) => a.date - b.date);
  if (!exams.length) return null;
  const exam = exams[0];
  const daysToExam = Math.round((exam.date - start) / 86400000);
  const info = { title: exam.title, date: exam.date, daysToExam, marginDays: null, neededWeeklyHours: null };
  if (overallDays != null) info.marginDays = daysToExam - (overallDays - 1);
  if (totalPending > 0 && daysToExam > 0) info.neededWeeklyHours = totalPending / (daysToExam / 7);
  if (weeklyHours != null) info.weeklyHours = weeklyHours;
  return info;
}
