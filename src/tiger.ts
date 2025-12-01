
import { nanoid } from "nanoid";

import type { Resolver } from "./resolver.ts";
import type { TigerConfig, Module, Target } from "./types.ts";
import { getLogger, type Logger } from "./logger.ts";
import monitor, { configureMonitorServer } from "./monitor.ts";
import {
  resolveDistributedConfig,
  resolveMonitorConfig,
} from "./config.ts";
import { DISTRIBUTED_STATE_SYMBOL } from "./core/common.ts";
import {
  initDistributedCoordinator,
  getDistributedCoordinator,
} from "./distributed/index.ts";
import type { DistributedCoordinator } from "./distributed/controller.ts";

export type { TigerConfig, Module, Target } from "./types.ts";

function makeTargetFromString(target: string): Target {
  const EXTRACTOR = /(?<protocol>\w+):(?<path>.+)/;
  const { protocol, path } = EXTRACTOR.exec(target)!["groups"];
  return { protocol, path };
}

export type ExtendedModule<Param, State> = Module<Param, State> & Extension<Param, State>

export type TigerCall = (tiger: Tiger) => Promise<void> | void

export interface TigerPlugin {
  readonly id: string;
  setup(tiger: Tiger): Promise<void> | void
}

export class Tiger {

  readonly config: TigerConfig
  private _plugins: { [key: string]: TigerPlugin }
  private _modules: { [key: string]: Module<any, any> }
  private _resolvers: { [key: string]: Resolver<any, any> }
  private _state: { [key: string]: object };
  private _logger: Logger;
  private _instanceId: string;
  private _distributed?: DistributedCoordinator;

  private _postInitializeProcesses: Array<TigerCall>;

  constructor(config: TigerConfig = {}) {
    this.config = config;
    this._plugins = {};
    this._modules = {};
    this._resolvers = {};
    this._state = {};

    this._logger = getLogger("tiger");
    this._postInitializeProcesses = [];
    this._instanceId = nanoid();
    configureMonitorServer(resolveMonitorConfig(this.config));
  }

  async use(plugin: TigerPlugin): Promise<Tiger> {
    if (this._plugins[plugin.id] === undefined) {
      this._plugins[plugin.id] = plugin;
      await plugin.setup(this)
    } else {
      this._warn(`Existed plugin: ${plugin.id}`)
    }
    return this;
  }

  async define<Param = object, State = object>(_module: Module<Param, State>) {
    if (_module.distributed && !_module.id) {
      throw new Error(
        "Distributed modules must provide a stable id in their definition"
      );
    }
    _module.id = _module.id || nanoid();

    const extended = Object.assign(_module, this._handlerAdapter(_module));

    this._modules[_module.id] = extended;
    await monitor.registerModule(extended);
    if (extended.distributed) {
      this._ensureDistributed().registerModule(extended);
    }

    const target = makeTargetFromString(extended.target);
    const { path, protocol } = target;

    const resolver = this._resolvers[protocol]

    if (resolver && resolver.define) {
      await resolver.define(path, extended);
    } else {
      this._warn(`No valid definition handler found for protocol [${protocol}]`)
    }
  }

  private async _notify<Param>(from: string, target: string, param: Param) {
    this._log(`Notifying target: ${target}`, `tiger:${from}`)

    const { protocol, path } = makeTargetFromString(target);
    const resolver = this._resolvers[protocol]

    if (resolver && resolver.notified) {
      await resolver.notified(path, param, async (path, param) => {
        await this._notify(target, path, param);
      })
    } else {
      this._warn(`No valid notification handler found for protocol [${protocol}]`)
    }
  }

  register<Param, State>(resolver: Resolver<Param, State>): void {
    this._resolvers[resolver.protocol] = resolver;
  }

  private _stat(key: string, value?: object): object {
    if (value) {
      this._state[key] = { ...this._state[key], ...value }
    } else {
      return (this._state[key] || {})
    }
  }

  async serve() {
    for (const process of this._postInitializeProcesses) {
      await process(this);
    }
  }

  private _log(log: string, scope?: string) {
    this._logger.info(`${scope ? `[${scope}] -- `: ""}${log}`);
  }
  private _error(log: string, scope?: string) {
    this._logger.error(`${scope ? `[${scope}] -- `: ""}${log}`);
  }
  private _warn(log: string, scope?: string) {
    this._logger.warn(`${scope ? `[${scope}] -- `: ""}${log}`);
  }

  private _ensureDistributed(): DistributedCoordinator {
    if (!this._distributed) {
      const config = resolveDistributedConfig(this.config);
      if (!config) {
        throw new Error(
          "Distributed modules require a distributed.redisUrl configuration"
        );
      }
      const logger = getLogger("distributed");
      this._distributed = initDistributedCoordinator(
        config,
        this._instanceId,
        logger
      );
    }
    return this._distributed;
  }

  _handlerAdapter<Param, State>(handler: Module<Param, State>) {
    const tiger = this;
    return {
      notify<T>(target: string, param: T) {
        return tiger._notify(handler.id, target, param);
      },
      
      log(message: string) {
        tiger._log(message, handler.id);
      },

      error(message: string) {
        tiger._error(message, handler.id);
      },
  
      state(data?: Partial<State>): State {
        const { id } = handler;
        if (handler.distributed) {
          const cache =
            ((handler as any)[DISTRIBUTED_STATE_SYMBOL] as object | undefined) ??
            {};
          (handler as any)[DISTRIBUTED_STATE_SYMBOL] = cache;
          if (data) {
            Object.assign(cache, data as object);
          }
          return cache as State;
        }
        if (data) {
          return tiger._stat(id, {
            ...tiger._stat(id),
            ...(data as object),
          }) as any as State;
        }
        return tiger._stat(id) as any as State;
      },
    }
  }

}

export type Extension<Param, State> = {
  notify(target: string, param: Param): Promise<void>;
  log(message: string): void;
  error(message: string): void;
  state(data?: Partial<State>): State;
}
