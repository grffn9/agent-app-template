# AGENTS.md

Instructions for every AI coding agent in this repo: Claude Code, GitHub Copilot and Gemini/Antigravity. The tool-specific files (`CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md`) only point here, so this is the one file to keep current.

## Project

<!-- Replace with one or two sentences about your app once you start from this template. -->

A starter for agent apps that run prompts on any AI token source the user has: subscription CLIs (Copilot, Claude Code, Codex, Antigravity), API keys and OpenAI-compatible hosts. The connection layer is the `model-backends` package; this repo holds the app. TypeScript on Node 24+ with no build step.

## Commands

- Install: `npm ci`
- Run locally: `npm start -- status` and `npm start -- ask "<prompt>"`
- Test: `npm test`
- Lint / typecheck: `npm run lint` and `npm run typecheck`

## Workflow

- Never commit directly to `main`. Work on a branch named `<engine>/<issue>-<slug>`, e.g. `claude/12-add-login` or `copilot/7-fix-export`.
- Work in a git worktree, never the main checkout, so parallel agents don't collide (`git worktree add ../<repo>-<slug> -b <branch>`; Claude Code uses `.claude/worktrees/`).
- One issue per branch and PR. Put `Closes #<issue>` in the PR body.
- Stay inside the issue's scope. Mention unrelated problems in the PR description instead of fixing them.
- Commit in small, logical steps with imperative messages ("Add login form", not "added stuff").

## Definition of done

- Install, test, lint and typecheck commands above all pass.
- New behavior has a test, or the PR says exactly how it was verified.
- Every acceptance criterion in the issue is checked off or explained.
- The PR template is filled in, including anything left undone. Fill in every section; write "None" rather than deleting one.

## Rules

- Never commit secrets. Config goes in `.env` (gitignored); add every new variable to `.env.example` with a placeholder.
- Don't change `.github/workflows/` unless the issue asks for it.
- Don't add a dependency without a one-line reason in the PR.
- Code must work on Windows, macOS and Linux: use path helpers, not hard-coded separators or shell-specific scripts.
- TypeScript must stay erasable (no enums or parameter properties), because Node runs `src/` directly.
- Reach models only through `model-backends`. A fix to an adapter, the CLI flags or usage reading belongs in that package, not here, so every app gets it.
- Keep any server loopback-only, and API keys out of CLI and MCP child environments (`withoutSecrets`).
- CLI backends run tool-free in the empty sandbox folder. The one exception is agent mode, `--folder` / `ask({ folder })`: only CLI backends run there, inside that folder, with tools on.
- Never store prompt text in the usage database.
- Never show a guessed limit or usage figure as data, in the UI or the shipped config: show the provider's real numbers, a cap the user set (labelled as theirs), or say there are no numbers and why.

## Learned conventions

<!-- When an agent gets something wrong in this repo, add a one-line rule here so no agent repeats it. -->
