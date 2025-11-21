import { Tiger, http, cron, mail, example, zmq } from "../src/index.ts";

async function main() {
  const tiger = new Tiger({
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
    }
  });

  await tiger.use(http);
  await tiger.use(cron);
  await tiger.use(example);
  await tiger.use(mail);
  await tiger.use(zmq);

  await tiger.define<{ max?: number }, { number?: number }>({
    target: "example:hello",
    async process(_state, message) {
      const { number = 0 } = this.state();
      const { max = 0 } = message || {};
      if (number < max) {
        this.log("Continue");
      }
    }
  });

  await tiger.define<{}, {count: number}>({
    target: "cron:*/5 * * * * *",
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
