
import type { TigerPlugin, Tiger, ExtendedModule } from "../tiger.ts";
import { BaseResolver } from "../resolver.ts";
import { getLogger } from "../logger.ts";
import { processWithMutableState } from "./common.ts";

type ExampleModuleParam = { max: number };
type ExampleModuleState = { number: number };
export type ExampleModule = ExtendedModule<ExampleModuleParam, ExampleModuleState>;

export default new class implements TigerPlugin  {
  /**
   * cron protocol
   */
  id: string = "example";  
  _logger = getLogger("example");
  
  setup(tiger: Tiger): void {
    const logger = this._logger;
    tiger.register(new class extends BaseResolver<ExampleModuleParam, ExampleModuleState> {

      readonly protocol: string = "example";

      registry: { [key: string]: ExampleModule } = {};

      async define(path: string, _module: ExampleModule) {
        if (!this.registry[path]) {
          this.registry[path] = _module;
        }
      } 

      async notified(path: string, param: ExampleModuleParam, _module: ExampleModule, 
          next?: (path: string, param: object) => Promise<void>) {
        await this.run(_module, param)
        const result = _module.state();
        if (result.number !== 0 && next) {
          logger.info(`notifying next with state ${JSON.stringify(result)}`);
          await next(`${this.protocol}:${path}`, param);
        }
      }
      
      async run(
        _module: ExampleModule,
        param: ExampleModuleParam
      ) {
        await processWithMutableState(_module, param);
      }
    });
  }
}
