import path from "node:path";
import { parseArgs } from "node:util";
import { App } from "./app.ts";
import type { AccountStatus } from "./app.ts";

const USAGE = `Usage:
  npm start -- status
  npm start -- ask [--backend <id>] [--folder <path>] <prompt...>

status   lists every account, whether it is linked, how to link it, and its usage
ask      runs the prompt on the first linked backend, falling back on a limit or outage
         --backend runs one backend only; --folder runs a CLI agent in that folder, tools on`;

function percent(remaining: number): string {
  return `${Math.round(remaining * 100)}% left`;
}

function printStatus(accounts: AccountStatus[]): void {
  for (const account of accounts) {
    const state = account.linked
      ? `linked (${account.ready}/${account.models} models)`
      : `not linked: ${account.reason}`;
    console.log(`${account.label} [${account.kind}]: ${state}`);
    if (!account.linked) {
      for (const key of account.keys.filter((key) => !key.set)) {
        console.log(`  set ${key.name} in .env${key.url ? ` (get one at ${key.url})` : ""}`);
      }
      if (account.cli && !account.cli.installed) console.log(`  install: ${account.cli.install}`);
      if (account.cli) console.log(`  sign in: ${account.cli.signIn}`);
      if (account.signIn) console.log(`  ${account.signIn}`);
    }
    const usage = account.usage;
    if (usage.source === "none") {
      console.log(`  usage: no numbers. ${usage.reason}`);
      continue;
    }
    for (const limit of usage.limits) {
      const scope = limit.model ? ` ${limit.model}` : "";
      console.log(
        `  usage (${usage.source}):${scope} ${limit.window} ${limit.metric} ` +
          `${limit.used}/${limit.limit}, ${percent(limit.remaining)}`,
      );
    }
  }
}

async function ask(app: App, prompt: string, backend?: string, folder?: string): Promise<void> {
  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());
  for await (const event of app.ask(prompt, {
    ...(backend ? { backend } : {}),
    ...(folder ? { folder: path.resolve(folder) } : {}),
    signal: controller.signal,
  })) {
    switch (event.type) {
      case "text":
        process.stdout.write(event.text);
        break;
      case "step":
        console.error(`· ${event.summary}`);
        break;
      case "skip":
        console.error(`skipped ${event.label}: ${event.reason}`);
        break;
      case "attempt":
        console.error(`asking ${event.label}…`);
        break;
      case "fallback":
        console.error(`\n${event.from} failed (${event.kind}): ${event.reason}`);
        break;
      case "done": {
        const cost = event.usd ? `, $${event.usd.toFixed(4)}` : "";
        console.error(
          `\n— ${event.label}, ${event.inputTokens} in / ${event.outputTokens} out tokens${cost}`,
        );
        break;
      }
    }
  }
}

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      backend: { type: "string" },
      folder: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [command, ...rest] = positionals;
  if (values.help || !command) {
    console.log(USAGE);
    return values.help ? 0 : 1;
  }

  const app = new App();
  try {
    if (command === "status") {
      printStatus(await app.status());
      return 0;
    }
    if (command === "ask") {
      const prompt = rest.join(" ").trim();
      if (!prompt) {
        console.error("ask needs a prompt");
        return 1;
      }
      await ask(app, prompt, values.backend, values.folder);
      return 0;
    }
    console.error(`Unknown command ${command}\n\n${USAGE}`);
    return 1;
  } finally {
    app.close();
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
