import { http, cron, example, queue, defineServer } from "../src/index.ts";
import type {
  HttpModule,
  QueueModule,
} from "../src/index.ts";

import distributed from "./distributed.ts";

export default defineServer({
  instanceId: process.env.TIGER_INSTANCE_ID ?? "tiger-9753",
  // distributed: { driver: "postgres", },
}, async (tiger) => {
  await tiger.use(http, cron, example, queue);

  await tiger.apply(distributed);
  
  await tiger.define<HttpModule>({
    id: "request",
    target: "http:/hello",
    async process(_state, { res }) {
      res.send("success!");
    }
  });

  await tiger.define<QueueModule<{ message: string }>>({
    target: "queue:hello",
    async process(_state, message) {
      this.log(JSON.stringify(message));
    }
  });
});