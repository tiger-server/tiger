import path from "node:path";
import { nanoid } from "nanoid";

import type { TigerConfig } from "./types.ts";

const DEFAULT_HTTP_PORT = 9527;
const DEFAULT_HTTP_HOST = "0.0.0.0";
const DEFAULT_MONITOR_PORT = 9753;
const DEFAULT_MONITOR_HOST = "0.0.0.0";
const DEFAULT_MONITOR_DB = ".tiger-monitor";
const DEFAULT_CRON_LEVEL_DB = ".tiger-cron";
const DEFAULT_DISTRIBUTED_LEVEL_DB = ".tiger-distributed";
const DEFAULT_HEARTBEAT_INTERVAL = 3000;
const DEFAULT_HEARTBEAT_TIMEOUT = 10000;

function parseNumber(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

export interface ResolvedHttpConfig {
  host: string;
  port: number;
}

export interface ResolvedMonitorConfig {
  host: string;
  port: number;
  disabled: boolean;
  dbPath: string;
}

export interface ResolvedCronConfig {
  pollIntervalMs: number;
  requeueDelayMs: number;
  levelDbPath: string;
}

export interface ResolvedDistributedConfig {
  driver: "level" | "postgres";
  heartbeatIntervalMs: number;
  heartbeatTimeoutMs: number;
  maxQueueLength: number;
  levelDbPath: string;
}

export function resolveHttpConfig(config?: TigerConfig): ResolvedHttpConfig {
  const http = config?.http ?? {};
  const port =
    http.port ??
    parseNumber(process.env.TIGER_HTTP_PORT, DEFAULT_HTTP_PORT);
  const host = http.host ?? process.env.TIGER_HTTP_HOST ?? DEFAULT_HTTP_HOST;
  return { host, port };
}

export function resolveMonitorConfig(
  config?: TigerConfig
): ResolvedMonitorConfig {
  const monitor = config?.monitor ?? {};
  const port =
    monitor.port ??
    parseNumber(process.env.TIGER_MONITOR_PORT, DEFAULT_MONITOR_PORT);
  const host =
    monitor.host ?? process.env.TIGER_MONITOR_HOST ?? DEFAULT_MONITOR_HOST;
  const disabled =
    monitor.disabled ?? process.env.TIGER_MONITOR_DISABLED === "1";
  const dbPath = path.resolve(
    monitor.dbPath ?? process.env.TIGER_MONITOR_DB ?? DEFAULT_MONITOR_DB
  );
  return { host, port, disabled, dbPath };
}

export function resolveCronConfig(config?: TigerConfig): ResolvedCronConfig {
  const cron = config?.cron ?? {};
  const pollIntervalMs =
    cron.pollIntervalMs ??
    parseNumber(process.env.TIGER_CRON_POLL_INTERVAL_MS, 1000);
  const requeueDelayMs =
    cron.requeueDelayMs ??
    parseNumber(process.env.TIGER_CRON_REQUEUE_DELAY_MS, 5000);
  const levelDbPath = path.resolve(
    cron.levelDbPath ?? process.env.TIGER_CRON_LEVEL_PATH ?? DEFAULT_CRON_LEVEL_DB
  );
  return { pollIntervalMs, requeueDelayMs, levelDbPath };
}

export function resolveDistributedConfig(
  config?: TigerConfig
): ResolvedDistributedConfig | undefined {
  const distributed = config?.distributed;
  const envDriver = process.env.TIGER_DISTRIBUTED_DRIVER as
    | "level"
    | "postgres"
    | undefined;
  if (!distributed && !envDriver) {
    return undefined;
  }
  const driver =
    distributed?.driver ?? envDriver ?? "level";
  const heartbeatIntervalMs =
    distributed?.heartbeatIntervalMs ??
    parseNumber(
      process.env.TIGER_DISTRIBUTED_HEARTBEAT_INTERVAL,
      DEFAULT_HEARTBEAT_INTERVAL
    );
  const heartbeatTimeoutMs =
    distributed?.heartbeatTimeoutMs ??
    parseNumber(
      process.env.TIGER_DISTRIBUTED_HEARTBEAT_TIMEOUT,
      DEFAULT_HEARTBEAT_TIMEOUT
    );
  const maxQueueLength =
    distributed?.maxQueueLength ??
    parseNumber(process.env.TIGER_DISTRIBUTED_MAX_QUEUE, 100);
  const levelDbPath = path.resolve(
    distributed?.levelDbPath ??
    process.env.TIGER_DISTRIBUTED_LEVEL_PATH ??
    DEFAULT_DISTRIBUTED_LEVEL_DB
  );
  return {
    driver,
    heartbeatIntervalMs,
    heartbeatTimeoutMs,
    maxQueueLength,
    levelDbPath,
  };
}

export function resolveInstanceId(config?: TigerConfig): string {
  return config?.instanceId ?? process.env.TIGER_INSTANCE_ID ?? nanoid();
}

export const DEFAULT_CONFIG: TigerConfig = {
  instanceId: process.env.TIGER_INSTANCE_ID,
  http: {
    port: Number(process.env.TIGER_HTTP_PORT ?? "9527"),
    host: process.env.TIGER_HTTP_HOST ?? "0.0.0.0"
  },
  monitor: {
    port: Number(process.env.TIGER_MONITOR_PORT ?? "9753"),
    host: process.env.TIGER_MONITOR_HOST ?? "0.0.0.0",
    disabled: process.env.TIGER_MONITOR_DISABLED === "1",
    dbPath: process.env.TIGER_MONITOR_DB ?? ".tiger-monitor"
  },
  cron: {
    pollIntervalMs: Number(process.env.TIGER_CRON_POLL_INTERVAL_MS ?? "1000"),
    requeueDelayMs: Number(process.env.TIGER_CRON_REQUEUE_DELAY_MS ?? "5000"),
    levelDbPath: process.env.TIGER_CRON_LEVEL_PATH ?? ".tiger-cron"
  },
  distributed: {
    driver: (process.env.TIGER_DISTRIBUTED_DRIVER in ["level", "postgres"] ? 
        process.env.TIGER_DISTRIBUTED_DRIVER as "level" | "postgres" : undefined) ?? "level",
    levelDbPath: process.env.TIGER_DISTRIBUTED_LEVEL_PATH ?? DEFAULT_DISTRIBUTED_LEVEL_DB,
    heartbeatIntervalMs: parseNumber(
      process.env.TIGER_DISTRIBUTED_HEARTBEAT_INTERVAL,
      DEFAULT_HEARTBEAT_INTERVAL
    ),
    heartbeatTimeoutMs: parseNumber(
      process.env.TIGER_DISTRIBUTED_HEARTBEAT_TIMEOUT,
      DEFAULT_HEARTBEAT_TIMEOUT
    ),
    maxQueueLength: parseNumber(process.env.TIGER_DISTRIBUTED_MAX_QUEUE, 100),
  },
};
