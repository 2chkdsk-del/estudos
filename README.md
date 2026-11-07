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
