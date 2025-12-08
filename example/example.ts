import { Tiger, http, cron, example, queue } from "../src/index.ts";
import type { 
  HttpModule,
  CronModule,
  ExampleModule,
  QueueModule,
 } from "../src/index.ts";

async function main() {
  const tiger = new Tiger({
    instanceId: process.env.TIGER_INSTANCE_ID ?? "tiger-9753",
    http: {
      port: Number(process.env.TIGER_HTTP_PORT ?? "9527"),
      host: process.env.TIGER_HTTP_HOST ?? "0.0.0.0"
    },
    monitor: {
      port: Number(process.env.TIGER_MONITOR_PORT ?? "9753"),
      host: process.env.TIGER_MONITOR_HOST ?? "0.0.0.0",
      basePath: process.env.TIGER_MONITOR_BASE_PATH ?? "/tiger/monitor",
      disabled: process.env.TIGER_MONITOR_DISABLED === "1",
      dbPath: process.env.TIGER_MONITOR_DB ?? ".tiger-monitor"
    },
    cron: {
      pollIntervalMs: Number(process.env.TIGER_CRON_POLL_INTERVAL_MS ?? "1000"),
      requeueDelayMs: Number(process.env.TIGER_CRON_REQUEUE_DELAY_MS ?? "5000"),
      levelDbPath: process.env.TIGER_CRON_LEVEL_PATH ?? ".tiger-cron"
    },
    distributed: {
      driver: "postgres",
      levelDbPath:
        process.env.TIGER_DISTRIBUTED_LEVEL_PATH ?? ".tiger-distributed",
    }
  });

  await tiger.use(http);
  await tiger.use(cron);
  await tiger.use(example);
  await tiger.use(queue);

  await tiger.define<ExampleModule, { count: number }>({
    id: "distributed-hello",
    target: "example:hello",
    distributed: true,
    async process(_state, message) {
      const { number = 0, count = 0 } = this.state();
      const { max = 0 } = message || {};
      if (number < max) {
        this.log(`Continue, max ${max}, current ${number}`);
        return { number: number + count, count: count + 1};
      }
      return { number: 0, count: 0};
    }
  });

  await tiger.define<CronModule<{ count: number }>>({
    id: "distributed-scheduled-job",
    target: "cron:*/5 * * * * *",
    distributed: true,
    async process({ count = 0 }) {
      const nextCount = count + 1;
      await this.notify("queue:hello", { message: "hello world" });
      await this.notify("example:hello", { max: nextCount });
      return { count: nextCount };
    }
  });

  await tiger.define<HttpModule>({
    id: "request",
    target: "http:/hello",
    async process(_state, { res }) {
      res.send("success!");
    }
  });

  await tiger.define<QueueModule<{message: string}>>({
    target: "queue:hello",
    async process(_state, message) {
      this.log(JSON.stringify(message));
    }
  });

  await tiger.serve();
}

void main();
