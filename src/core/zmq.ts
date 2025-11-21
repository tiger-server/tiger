import type { TigerPlugin, Tiger, ExtendedModule } from "../tiger.ts";
import { BaseResolver } from "../resolver.ts"

import { processWithMutableState } from "./common.ts";
import { Publisher, Subscriber } from "zeromq"
import { getLogger, type Logger } from "../logger.ts";

const DEFAULT_BIND_ENDPOINT = process.env.TIGER_ZMQ_BIND ?? "tcp://0.0.0.0:9528";
const DEFAULT_CONNECT_ENDPOINT = process.env.TIGER_ZMQ_CONNECT ?? "tcp://127.0.0.1:9528";

export default new class implements TigerPlugin  {
  id: string = "zmq";  
  _logger: Logger = getLogger("zmq")
  
  async setup(tiger: Tiger): Promise<void> {
    const publisher = new Publisher();
    const logger = this._logger;
    logger.info("initializing zmq plugin")

    await publisher.bind(DEFAULT_BIND_ENDPOINT);
    logger.info(`zmq publisher bound to ${DEFAULT_BIND_ENDPOINT}`);

    tiger.register(new class extends BaseResolver<any, any> {

      readonly protocol: string = "zmq";
      private registry: Map<string, ExtendedModule<any, any>> = new Map();
      private subscribers: Map<string, Subscriber> = new Map();

      async define(path: string, _module: ExtendedModule<any, any>) {
        this.registry.set(path, _module);
        if (!this.subscribers.has(path)) {
          const subscriber = new Subscriber();
          await subscriber.connect(DEFAULT_CONNECT_ENDPOINT);
          await subscriber.subscribe(path);
          logger.info(`subscriber created for topic [${path}]`);
          this.subscribers.set(path, subscriber);
          this.consumeMessages(path, subscriber);
        }
      } 

      private consumeMessages(path: string, subscriber: Subscriber) {
        (async () => {
          for await (const [topicBuf, messageBuf] of subscriber) {
            const topic = topicBuf.toString();
            if (topic !== path) {
              continue;
            }
            const module = this.registry.get(path);
            if (!module) {
              continue;
            }
            const message =
              messageBuf && messageBuf.length > 0
                ? JSON.parse(Buffer.from(messageBuf).toString())
                : {};
            await processWithMutableState(module, message);
          }
        })().catch(error => {
          logger.error(`subscriber for topic [${path}] failed: ${error}`);
        });
      }

      async notified(path: string, param) {
        logger.info(`message received on channel [${path}]: ${JSON.stringify(param)}`)
        await publisher.send([path, JSON.stringify(param)])
      }
    });
  }
}
