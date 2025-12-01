# Plugin

Tiger bundled with few standard plugins:

  - `cron`: for scheduled tasks,
  - `http`: for http request listeners,
  - `zmq`: for using message queue communication between modules,
  - `mail`: for sending out email.

## Plugin details

### `cron`

The `cron` plugin now schedules work through Redis, so every Tiger instance connected to the same Redis sorted set will race to claim the next due job. When a module is triggered its next run is immediately enqueued again, which keeps scheduling accurate even across process restarts. Make sure a Redis server is reachable before calling `tiger.use(cron)`.

You can configure the scheduler either via the Tiger config or environment variables:

```ts
const tiger = new Tiger({
  cron: {
    redisUrl: "redis://127.0.0.1:6379",
    scheduleKey: "tiger:cron:schedule",
    pollIntervalMs: 1000,
    requeueDelayMs: 5000,
    levelDbPath: ".tiger-cron"
  }
});
```

Environment fallbacks are `TIGER_CRON_REDIS_URL`, `TIGER_CRON_SCHEDULE_KEY`, `TIGER_CRON_POLL_INTERVAL_MS`, `TIGER_CRON_REQUEUE_DELAY_MS`, and `TIGER_CRON_LEVEL_PATH`.

If `redisUrl` isn’t provided the scheduler degrades gracefully into a single-node mode using a LevelDB queue at `levelDbPath`.

It only takes effect when you define a module on the `cron:` protocol. It doesn't provide any messages but mutates the module state when a schedule fires.

#### Attributes

| Attributes    	| Value 	|
|---------------	|-------	|
| Stateless     	| N     	|
| Message       	| N     	|
| Messge Format 	| {}    	|
| `define`?     	| Y     	|
| `notify`?     	| N     	|

#### Example

**define**

```js
{
  target: "cron:*/5 * * * * *", 

  async process({ count = 0 }) {
    count++;
    return { count }
  }
}
```

### `http`

`http` plugin allows you runs on a specific http path on Tiger server. `http` plugin is stateful and provide both a HTTP request and a response object as message to the module.

Configure the listening socket via `tiger.config.http` or `TIGER_HTTP_HOST`/`TIGER_HTTP_PORT`. Defaults are `0.0.0.0:9527`, which means you can run several Tiger instances on the same machine by pointing each one at a different port.

#### Attributes

| Attributes    	| Value           	|
|---------------	|-----------------	|
| Stateless     	| N               	|
| Message       	| Y               	|
| Messge Format 	| `{ req, res }`  	|
| `define`?     	| Y               	|
| `notify`?     	| N               	|

#### Example

**define**

```js
{
  target: "http:hello", 
  async process(state, {req, res}) {
    res.send("hello world");
    return state;
  }
}
```


### `zmq`

`zmq` plugin creates a set of queues to communicate between modules.
You can either create a module follows a queue, or send messages to the queue in any module(with `Tiger#notify`).

Configure the ZeroMQ sockets per instance:

```ts
const tiger = new Tiger({
  zmq: {
    bindEndpoint: "tcp://0.0.0.0:9528",
    connectEndpoint: "tcp://127.0.0.1:9528"
  }
});
```

Environment fallbacks `TIGER_ZMQ_BIND` and `TIGER_ZMQ_CONNECT` remain available.

#### Attributes

| Attributes    	| Value                           	|
|---------------	|---------------------------------	|
| Stateless     	| N                               	|
| Message       	| Y                               	|
| Messge Format 	| what you sent in `Tiger#notify` 	|
| `define`?     	| Y                               	|
| `notify`?     	| Y                               	|

#### Example

**define**

```js
{
  target: "zmq:hello", 
  async process(state, message) {
    this.log(`Message received: ${JSON.stringify(message)}`)
  }
}
```

**notify**

```js
this.notify("zmq:hello", { message: "hello, world" })
```

### `mail`

`mail` plugin allow you send out email to any known address after configured a email transport.

Here is required configurations:

```js
{
  mail: {
    sender: "email@example.com",
    transport: {
      host: "some.smtp.server.com",
      port: 465,
      secure: true,
      auth: {
        user: "email@example.com",
        pass: "password"
      }
    }
  }
}
```

#### Attribute

| Attributes    	| Value                             	  |
|---------------	|-------------------------------------	|
| Stateless     	| Y                                 	  |
| Message       	| Y                                 	  |
| Messge Format 	| `{ from, to, subject, text, html }` 	|
| `define`?     	| N                                 	  |
| `notify`?     	| Y                                 	  |

#### Example

```js
// `from` and `to` can be omitted since it can be inferred from sender and target.
await this.notify("mail:someone@another.com", { 
  subject: "hello", 
  text: "hello world", 
  html: "<p>hello world</p>" 
});
```

### Distributed modules

Set `distributed: true` and a stable `id` on any module to turn it into a distributed worker. Configure `distributed.redisUrl` (or `TIGER_DISTRIBUTED_REDIS_URL`) so Tiger instances can coordinate through Redis. Each node:

- pushes new work into the module’s Redis queue instead of executing immediately,
- pulls jobs from that queue and updates the shared module state stored in Redis,
- heartbeats into a registry so stalled jobs are reassigned if a node goes offline for more than 10 s.

```ts
await tiger.define({
  id: "shared-worker",
  distributed: true,
  target: "http:/tasks",
  async process(state, { req, res }) {
    const count = (state.count ?? 0) + 1;
    await this.notify("zmq:logs", { count });
    return { count };
  }
});
```

## Self-defined Plugins

### How plugin works

A plugin is just a function which takes tiger instance as argument and do some dirty work, including but not limited to register a new resolver.

```js
const somePlugin = {
  id: "<plugin id>"
  setup: async function(tiger) {
    const resolver = {
      protocol: "<protocol>",
      async define(path, module) {
        // do async definition work
      },

      async notified(path, param, next) {
        // do async notification work
      }
    },

    tiger.register(resolver)
  }
}
```

You can also use `Plugin` and `Resolver` interface with TypeScript 
for better hinting. Also `BaseResolver` provided an default implementaion 
for `define()` and `notified()` method.

See `src/core/example.ts` for an example. 
