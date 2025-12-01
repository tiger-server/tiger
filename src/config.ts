import path from "node:path";

import type { TigerConfig } from "./types.ts";

const DEFAULT_HTTP_PORT = 9527;
const DEFAULT_HTTP_HOST = "0.0.0.0";
const DEFAULT_MONITOR_PORT = 9753;
const DEFAULT_MONITOR_HOST = "0.0.0.0";
const DEFAULT_MONITOR_BASE_PATH = "/tiger/monitor";
const DEFAULT_MONITOR_DB = ".tiger-monitor";
const DEFAULT_ZMQ_BIND = "tcp://0.0.0.0:9528";
const DEFAULT_ZMQ_CONNECT = "tcp://127.0.0.1:9528";
const DEFAULT_CRON_LEVEL_DB = ".tiger-cron";

function parseNumber(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function normalizeBasePath(input: string): string {
  if (!input) {
    return "/";
  }
  let normalized = input.trim();
  if (!normalized.startsWith("/")) {
    normalized = `/${normalized}`;
  }
  if (normalized.length > 1) {
    normalized = normalized.replace(/\/+$/, "");
    if (normalized === "") {
      normalized = "/";
    }
  }
  return normalized || "/";
}

export interface ResolvedHttpConfig {
  host: string;
  port: number;
}

export interface ResolvedMonitorConfig {
  host: string;
  port: number;
  basePath: string;
  disabled: boolean;
  dbPath: string;
}

export interface ResolvedCronConfig {
  redisUrl?: string;
  scheduleKey: string;
  pollIntervalMs: number;
  requeueDelayMs: number;
  levelDbPath: string;
}

export interface ResolvedZmqConfig {
  bindEndpoint: string;
  connectEndpoint: string;
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
  const basePath = normalizeBasePath(
    monitor.basePath ?? process.env.TIGER_MONITOR_BASE_PATH ?? DEFAULT_MONITOR_BASE_PATH
  );
  const disabled =
    monitor.disabled ?? process.env.TIGER_MONITOR_DISABLED === "1";
  const dbPath = path.resolve(
    monitor.dbPath ?? process.env.TIGER_MONITOR_DB ?? DEFAULT_MONITOR_DB
  );
  return { host, port, basePath, disabled, dbPath };
}

export function resolveCronConfig(config?: TigerConfig): ResolvedCronConfig {
  const cron = config?.cron ?? {};
  const redisUrl =
    cron.redisUrl ?? process.env.TIGER_CRON_REDIS_URL ?? undefined;
  const scheduleKey =
    cron.scheduleKey ??
    process.env.TIGER_CRON_SCHEDULE_KEY ??
    "tiger:cron:schedule";
  const pollIntervalMs =
    cron.pollIntervalMs ??
    parseNumber(process.env.TIGER_CRON_POLL_INTERVAL_MS, 1000);
  const requeueDelayMs =
    cron.requeueDelayMs ??
    parseNumber(process.env.TIGER_CRON_REQUEUE_DELAY_MS, 5000);
  const levelDbPath = path.resolve(
    cron.levelDbPath ?? process.env.TIGER_CRON_LEVEL_PATH ?? DEFAULT_CRON_LEVEL_DB
  );
  return { redisUrl, scheduleKey, pollIntervalMs, requeueDelayMs, levelDbPath };
}

export function resolveZmqConfig(config?: TigerConfig): ResolvedZmqConfig {
  const zmq = config?.zmq ?? {};
  const bindEndpoint =
    zmq.bindEndpoint ?? process.env.TIGER_ZMQ_BIND ?? DEFAULT_ZMQ_BIND;
  const connectEndpoint =
    zmq.connectEndpoint ??
    process.env.TIGER_ZMQ_CONNECT ??
    DEFAULT_ZMQ_CONNECT;
  return { bindEndpoint, connectEndpoint };
}
