import { Tiger, http, cron, mail, example, zmq } from "../src/index.ts";

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

tiger.use(http);
tiger.use(cron);
tiger.use(example);
tiger.use(mail);
tiger.use(zmq);

tiger.define<{ max?: number }, { number?: number }>({
  target: "example:hello",
  process: function (_state, message) {
    const { number = 0 } = this.state();
    const { max = 0 } = message || {};
    if (number < max) {
      this.log("Continue");
    }
  }
});

tiger.define<object, { count: number }>({
  target: "cron:*/5 * * * * *",
  process: function ({ count = 0 }) {
    const nextCount = count + 1;
    this.notify("zmq:hello", { message: "hello world" });
    this.notify("example:hello", { max: nextCount });
    return { count: nextCount };
  }
});

tiger.define<{ req: any; res: any }>({
  id: "request",
  target: "http:/hello",
  process: function (_state, { req, res }) {
    res.send("success!");
  }
});

tiger.define({
  target: "zmq:hello",
  process: function (_state, message) {
    this.log(JSON.stringify(message));
  }
});

tiger.serve();
