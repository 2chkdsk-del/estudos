const SUB_MESSAGES = [
  "Mais um tópico dominado! Constância é o que aprova. Continue assim.",
  "Submatéria concluída! Cada tópico fechado é uma questão a menos que pode te derrubar na prova.",
  "Boa! Amanhã, revise esse tema com flashcards para fixar de vez.",
  "Missão cumprida neste tópico. Você está construindo o hábito de quem passa.",
  "Mais um passo rumo à sua vaga. Respire e siga para o próximo!",
  "Tópico concluído! Pequenas vitórias todos os dias viram uma aprovação.",
  "Isso aí! Quem estuda um pouco todo dia chega mais longe que quem estuda muito de vez em quando.",
  "Ótimo trabalho! Que tal resolver 3 questões desse tema para consolidar?",
];

const SUBJECT_MESSAGES = [
  "Você fechou todos os tópicos desta matéria. Isso é disciplina de aprovado!",
  "Matéria concluída! Agora é reforçar com questões e revisões espaçadas.",
  "Parabéns, uma matéria inteira vencida! Respire, comemore e siga firme.",
  "Que conquista! Uma parte grande do edital já ficou para trás.",
  "Matéria completa! Revise daqui a alguns dias para não perder o que aprendeu.",
];

const last = { sub: -1, subject: -1 };

function pick(list, kind) {
  let i = Math.floor(Math.random() * list.length);
  if (list.length > 1 && i === last[kind]) i = (i + 1) % list.length;
  last[kind] = i;
  return list[i];
}

// kind: "sub" (submatéria) | "subject" (matéria inteira)
export function buildCelebration({ kind, subjectName, subtopicName, done, total }) {
  const id = Math.random().toString(36).slice(2, 9);
  if (kind === "subject") {
    return {
      id, kind,
      title: `Matéria concluída: ${subjectName}`,
      text: pick(SUBJECT_MESSAGES, "subject"),
      progress: `${total}/${total} subtemas concluídos`,
    };
  }
  return {
    id, kind: "sub",
    title: `Submatéria concluída: ${subtopicName}`,
    text: pick(SUB_MESSAGES, "sub"),
    progress: `${subjectName}: ${done}/${total} subtemas concluídos`,
  };
}
