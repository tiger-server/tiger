import { http, cron, example, queue, defineServer } from "../../src/index.js";
import type { HttpModule, ExampleModule, CronModule } from "../../src/index.js";

export default defineServer({
  instanceId: process.env.TIGER_INSTANCE_ID ?? "tiger-9753",
  // distributed: { driver: "postgres", },
}, async (tiger) => {
  await tiger.use(http, cron, example, queue);

  await tiger.define<ExampleModule, {count: number}>({
    id: "distributed-hello",
    target: "example:hello",
    distributed: true,
    async process(_state, message) {
      const { number = 0, count = 0 } = this.state();
      const { max = 0 } = message || {};
      if (number < max) {
        this.log(`Continue, max ${max}, current ${number}`);
        return { number: number + count, count: count + 1 };
      }
      return { number: 0, count: 0 };
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

  await tiger.define({
    target: "queue:hello",
    async process(_state, message) {
      this.log(JSON.stringify(message));
    }
  });
});