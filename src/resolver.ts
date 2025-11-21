import type { ExtendedModule } from "./tiger.ts"

import { getLogger } from "./logger.ts"

export interface Resolver<Param, State> {
  readonly protocol: string
  define(
    path: string,
    _module: ExtendedModule<Param, State>
  ): Promise<void> | void
  notified(
    path: string,
    param: Param,
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
  async notified(path: string, param: Param): Promise<void> {
    const message = `entering empty notify resolver for ${path}, ${param}`
    this._logger.warn(message)
  }
}
