import type { ExtendedModule } from "./tiger.ts"

import { getLogger } from "./logger.ts"
import { processWithMutableState } from "./core/common.ts"

export interface Resolver<Param, State> {
  readonly protocol: string
  define(
    path: string,
    _module: ExtendedModule<Param, State>
  ): Promise<void> | void
  notified(
    path: string,
    param: Param,
    module: ExtendedModule<Param, State>,
    next?: (path: string, param: object) => Promise<void>
  ): Promise<void> | void
}

export abstract class BaseResolver<Param, State>
  implements Resolver<Param, State>
{
  abstract readonly protocol: string

  private _logger = getLogger("base-resolver")

  async define(
    path: string,
    _module: ExtendedModule<Param, State>
  ): Promise<void> {
    this._logger.warn(
      `entering empty definition resolver for ${path}, ${_module.id}`
    )
  }

  async notified(path: string, param: Param, _module: ExtendedModule<Param, State>): Promise<void> {
    this._logger.info(
      `notified module ${_module.id} at ${this.protocol}:${path} with param ${JSON.stringify(param)}`
    );
    processWithMutableState(_module, param);
  }
}
