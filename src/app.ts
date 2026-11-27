import path from "node:path";
import {
  CLI_ADAPTERS,
  defaultAdapters,
  defaultReaders,
  describeProviders,
  findCommand,
  LiveUsage,
  loadConnections,
  runWithFallback,
  UsageLedger,
} from "model-backends";
import type {
  Adapter,
  Backend,
  ChatMessage,
  LimitUsage,
  LiveReader,
  LiveUsageSource,
  ParsedConnections,
  Provider,
  RunEvent,
} from "model-backends";

type Env = Record<string, string | undefined>;

/** The repo root, so the default config and data folder don't depend on the working folder. */
export const ROOT = path.resolve(import.meta.dirname, "..");

export interface AppOptions {
  /** Defaults to APP_CONFIG, then config/connections.yaml. */
  configFile?: string;
  /** Where the usage ledger lives. Defaults to APP_DATA_DIR, then data/. ":memory:" keeps none. */
  dataDir?: string;
  env?: Env;
  /** Replace or add adapters, such as a scripted one in tests. */
  adapters?: Record<string, Adapter>;
  /** Live usage readers. Defaults to Copilot, Claude and Codex. */
  readers?: Partial<Record<LiveUsageSource, LiveReader>>;
  hasCommand?: (command: string) => boolean;
  now?: () => number;
}

export interface AskOptions {
  /** Run only this backend, by id. Unset, backends are tried in config order. */
  backend?: string;
  /** Agent mode: only CLI backends run, inside this folder, with their tools on. */
  folder?: string;
  /** A system prompt. */
  instructions?: string;
  /** A label for the usage ledger, such as "code". Never prompt text. */
  task?: string;
  signal?: AbortSignal;
}

/** Where an account's usage numbers come from, or why it has none. */
export type UsageReport =
  | { source: "provider"; limits: LimitUsage[]; checkedAt: number | null }
  | { source: "your caps"; limits: LimitUsage[] }
  | { source: "none"; reason: string };

export interface AccountStatus extends Provider {
  usage: UsageReport;
}

/**
 * Everything an agent app needs to reach its models: the connections file, the adapters, the
 * usage ledger and live provider usage. Build your app's own logic on ask() and status().
 */
export class App {
  readonly connections: ParsedConnections;
  private readonly env: Env;
  private readonly adapters: Record<string, Adapter>;
  private readonly ledger: UsageLedger;
  private readonly live: LiveUsage;
  private readonly hasCommand: (command: string) => boolean;
  private readonly now: () => number;

  constructor(options: AppOptions = {}) {
    this.env = options.env ?? process.env;
    const configFile =
      options.configFile ??
      path.resolve(ROOT, this.env.APP_CONFIG || path.join("config", "connections.yaml"));
    this.connections = loadConnections(configFile, this.env, {
      adapters: Object.keys(options.adapters ?? {}),
    });
    this.adapters = defaultAdapters(options.adapters);
    const dataDir = options.dataDir ?? path.resolve(ROOT, this.env.APP_DATA_DIR || "data");
    this.ledger = new UsageLedger(
      dataDir === ":memory:" ? dataDir : path.join(dataDir, "usage.db"),
    );
    this.now = options.now ?? Date.now;
    this.live = new LiveUsage(options.readers ?? defaultReaders(), { now: this.now });
    this.hasCommand = options.hasCommand ?? ((command) => findCommand(command, this.env) !== null);
  }

  /** The backends a request may use, in the order they are tried. */
  candidates(options: Pick<AskOptions, "backend" | "folder"> = {}): Backend[] {
    let backends = this.connections.backends;
    if (options.backend) {
      backends = backends.filter((backend) => backend.id === options.backend);
      if (!backends.length) throw new Error(`No backend named ${options.backend}`);
    }
    if (options.folder) {
      backends = backends.filter((backend) => CLI_ADAPTERS.includes(backend.adapter));
      if (!backends.length) throw new Error("Agent mode needs a CLI backend");
    }
    return backends;
  }

  /** Runs a prompt, or a conversation, on the first backend that can take it. */
  async *ask(prompt: string | ChatMessage[], options: AskOptions = {}): AsyncGenerator<RunEvent> {
    const messages: ChatMessage[] =
      typeof prompt === "string" ? [{ role: "user", content: prompt }] : prompt;
    const accounts = [...this.connections.accounts.values()].filter((a) => a.liveUsage);
    await this.live.refresh(accounts);
    yield* runWithFallback({
      backends: this.candidates(options),
      adapters: this.adapters,
      accounts: this.connections.accounts,
      ledger: this.ledger,
      live: this.live,
      task: options.task ?? (options.folder ? "agent" : "chat"),
      env: this.env,
      hasCommand: this.hasCommand,
      now: this.now,
      input: {
        messages,
        attachments: [],
        ...(options.folder ? { folder: options.folder } : {}),
        ...(options.instructions ? { instructions: options.instructions } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
      },
    });
  }

  /** Each account: whether it is linked, how to link it, and its real usage numbers if any. */
  async status(): Promise<AccountStatus[]> {
    const accounts = [...this.connections.accounts.values()];
    await this.live.refresh(accounts.filter((account) => account.liveUsage));
    const providers = describeProviders(this.connections, {
      env: this.env,
      source: (name) => (this.env[name] ? "environment" : null),
      hasCommand: this.hasCommand,
      platform: process.platform,
    });
    return providers.map((provider) => {
      const account = this.connections.accounts.get(provider.account);
      return { ...provider, usage: account ? this.usage(account.id) : noNumbers("") };
    });
  }

  private usage(accountId: string): UsageReport {
    const account = this.connections.accounts.get(accountId);
    if (!account) return noNumbers("Unknown account");
    if (account.liveUsage) {
      const reading = this.live.get(account.id);
      if (reading.limits) {
        return { source: "provider", limits: reading.limits, checkedAt: reading.checkedAt };
      }
      if (reading.error) return noNumbers(`Could not read usage: ${reading.error}`);
    }
    if (account.limits.length) {
      return { source: "your caps", limits: this.ledger.headroom(account, this.now()).limits };
    }
    return noNumbers(
      account.liveUsage
        ? "Usage has not been read yet"
        : "model-backends can't read this provider's usage. Add a cap under limits to track your own.",
    );
  }

  close(): void {
    this.ledger.close();
  }
}

const noNumbers = (reason: string): UsageReport => ({ source: "none", reason });
