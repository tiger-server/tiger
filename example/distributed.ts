import type { CronModule, ExampleModule } from "../src/index.ts";
import { defineServer } from "../src/tiger.ts";

export default defineServer(async (tiger) => {
    
  await tiger.define<ExampleModule, { count: number }>({
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
});