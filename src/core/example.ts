
import type { TigerPlugin, Tiger, ExtendedModule, makeTargetFromString } from "../tiger.ts";
import { BaseResolver } from "../resolver.ts";
import { getLogger } from "../logger.ts";
import { processWithMutableState } from "./common.ts";

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

      async notified(path: string, param: {max: number}, _module: ExtendedModule<{ max: number }, { number: number }>, 
          next?: (path: string, param: object) => Promise<void>) {
        await this.run(_module, param)
        const result = _module.state();
        if (result.number !== 0 && next) {
          logger.info(`notifying next with state ${JSON.stringify(result)}`);
          await next(`${this.protocol}:${path}`, param);
        }
      }
      
      async run(
        _module: ExtendedModule<{ max: number }, { number: number }>,
        param: { max: number }
      ) {
        await processWithMutableState(_module, param);
      }
    });
  }
}
