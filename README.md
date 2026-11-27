# agent-app-template

A starter for agent apps that run prompts on any AI token source you have: subscription CLIs (GitHub Copilot, Claude Code, Codex, Antigravity), API keys (Claude, Gemini) and OpenAI-compatible hosts (DeepSeek, OpenRouter, Groq and others). Each prompt goes to the first linked backend with usage left. It falls back on a limit or an outage, and a limit pauses that account until its reset.

The connection logic lives in [model-backends](https://github.com/grffn9/model-backends), so a fix there reaches every app built from this template. The agent workflow files (`AGENTS.md`, issue and PR templates, CI) come from [project-template](https://github.com/grffn9/project-template).

## Start a new app

```bash
gh repo create my-agent --private --template grffn9/agent-app-template --clone
cd my-agent
npm install
cp .env.example .env
```

Then:

1. Edit `config/connections.yaml`: keep the accounts you have, delete the rest.
2. Put API keys in `.env`. Subscriptions use each CLI's own sign-in, so they need no keys.
3. Replace this README, and fill in **Project** in `AGENTS.md`.
4. Build your app on `App` in `src/app.ts`.

## Use

```bash
npm start -- status
```

`status` lists every account, whether it is linked, and how to link it if not. It also shows the account's usage: the provider's real numbers, a cap you set, or why there are none.

```text
GitHub Copilot [subscription]: linked (1/1 models)
  usage (provider): month credits 5000/5000, 0% left
Claude API [api]: linked (1/1 models)
  usage (your caps): month usd 0/20, 100% left
Gemini API (free) [free]: not linked: Set GEMINI_API_KEY
  set GEMINI_API_KEY in .env (get one at https://aistudio.google.com/apikey)
```

```bash
npm start -- ask "Reply with exactly: pong"
npm start -- ask --backend claude-api-sonnet-5-5 "Summarize RFC 9110 in a line"
npm start -- ask --folder ../my-repo "Run the tests and fix what fails"
```

`ask` streams the answer to stdout and progress to stderr:

```text
skipped Copilot · GPT-6 Luna: The provider reports no usage left
asking Antigravity · Gemini 3.8 Flash…
agy-gemini-3.8-flash failed (rate_limit): … Resets in 2h42m10s.
asking Claude API · Sonnet 5.5…
pong
— Claude API · Sonnet 5.5, 18 in / 4 out tokens, $0.0001
```

`--folder` is agent mode: only CLI backends run, inside that folder, with their tools on and approvals skipped. Without it, CLIs run tool-free in an empty sandbox folder.

## In code

```ts
import { App } from "./app.ts";

const app = new App();
for await (const event of app.ask("Draft a commit message for these changes")) {
  if (event.type === "text") process.stdout.write(event.text);
}
app.close();
```

## Develop

```bash
npm test
npm run lint
npm run typecheck
```

To update the connection layer, bump the `model-backends` tag in `package.json` and run `npm install`.
