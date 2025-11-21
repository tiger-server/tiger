
import type { ExtendedModule } from "./tiger.ts"

import { getLogger } from "./logger.ts"

export interface Resolver<Param, State> {
  readonly protocol: string
  define(path: string, _module: ExtendedModule<Param, State>): void
  notified(path: string, param: Param, next?: (path: string, param: object) => void): void
}

export abstract class BaseResolver<Param, State> implements Resolver<Param, State> {
  abstract readonly protocol: string

  private _logger = getLogger("base-resolver")

  define(path: string, _module: ExtendedModule<Param, State>): void {
    this._logger.warn(`entering empty definition resolver for ${path}, ${_module.id}`)
  }
  notified(path: string, param: Param): void {
    const message = `entering empty notify resolver for ${path}, ${param}`;
    this._logger.warn(message);
  }
}
