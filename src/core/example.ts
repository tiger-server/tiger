
import type { TigerPlugin, Tiger, ExtendedModule } from "../tiger.ts";
import { BaseResolver } from "../resolver.ts";
import { getLogger } from "../logger.ts";
import { dispatchModule } from "../runner.ts";

export default new class implements TigerPlugin  {
  /**
   * cron protocol
   */
  id: string = "example";  
  _logger = getLogger("example");
  
  setup(tiger: Tiger): void {
    const logger = this._logger;
    tiger.register(new class extends BaseResolver<{ max: number }, { number: number }> {
      readonly protocol: string = "example";

      registry: { [key: string]: ExtendedModule<{ max: number }, { number: number }> } = {};

      async define(path: string, _module: ExtendedModule<{ max: number }, { number: number }>) {
        if (!this.registry[path]) {
          this.registry[path] = _module;
        }
      } 

      async notified(path: string, param: {max: number}, next?: (path: string, param: object) => Promise<void>) {
        if (this.registry[path]) {
          const _module = this.registry[path];
          await this.run(_module, param)
          const result = _module.state();
          if (result.number !== 0 && next) {
            logger.info(`notifying next with state ${JSON.stringify(result)}`);
            await next(`${this.protocol}:${path}`, param);
          }
        }
      }

      async run(
        _module: ExtendedModule<{ max: number }, { number: number }>,
        param: { max: number }
      ) {
        await dispatchModule(_module, param);
      }
    });
  }
}
