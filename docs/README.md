# Tiger

<img src="./1024px-Ghostscript_Tiger.png" width="250" height="250"/>

Tiger is a simple framework of lightweight process.

## Use cases

 - Web hooks,
 - Simple timer-based job,
 - Simple aggregating and distributing workers.

see [Structure](./structure.md) and [Plugin](./plugin.md) for more information.


> Logo is generated from [Wikipedia](https://en.wikipedia.org/wiki/File:Ghostscript_Tiger.svg), the original script is under GPL license.

## Usage

```
npm install tiger-server --save
```

and create `server.ts`:

```typescript
import { defineServer, http, cron, queue } from "tiger-server";
import type { QueueModule, CronModule, HttpModule } from "tiger-server";

export default defineServer(async (tiger) => {
  await tiger.use(http, cron, queue);

  await tiger.define<QueueModule<{message: string}>>({
    id: "hello",
    target: "queue:hello",
    async process(_state, message) {
      this.log(`Message received: ${JSON.stringify(message)}`);
    }
  });

  await tiger.define<CronModule<{count: number}>>({
    id: "cron",
    target: "cron:*/5 * * * * *",
    async process({ count = 0 }) {
      count++;
      await this.notify("queue:hello", { count });
      return { count }
    }
  });

  await tiger.define<HttpModule>({
    id: "request",
    target: "http:/hello",
    async process(_state, { req, res }) {
      await this.notify("queue:hello", { message: "request recieved" });
      res.send("success!")
    }
  });
});
```

Run it with Node.js 22.6+:

```
npx tiger-server run server.ts
```
