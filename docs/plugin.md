# Plugin

Tiger bundled with few standard plugins:

  - `cron`: for scheduled tasks,
  - `http`: for http request listeners,
  - `queue`: for in-memory message queue communication between modules,
  - `mail`: for sending out email.

## Plugin details

### `cron`

The `cron` plugin keeps its schedule in a persistent store. In single-node mode it writes to a LevelDB database on disk (default `.tiger-cron`), and when the distributed driver is set to `postgres` it stores the schedule inside Postgres so every instance cooperates automatically. Each time a job fires the next run is computed and persisted immediately, which keeps the cadence stable through restarts.

You can configure the scheduler either via the Tiger config or environment variables:

```ts
const tiger = new Tiger({
  cron: {
    pollIntervalMs: 1000,
    requeueDelayMs: 5000,
    levelDbPath: ".tiger-cron"
  }
});
```

Environment fallbacks are `TIGER_CRON_POLL_INTERVAL_MS`, `TIGER_CRON_REQUEUE_DELAY_MS`, and `TIGER_CRON_LEVEL_PATH`.

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


### `queue`

`queue` plugin creates in-memory queues to communicate between modules within the same process. Use `queue:` in `target` strings (legacy `zmq:` remains an alias) and emit messages via `Tiger#notify`. No external services or runtime-specific dependencies are required.

#### Attributes

| Attributes      | Value                           |
|-----------------|---------------------------------|
| Stateless       | N                               |
| Message         | Y                               |
| Messge Format   | what you sent in `Tiger#notify` |
| `define`?       | Y                               |
| `notify`?       | Y                               |

#### Example

**define**

```js
{
  target: "queue:hello",
  async process(state, message) {
    this.log(`Message received: ${JSON.stringify(message)}`)
  }
}
```

**notify**

```js
this.notify("queue:hello", { message: "hello, world" })
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

Set `distributed: true` and a stable `id` on any module to turn it into a distributed worker. Configure the top-level `distributed` block and pick a driver:

- `driver: "postgres"` (plus `DATABASE_URL`) enables the full multi-node queue/state registry backed by Postgres + Sequelize.
- `driver: "level"` keeps everything local on disk, which is useful when developing on one machine.

Each node:

- pushes new work into the distributed queue instead of executing immediately,
- pulls jobs from that queue and updates the shared module state stored via the persistence provider,
- heartbeats into the registry so stalled jobs are reassigned if a node goes offline for more than 10 s.

```ts
await tiger.define({
  id: "shared-worker",
  distributed: true,
  target: "http:/tasks",
  async process(state, { req, res }) {
    const count = (state.count ?? 0) + 1;
    await this.notify("queue:logs", { count });
    return { count };
  }
});

Once distributed mode is enabled, open `/tiger/manage` on the same host/port as the monitor to see every node’s heartbeat timestamp, enable/disable consumption, and call the management API (`/tiger/manage/api/nodes`) if you need to script toggles.

You can cap the backlog with `distributed.maxQueueLength` (env: `TIGER_DISTRIBUTED_MAX_QUEUE`, default `100`). When a module’s queue reaches that size, new jobs for that module are dropped rather than piling up indefinitely.
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
