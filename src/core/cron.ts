
import { processWithMutableState } from "./common.ts"
import type { TigerPlugin, Tiger, ExtendedModule } from "../tiger.ts";
import { BaseResolver } from "../resolver.ts"

import nodeCron from "node-cron";
import { getLogger, type Logger } from "../logger.ts";

export default new class implements TigerPlugin  {
  /**
   * cron protocol
   */
  id: string = "cron";  
  
  _logger: Logger = getLogger("cron")

  setup(tiger: Tiger): void {
    const logger = this._logger
    logger.info("initializing cron plugin")
    tiger.register(new class extends BaseResolver<object, object> {
      readonly protocol: string = "cron";
      define(path: string, _module: ExtendedModule<object, object>) {
        logger.info(`creating schedule [${path}] on module ${_module.id}`)
        nodeCron.schedule(path, function() {
          logger.info(`invoking job ${_module.id} with schedule ${path}`)
          processWithMutableState(_module, {});
        })
      }
    });
  }
}
