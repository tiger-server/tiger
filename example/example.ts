import { Tiger, http, cron, mail, example, zmq } from "../src/index.ts";

async function main() {
  const tiger = new Tiger({
    http: {
      port: Number(process.env.TIGER_HTTP_PORT ?? "9527"),
      host: process.env.TIGER_HTTP_HOST ?? "0.0.0.0"
    },
    monitor: {
      port: Number(process.env.TIGER_MONITOR_PORT ?? "9753"),
      host: process.env.TIGER_MONITOR_HOST ?? "0.0.0.0",
      basePath: process.env.TIGER_MONITOR_BASE_PATH ?? "/tiger/monitor",
      disabled: process.env.TIGER_MONITOR_DISABLED === "1"
    },
    cron: {
      redisUrl: process.env.TIGER_CRON_REDIS_URL ?? "redis://127.0.0.1:6379",
      scheduleKey: process.env.TIGER_CRON_SCHEDULE_KEY ?? "tiger:example:cron",
      pollIntervalMs: Number(process.env.TIGER_CRON_POLL_INTERVAL_MS ?? "1000"),
      requeueDelayMs: Number(process.env.TIGER_CRON_REQUEUE_DELAY_MS ?? "5000")
    },
    zmq: {
      bindEndpoint: process.env.TIGER_ZMQ_BIND ?? "tcp://0.0.0.0:9528",
      connectEndpoint: process.env.TIGER_ZMQ_CONNECT ?? "tcp://127.0.0.1:9528"
    },
    mail: {
      sender: "sender@example.com",
      transport: {
        host: "smtp.example.com",
        port: 465,
        secure: true,
        auth: {
          user: "sender@example.com",
          pass: "password"
        }
      },
      channel: "mail:someone@another.com"
    },
    distributed: {
      redisUrl: "redis://127.0.0.1:6379",
    }
  });

  await tiger.use(http);
  await tiger.use(cron);
  await tiger.use(example);
  await tiger.use(mail);
  await tiger.use(zmq);

  await tiger.define<{ max?: number }, { number?: number, count?: number }>({
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

  await tiger.define<{}, {count: number}>({
    id: "distributed-scheduled-job",
    target: "cron:*/5 * * * * *",
    distributed: true,
    async process({ count = 0 }) {
      const nextCount = count + 1;
      await this.notify("zmq:hello", { message: "hello world" });
      await this.notify("example:hello", { max: nextCount });
      return { count: nextCount };
    }
  });

  await tiger.define<{ req: any; res: any }>({
    id: "request",
    target: "http:/hello",
    async process(_state, { req, res }) {
      res.send("success!");
    }
  });

  await tiger.define({
    target: "zmq:hello",
    async process(_state, message) {
      this.log(JSON.stringify(message));
    }
  });

  await tiger.serve();
}

void main();
