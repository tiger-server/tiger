# tiger-server

<img src="./docs/1024px-Ghostscript_Tiger.png" width="250" height="250"/>

Tiger server is a very lightweight server for very simple process like webhooks.

## Usage

```
npm install tiger-server --save
```

and create `server.ts`:

```ts
import { Tiger, http, cron, mail, zmq } from "tiger-server";

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
      scheduleKey: process.env.TIGER_CRON_SCHEDULE_KEY ?? "tiger:cron:schedule"
    },
    zmq: {
      bindEndpoint: process.env.TIGER_ZMQ_BIND ?? "tcp://0.0.0.0:9528",
      connectEndpoint: process.env.TIGER_ZMQ_CONNECT ?? "tcp://127.0.0.1:9528"
    }
  });

  await tiger.use(http);
  await tiger.use(cron);
  await tiger.use(mail);
  await tiger.use(zmq);

  await tiger.define({
    id: "hello",
    target: "zmq:hello",
    async process(_state, message) {
      this.log(`Message received: ${JSON.stringify(message)}`);
    }
  });

  await tiger.define({
    id: "cron",
    target: "cron:*/5 * * * * *",
    async process({ count = 0 }) {
      count++;
      await this.notify("zmq:hello", { count });
      return { count }
    }
  });

  await tiger.define({
    id: "request",
    target: "http:/hello",
    async process(_state, { req, res }) {
      await this.notify("zmq:hello", { message: "request recieved" });
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

> The `zmq` plugin binds to `zmq.bindEndpoint` and connects with `zmq.connectEndpoint` (env fallbacks `TIGER_ZMQ_BIND`/`TIGER_ZMQ_CONNECT`), so you can run multiple instances without port conflicts.

> The `cron` plugin coordinates schedules via Redis. Start a Redis server (or point `TIGER_CRON_REDIS_URL` at your cluster) before running Tiger if you use cron modules. Multiple Tiger instances can share the same Redis queue and will cooperatively claim jobs. If you omit `cron.redisUrl`, Tiger falls back to a local LevelDB queue stored at `TIGER_CRON_LEVEL_PATH` (defaults to `.tiger-cron`), which is ideal for single-node setups.

> Logo is generated from [Wikipedia](https://en.wikipedia.org/wiki/File:Ghostscript_Tiger.svg), the original script is under GPL license.
