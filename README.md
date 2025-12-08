# tiger-server

<img src="./docs/1024px-Ghostscript_Tiger.png" width="250" height="250"/>

Tiger server is a very lightweight server for very simple process like webhooks.

## Usage

```
npm install tiger-server --save
```

and create `server.ts`:

```ts
import { Tiger, http, cron, queue } from "tiger-server";

async function main() {
  const tiger = new Tiger({
    instanceId: process.env.TIGER_INSTANCE_ID,
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
      pollIntervalMs: Number(process.env.TIGER_CRON_POLL_INTERVAL_MS ?? "1000"),
      requeueDelayMs: Number(process.env.TIGER_CRON_REQUEUE_DELAY_MS ?? "5000"),
      levelDbPath: process.env.TIGER_CRON_LEVEL_PATH ?? ".tiger-cron"
    },
    distributed: process.env.TIGER_DISTRIBUTED_DRIVER
      ? {
          driver: process.env.TIGER_DISTRIBUTED_DRIVER as "level" | "postgres",
          levelDbPath:
            process.env.TIGER_DISTRIBUTED_LEVEL_PATH ?? ".tiger-distributed"
        }
      : undefined
    }
  });

  await tiger.use(http);
  await tiger.use(cron);
  await tiger.use(queue);

  await tiger.define({
    id: "hello",
    target: "queue:hello",
    async process(_state, message) {
      this.log(`Message received: ${JSON.stringify(message)}`);
    }
  });

  await tiger.define({
    id: "cron",
    target: "cron:*/5 * * * * *",
    async process({ count = 0 }) {
      count++;
      await this.notify("queue:hello", { count });
      return { count }
    }
  });

  await tiger.define({
    id: "request",
    target: "http:/hello",
    async process(_state, { req, res }) {
      await this.notify("queue:hello", { message: "request recieved" });
      res.send("success!")
    }
  });

  await tiger.serve();
}

void main();
```

Run it with Node.js 22.6+:

```
node --experimental-strip-types server.ts
```

This relies on Node’s native TypeScript loader, so there is no build step and the code runs directly.

> The `http` plugin defaults to `0.0.0.0:9527`. Override `http.port`/`http.host` (or `TIGER_HTTP_PORT`/`TIGER_HTTP_HOST`) to run multiple Tiger instances side-by-side while sharing the same cron queue.

> The Monitor UI follows `monitor.host:monitor.port` (defaults `0.0.0.0:9753`). Tweak `monitor` config or `TIGER_MONITOR_*` env vars—or disable it entirely with `monitor.disabled`/`TIGER_MONITOR_DISABLED=1`.

> The `queue` plugin is now an in-memory message bus. It delivers `queue:` (or legacy `zmq:`) notifications to modules defined in the same process without any external socket or runtime-specific dependency.

> The `cron` plugin persists its schedule either in LevelDB (`cron.levelDbPath`, default `.tiger-cron`) or, when you run distributed mode with a Postgres driver, inside the shared Postgres database. Multiple Tiger processes simply read from the same store and pop due runs cooperatively.

> To build *distributed modules*, configure the `distributed` block. Set `distributed.driver` to `postgres` (and point `DATABASE_URL` to your Postgres instance) to enable a shared job/state store, or leave it as `level` for single-node experimentation. Every distributed module must declare an `id` and `distributed: true`; Tiger will enqueue work, persist state, and heartbeat the node registry through the configured persistence provider. Use `distributed.maxQueueLength` (default `100`) to keep runaway producers from filling the queue indefinitely.

> When running with the Postgres driver, apply the bundled Sequelize migrations (e.g. `DATABASE_URL=postgres://... npx sequelize-cli db:migrate`) before starting Tiger so the job, state, and registry tables exist.

> When distributed mode is enabled, a management dashboard and API are available at `/tiger/manage` on the same port as the monitor. It lists every node’s last heartbeat, whether it is enabled/disabled, and lets you pause or resume queue consumption for any node while it continues to report heartbeats and finish in-flight work.

> Logo is generated from [Wikipedia](https://en.wikipedia.org/wiki/File:Ghostscript_Tiger.svg), the original script is under GPL license.
