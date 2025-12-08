import type { ExtendedModule, Tiger, TigerPlugin } from "../tiger.js";
import { BaseResolver } from "../resolver.js";
import { getLogger, type Logger } from "../logger.js";
import { dispatchModule } from "../runner.js";

export type QueueModule<Param> = ExtendedModule<Param, any>;

class InMemoryQueue {
  private readonly logger: Logger;
  private registry = new Map<string, QueueModule<any>[]>();
  private queues = new Map<string, any[]>();
  private processing = new Set<string>();

  constructor(logger: Logger) {
    this.logger = logger;
  }

  register(path: string, module: QueueModule<any>) {
    const modules = this.registry.get(path) ?? [];
    modules.push(module);
    this.registry.set(path, modules);
    this.logger.info(`registered queue consumer for [${path}]`);
  }

  enqueue(path: string, payload: unknown) {
    const consumers = this.registry.get(path);
    if (!consumers || consumers.length === 0) {
      this.logger.warn(
        `message on [${path}] dropped because no consumers are registered`
      );
      return;
    }
    const queue = this.queues.get(path) ?? [];
    queue.push(payload);
    this.queues.set(path, queue);
    if (this.processing.has(path)) {
      return;
    }
    this.processing.add(path);
    void this._drain(path);
  }

  private async _drain(path: string) {
    const queue = this.queues.get(path);
    if (!queue) {
      this.processing.delete(path);
      return;
    }
    while (queue.length > 0) {
      const payload = queue.shift();
      const consumers = this.registry.get(path) ?? [];
      if (!consumers.length) {
        this.logger.warn(
          `message on [${path}] skipped because no consumers are registered`
        );
        continue;
      }
      for (const module of consumers) {
        try {
          await dispatchModule(module, payload);
        } catch (error) {
          this.logger.error(
            `queue consumer for [${path}] failed: ${
              error instanceof Error ? error.stack ?? error.message : String(error)
            }`
          );
        }
      }
    }
    this.processing.delete(path);
  }
}

class QueueResolver<Param> extends BaseResolver<Param, any> {
  readonly protocol: string;
  private readonly queue: InMemoryQueue;

  constructor(protocol: string, queue: InMemoryQueue) {
    super();
    this.protocol = protocol;
    this.queue = queue;
  }

  async define(path: string, module: QueueModule<Param>) {
    this.queue.register(path, module);
  }

  async notified(
    path: string,
    param: Param,
    _module: QueueModule<Param>
  ) {
    this.queue.enqueue(path, param);
  }
}


class QueuePlugin implements TigerPlugin {
  id: string = "queue";
  private logger = getLogger("queue");

  setup(tiger: Tiger): void {
    const queue = new InMemoryQueue(this.logger);
    const protocols = ["queue", "zmq"];
    for (const protocol of protocols) {
      tiger.register(new QueueResolver<any>(protocol, queue));
    }
    this.logger.info(
      `in-memory queue plugin initialized for protocols: ${protocols.join(", ")}`
    );
  }
}

export default new QueuePlugin();
