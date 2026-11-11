# Diário Oficial da Aprovação — Plano de Estudos

App de estudos para concursos: cronograma automático, agenda com lembretes,
Pomodoro, flashcards, geração de questões, gráficos de desempenho, dicas e
acompanhamento de concursos.

## Como colocar no ar (Netlify) — passo a passo

### Opção A — via GitHub (recomendado, mais simples)

1. Crie um repositório novo no GitHub e suba esta pasta inteira nele.
   - Pelo site do GitHub: crie o repositório vazio, clique em "uploading an
     existing file" e arraste todos os arquivos e pastas.
2. Entre em [app.netlify.com](https://app.netlify.com) → **Add new site** →
   **Import an existing project** → escolha o GitHub e selecione o repositório.
3. Netlify já detecta automaticamente:
   - Build command: `npm run build`
   - Publish directory: `dist`
   (já vem configurado no `netlify.toml`, não precisa mexer)
4. Clique em **Deploy**. Em 1–2 minutos o site estará no ar em um endereço
   tipo `nome-aleatorio.netlify.app` (pode trocar o nome em Site settings).

### Opção B — sem GitHub, pela CLI do Netlify

Requer o [Node.js](https://nodejs.org) instalado no seu computador.

```bash
npm install
npm run build
npx netlify-cli deploy --prod
```

Siga as instruções no terminal (login e escolha/criação do site).

## Ativar a geração automática de questões (opcional)

Esse recurso chama a API do Google Gemini por trás de uma função do
Netlify, para sua chave nunca ficar exposta no navegador. Sem isso, o
resto do app funciona normalmente — só essa aba fica indisponível.
O Gemini tem um nível gratuito, então normalmente não há custo.

1. Crie uma chave gratuita em [aistudio.google.com/apikey](https://aistudio.google.com/apikey).
2. No Netlify: **Site settings → Environment variables → Add a variable**
   - Key: `GEMINI_API_KEY`
   - Value: sua chave
3. Faça um novo deploy (**Deploys → Trigger deploy**) para a variável entrar
   em vigor.

## Instalar como app no celular (PWA)

Depois que o site estiver publicado (precisa ser https, o Netlify já entrega
assim):

- **Android/Chrome:** abra o link do site → menu (⋮) → "Adicionar à tela
  inicial" ou "Instalar app". Vai aparecer um ícone dourado como qualquer
  outro aplicativo.
- **iPhone/Safari:** abra o link → botão de compartilhar → "Adicionar à Tela
  de Início".
- **Windows/Linux (Chrome/Edge):** ícone de instalar (⊕) na barra de
  endereço.

## Rodar localmente antes de publicar (opcional)

```bash
npm install
npm run dev
```

Abre em `http://localhost:5173`.

## Revisão espaçada: FSRS (4 botões)

Os flashcards usam o **FSRS** (Free Spaced Repetition Scheduler), o mesmo
algoritmo do Anki moderno, pela biblioteca [`ts-fsrs`](https://github.com/open-spaced-repetition/ts-fsrs)
(v5, exige Node 20 ou mais novo; o `netlify.toml` fixa o Node 22).

No modo estudo há 4 botões, cada um com o tempo estimado até a próxima revisão:

| Botão | Significado |
|---|---|
| **De novo** | Errei: volta para o aprendizado, a estabilidade cai |
| **Difícil** | Acertei com esforço: intervalo cresce pouco |
| **Bom** | Acertei normal: intervalo cresce no ritmo alvo |
| **Fácil** | Acertei fácil: intervalo cresce mais |

**Como funciona**

- Meta de retenção de 90% (`request_retention: 0.9` em `src/fsrs.js`). Os
  intervalos não têm sorteio (`enable_fuzz: false`), o que facilita os testes.
- Cartão novo ou errado passa pelos passos curtos de aprendizado da biblioteca
  (1 min e 10 min) e reaparece no fim da sessão; ao ir para revisão, a próxima
  data passa a ser em dias.
- O cartão guarda `stability`, `difficulty`, `state`, `due`, `reps`, `lapses` e
  os demais campos do FSRS. Datas ficam em texto ISO, então o backup em JSON
  continua funcionando. `box`, `dueAt` e `lastReview` seguem no cartão, derivados
  do FSRS, para o Anki e para a lista de cartões.
- **Migração suave:** cartões antigos (caixas 1 a 5) continuam valendo e são
  convertidos na primeira resposta: caixa 1 vira cartão novo; nas demais, o
  intervalo é o que havia entre a última revisão e o vencimento (ou o da tabela
  antiga) e a dificuldade começa neutra (5).
- Desfazer (Ctrl+Z) devolve o agendamento anterior do cartão, sem desfazer
  edições de texto.
- Exportar para o Anki: cartões em revisão vão com o intervalo real
  (`scheduled_days`) e fator neutro 2500; novos e em aprendizado vão como novos.

**Limitações**

- Parâmetros do FSRS são os padrão da biblioteca: não há otimização com o seu
  histórico.
- Não há suspensão automática de cartões que você erra demais (leech) nem opção
  de ligar o `fuzz` na tela.
- Ao importar do Anki, o cartão entra no formato antigo e vira FSRS só na
  primeira resposta, com o intervalo aproximado.

## Progresso do Anki (importar e exportar)

Os pacotes .apkg/.colpkg também levam o estado de revisão dos cartões.

**Importar:** cada cartão é lido com o estado que tinha no Anki e convertido para
as caixas do app (convertidas para FSRS na primeira resposta):

- novo ou em aprendizado: caixa 1
- intervalo de até 4 dias: caixa 2; até 10 dias: caixa 3; até 25 dias: caixa 4;
  acima disso: caixa 5
- fator de facilidade abaixo de 2,0 rebaixa 1 caixa; acima de 2,8 sobe 1
- a próxima revisão vem do campo `due`, que no Anki conta dias desde a criação
  da coleção (e só vale como data para cartões em revisão)
- a última revisão vem do `revlog` (horário da revisão) ou, se faltar, de
  próxima revisão menos o intervalo

**Exportar:** com a opção "Incluir progresso de revisão" marcada, cada cartão
vai com tipo, fila, intervalo, fator e data de revisão. Cartões já em FSRS levam
o intervalo real e um revlog de uma revisão; cartões ainda no formato antigo
usam as caixas, e o revlog recebe uma revisão por salto de caixa. Desmarcada, os
cartões entram como novos no Anki. O arquivo .txt leva só o texto.

**Limitações**

- Na importação, o Anki entra como caixas fixas (1, 3, 7, 15 e 30 dias). A
  conversão guarda a "sensação" do cartão (novo, difícil, maduro), não os
  intervalos exatos.
- O revlog exportado é sintético: as estatísticas do Anki mostrarão uma curva
  plausível, não a real.
- Imagens e áudios não são importados nem exportados.
- O GUID dos cartões vem do próprio cartão do app, então exportar o mesmo
  baralho de novo não duplica no Anki, e corrigir o texto de um cartão atualiza
  a nota em vez de criar outra.
- A exportação usa o formato antigo (collection.anki2). O Anki atual importa;
  se der problema, use o .txt.

## Offline (vite-plugin-pwa)

Depois de instalado, o app abre sem internet, inclusive na primeira abertura offline.

- O Tailwind agora é compilado no build (antes vinha de um CDN em tempo de
  execução). Sem isso a tela abriria sem estilo offline.
- O service worker (`src/sw.js`) pré-cacheia todos os arquivos do build (JS,
  CSS, HTML, ícones). O plugin injeta a lista de arquivos a cada build.
- As bibliotecas do Anki (JSZip, sql.js, fzstd) e as fontes do Google ficam em
  cache depois do primeiro uso com internet. Sem as fontes, o app usa as fontes
  do sistema.
- Gerar questões (Gemini) continua precisando de internet.
- A versão nova de um deploy é baixada em segundo plano e vale no próximo
  carregamento do app.

Como conferir depois do deploy:

1. Abra o site com internet e espere carregar por completo.
2. No Chrome: DevTools > Application > Service Workers (deve estar "activated")
   e Cache Storage (deve ter um `workbox-precache-...`).
3. Marque Network > Offline e recarregue: o app deve abrir com o visual normal.

Localmente: `npm run build && npm run preview`. O service worker só existe no
build, não no `npm run dev`.

## Gamificação

- Cada ação dá XP: submatéria concluída (50), matéria inteira (200), bloco de
  foco do Pomodoro (10), cartão acertado (2) e questão certa (3). Marcar e
  desmarcar a mesma submatéria não rende XP de novo.
- A aba **Conquistas** mostra nível e cargo, meta diária (ajustável), missões
  da semana e os carimbos desbloqueados. O cabeçalho mostra a ofensiva de dias
  e o nível, e o Cronograma mostra a meta do dia.
- Os flashcards usam revisão espaçada com FSRS (veja a seção abaixo): o modo
  estudo mostra os cartões que vencem hoje, e cada resposta agenda a próxima
  revisão. Qualquer resposta diferente de "De novo" conta como acerto para o XP.
- O progresso entra no backup (Salvar/Abrir registro).
- Testes da lógica: `npm install` e depois `npm test`.

## Matérias e estimativa de término

- No Cronograma, o lápis ao lado de cada matéria abre a edição: nome,
  prioridade, dificuldade e as submatérias (renomear, marcar como concluída,
  definir horas de estudo, adicionar e excluir).
- A estimativa de dias (geral e por matéria) aparece no Cronograma e na aba
  Desempenho. Ela divide as horas pendentes pelas horas dos horários semanais
  cadastrados, repartindo entre as matérias por prioridade x dificuldade. Se
  houver uma prova na Agenda, o app compara com a data dela.

## Pomodoro: alertas

- Ao terminar o foco, o app mostra um aviso em tela cheia, toca um som, vibra
  (celular) e envia uma notificação do sistema; o descanso começa sozinho.
- Ao terminar o descanso, aparece outro aviso bem claro, com o botão
  "Iniciar foco agora".
- Toque em **Testar alerta** (aba Pomodoro) para conferir som e notificações
  no seu aparelho. Na primeira vez, autorize as notificações.
- Um site/PWA não consegue desenhar por cima de outros apps; o que aparece por
  cima deles é a notificação do sistema. Se o navegador for suspenso em
  segundo plano, o aviso pode atrasar.

## Flashcards: Anki

- **Exportar**: texto (.txt, que o Anki importa) ou pacote .apkg, para todos os
  baralhos ou só o selecionado.
- **Importar**: .apkg/.colpkg (baralhos completos), texto/CSV/TSV e colar
  vários cartões de uma vez. Para pacotes .apkg/.colpkg (importar ou exportar), o app
  baixa as bibliotecas (JSZip e sql.js) na primeira vez, então precisa de
  internet nesse momento.
- Imagens e áudios dos cartões do Anki não são importados.

## Observações

- Os dados (cronograma, agenda, flashcards, concursos) ficam salvos no
  armazenamento local do navegador de cada dispositivo — não sincronizam
  entre celular e computador automaticamente.
- Os lembretes da Agenda tocam som/notificação enquanto o app está aberto no
  navegador; não são alarmes do sistema operacional.
