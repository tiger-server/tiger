import { http, cron, example, queue, defineServer } from "../src/index.js";
import type { HttpModule } from "../src/core/index.js";

import distributed from "./distributed.js";

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

  await tiger.define({
    target: "queue:hello",
    async process(_state, message) {
      this.log(JSON.stringify(message));
    }
  });
});