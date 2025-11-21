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
  const tiger = new Tiger({});

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


> Logo is generated from [Wikipedia](https://en.wikipedia.org/wiki/File:Ghostscript_Tiger.svg), the original script is under GPL license.
