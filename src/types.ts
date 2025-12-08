import type { Extension } from "./tiger.ts";


interface CronConfig {
  pollIntervalMs?: number;
  requeueDelayMs?: number;
  levelDbPath?: string;
}

interface HttpConfig {
  port?: number;
  host?: string;
}

interface MonitorConfig {
  port?: number;
  host?: string;
  basePath?: string;
  disabled?: boolean;
  dbPath?: string;
}

interface DistributedConfig {
  driver?: "level" | "postgres";
  levelDbPath?: string;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
  maxQueueLength?: number;
}

export interface TigerConfig {
  instanceId?: string;
  cron?: CronConfig;
  http?: HttpConfig;
  monitor?: MonitorConfig;
  distributed?: DistributedConfig;
}

interface Processor<Param, State, Module> {
  (
    this: Module & Extension<Param, State>,
    state: State,
    param: Param
  ): Promise<Partial<State> | void> | Partial<State> | void
}
export interface Module<Param, State> {
  id?: string
  readonly target: string
  readonly process: Processor<Param, State, this>
  readonly distributed?: boolean
}

export interface Target {
  readonly protocol: string
  readonly path: string
}
