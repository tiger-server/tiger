/// <reference lib="dom" />
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";

const fetchFn = (globalThis as any).fetch as typeof fetch;
const MANAGEMENT_SHUTDOWN_PATH = "/tiger/manage/api/shutdown";
const MONITOR_API_PATH = "/tiger/monitor/api/modules";

async function getFreePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      if (typeof address === "object" && address?.port) {
        const { port } = address;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error("Unable to acquire port")));
      }
    });
  });
}

async function waitFor<T>(
  fn: () => Promise<T | undefined | false>,
  timeoutMs = 10_000,
  intervalMs = 100
): Promise<T> {
  const start = Date.now();
  while (true) {
    const result = await fn();
    if (result) {
      return result as T;
    }
    if (Date.now() - start >= timeoutMs) {
      throw new Error("Timed out waiting for condition");
    }
    await delay(intervalMs);
  }
}

function startServerProcess(
  httpPort: number,
  monitorPort: number,
  baseDir: string
) {
  const env = {
    ...process.env,
    TIGER_TEST_HTTP_PORT: String(httpPort),
    TIGER_TEST_MANAGE_PORT: String(monitorPort),
    TIGER_TEST_BASE: baseDir,
    TIGER_TEST_CRON_DB: path.join(baseDir, "cron.db"),
    TIGER_TEST_MONITOR_DB: path.join(baseDir, "monitor.db"),
    TIGER_DISTRIBUTED_LEVEL_PATH: path.join(baseDir, "distributed.db"),
  };
  const child = spawn(
    process.execPath,
    [path.join("lib", "test", "runtime", "single-node-server.js")],
    { env, stdio: ["ignore", "pipe", "pipe"] }
  );
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  return { child, stderrRef: () => stderr };
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetchFn(url);
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

test(
  "single-node plugins respond via http, queue, and cron",
  { timeout: 20_000 },
  async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tiger-single-"));
    const httpPort = await getFreePort();
    const monitorPort = await getFreePort();
    const { child, stderrRef } = startServerProcess(
      httpPort,
      monitorPort,
      tmpDir
    );

    const httpBase = `http://127.0.0.1:${httpPort}`;
    const monitorBase = `http://127.0.0.1:${monitorPort}`;

    const cleanup = async () => {
      try {
        await fetchFn(monitorBase + MANAGEMENT_SHUTDOWN_PATH, { method: "POST" });
      } catch {
        // ignore shutdown failures
      }
      await Promise.race([
        once(child, "exit"),
        delay(2_000).then(() => {
          child.kill("SIGKILL");
        }),
      ]);
      await fs.rm(tmpDir, { recursive: true, force: true });
    };

    try {
      await waitFor(async () => {
        try {
          const res = await fetchFn(`${httpBase}/ping`);
          return res.ok;
        } catch {
          return false;
        }
      });

      await fetchFn(`${httpBase}/enqueue`);
      await fetchFn(`${httpBase}/enqueue`);

      const modules = await waitFor(async () => {
        try {
          const payload = await fetchJson<{ modules: any[] }>(
            `${monitorBase}${MONITOR_API_PATH}?n=20`
          );
          const { modules } = payload;
          const ping = modules.find((mod) => mod.id === "http-ping");
          const enqueue = modules.find((mod) => mod.id === "http-enqueue");
          const queue = modules.find((mod) => mod.id === "queue-consumer");
          const cron = modules.find((mod) => mod.id === "cron-tick");
          if (
            ping?.runCount >= 1 &&
            enqueue?.runCount >= 2 &&
            queue?.runCount >= 2 &&
            cron?.runCount >= 1
          ) {
            return { ping, enqueue, queue, cron };
          }
          return undefined;
        } catch {
          return undefined;
        }
      });

      assert.ok(modules.ping.runCount >= 1, "http ping should run at least once");
      assert.ok(
        modules.enqueue.runCount >= 2,
        "http enqueue should run twice"
      );
      assert.ok(
        modules.queue.state?.count >= 2,
        "queue consumer should process two messages"
      );
      assert.ok(
        modules.cron.runCount >= 1,
        "cron job should execute at least once"
      );
    } catch (error) {
      error.message = `${error.message}\nstderr:\n${stderrRef()}`;
      throw error;
    } finally {
      await cleanup();
    }
  }
);
