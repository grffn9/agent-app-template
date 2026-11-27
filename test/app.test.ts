import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { BackendError } from "model-backends";
import type { Adapter, LimitUsage, RunEvent } from "model-backends";
import { App, ROOT } from "../src/app.ts";

const folder = mkdtempSync(path.join(os.tmpdir(), "agent-app-test-"));
after(() => rmSync(folder, { recursive: true, force: true }));

const CONFIG = `
accounts:
  sub: { label: Subscription, kind: subscription, liveUsage: { source: copilot } }
  api: { label: Metered API, kind: api, limits: [{ window: month, usd: 5 }] }
  free: { label: Free tier, kind: free }
backends:
  - { id: cli, account: sub, adapter: copilot, model: m }
  - { id: paid, account: api, adapter: openai, model: m, baseUrl: https://x.test, apiKeyEnv: PAID_KEY }
  - { id: gratis, account: free, adapter: openai, model: m, baseUrl: https://y.test, apiKeyEnv: FREE_KEY }
`;

function configFile(source = CONFIG): string {
  const file = path.join(folder, `config-${Math.random().toString(36).slice(2)}.yaml`);
  writeFileSync(file, source);
  return file;
}

/** One adapter for every name, answering from a script per backend id. */
function scripted(answers: Record<string, string | Error>) {
  const calls: string[] = [];
  const adapter: Adapter = async function* (backend, input) {
    calls.push(`${backend.id}${input.folder ? ` in ${input.folder}` : ""}`);
    const answer = answers[backend.id];
    if (answer instanceof Error) throw answer;
    yield { type: "text", text: answer ?? "" };
    yield { type: "usage", inputTokens: 10, outputTokens: 5 };
  };
  return { adapters: { copilot: adapter, openai: adapter }, calls };
}

const copilotLimits: LimitUsage[] = [
  { window: "month", metric: "credits", used: 30, limit: 300, remaining: 0.9, resetsAt: null },
];

function makeApp(answers: Record<string, string | Error>, env: Record<string, string> = {}) {
  const { adapters, calls } = scripted(answers);
  const app = new App({
    configFile: configFile(),
    dataDir: ":memory:",
    env: { PAID_KEY: "k", FREE_KEY: "k", ...env },
    adapters,
    readers: { copilot: async () => copilotLimits },
    hasCommand: () => true,
  });
  return { app, calls };
}

async function collect(events: AsyncIterable<RunEvent>) {
  const all: RunEvent[] = [];
  for await (const event of events) all.push(event);
  const text = all.flatMap((event) => (event.type === "text" ? [event.text] : [])).join("");
  return { all, text };
}

test("the shipped config loads", () => {
  const app = new App({ dataDir: ":memory:", env: {}, hasCommand: () => false });
  assert.ok(app.connections.backends.length > 0);
  assert.equal(path.basename(ROOT), path.basename(path.resolve(import.meta.dirname, "..")));
  app.close();
});

test("ask answers from the first backend, falling back past a limit", async () => {
  const { app, calls } = makeApp({
    cli: new BackendError("rate_limit", "limit reached", 60_000),
    paid: "from paid",
  });
  const { text, all } = await collect(app.ask("hello"));
  assert.equal(text, "from paid");
  assert.deepEqual(calls, ["cli", "paid"]);
  assert.ok(all.some((event) => event.type === "fallback" && event.from === "cli"));
  app.close();
});

test("ask can run one backend only", async () => {
  const { app, calls } = makeApp({ gratis: "free answer" });
  const { text } = await collect(app.ask("hello", { backend: "gratis" }));
  assert.equal(text, "free answer");
  assert.deepEqual(calls, ["gratis"]);
  assert.throws(() => app.candidates({ backend: "nope" }), /No backend named nope/);
  app.close();
});

test("agent mode runs only CLI backends, in the folder", async () => {
  const { app, calls } = makeApp({ cli: "done" });
  await collect(app.ask("fix the tests", { folder }));
  assert.deepEqual(calls, [`cli in ${folder}`]);
  app.close();
});

test("status shows real provider numbers, your caps, or why there are none", async () => {
  const { app } = makeApp({}, {});
  const byAccount = Object.fromEntries((await app.status()).map((s) => [s.account, s]));
  assert.deepEqual(byAccount.sub?.usage, {
    source: "provider",
    limits: copilotLimits,
    checkedAt: byAccount.sub?.usage.source === "provider" ? byAccount.sub.usage.checkedAt : null,
  });
  assert.equal(byAccount.api?.usage.source, "your caps");
  assert.equal(byAccount.free?.usage.source, "none");
  assert.match(
    byAccount.free?.usage.source === "none" ? byAccount.free.usage.reason : "",
    /can't read this provider's usage/,
  );
  app.close();
});

test("an account with a missing key says how to link it", async () => {
  const { adapters } = scripted({});
  const app = new App({
    configFile: configFile(),
    dataDir: ":memory:",
    env: {},
    adapters,
    readers: {},
    hasCommand: () => false,
  });
  const api = (await app.status()).find((s) => s.account === "api");
  assert.equal(api?.linked, false);
  assert.equal(api?.reason, "Set PAID_KEY");
  assert.deepEqual(
    api?.keys.map((key) => [key.name, key.set]),
    [["PAID_KEY", false]],
  );
  app.close();
});
