import path from "node:path";

import { cron, http, queue, defineServer } from "../../src/index.js";
import type { CronModule, HttpModule, QueueModule } from "../../src/index.js";

const basePath = process.env.TIGER_TEST_BASE ?? path.resolve(".tiger-single-mode");
const httpPort = Number(process.env.TIGER_TEST_HTTP_PORT ?? "19527");
const monitorPort = Number(process.env.TIGER_TEST_MANAGE_PORT ?? "19753");
const cronDbPath =
  process.env.TIGER_TEST_CRON_DB ?? path.join(basePath, "cron.db");
const monitorDbPath =
  process.env.TIGER_TEST_MONITOR_DB ?? path.join(basePath, "monitor.db");

export default defineServer(
  {
    instanceId: "single-node-test",
    http: { host: "127.0.0.1", port: httpPort },
    monitor: {
      host: "127.0.0.1",
      port: monitorPort,
      disabled: false,
      dbPath: monitorDbPath,
    },
    cron: {
      pollIntervalMs: 100,
      requeueDelayMs: 200,
      levelDbPath: cronDbPath,
    },
    // distributed intentionally omitted to exercise single-node mode
  },
  async (tiger) => {
    await tiger.use(http, cron, queue);

    await tiger.define<HttpModule>({
      id: "http-ping",
      target: "http:/ping",
      async process(_state, { res }) {
        res.json({ ok: true });
      },
    });

    await tiger.define<HttpModule>({
      id: "http-enqueue",
      target: "http:/enqueue",
      async process(_state, { res }) {
        await this.notify("queue:test", { from: "http" } as any);
        res.json({ queued: true });
      },
    });

    await tiger.define<QueueModule<{ from: string }>>({
      id: "queue-consumer",
      target: "queue:test",
      async process(_state, payload) {
        const { count = 0 } = this.state();
        this.state({ count: count + 1, lastFrom: payload?.from ?? "unknown" });
      },
    });

    await tiger.define<CronModule<{ tick: number }>>({
      id: "cron-tick",
      target: "cron:*/1 * * * * *",
      async process({ tick = 0 }) {
        const next = tick + 1;
        await this.notify("queue:test", { from: "cron" });
        return { tick: next };
      },
    });
  }
);
