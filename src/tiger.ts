
import path from "node:path";

import { nanoid } from "nanoid";

import type { Resolver } from "./resolver.js";
import type { TigerConfig, Module, Target } from "./types.js";
import { getLogger, type Logger } from "./logger.js";
import monitor, { configureMonitorServer, MANAGEMENT_BASE_PATH, configureManagementProvider, MONITOR_BASE_PATH } from "./monitor.js";
import {
  resolveDistributedConfig,
  resolveMonitorConfig,
  resolveInstanceId,
} from "./config.js";
import { DISTRIBUTED_STATE_SYMBOL } from "./core/common.js";
import {
  initDistributedCoordinator,
} from "./distributed/index.js";
import type { DistributedCoordinator } from "./distributed/controller.js";
import { createPersistenceProvider } from "./persistence/provider.js";
import type { PersistenceProvider } from "./persistence/index.js";

export type { TigerConfig, Module, Target } from "./types.js";

export function makeTargetFromString(target: string): Target {
  const EXTRACTOR = /(?<protocol>\w+):(?<path>.+)/;
  const { protocol, path } = EXTRACTOR.exec(target)!["groups"];
  return { protocol, path };
}

export type ExtendedModule<Param, State> = Module<Param, State> & Extension<Param, State>

type ModuleParam<M> = M extends Module<infer P, any> ? P : never;
type ModuleState<M> = M extends Module<any, infer S> ? S : never;

export type TigerCall = (tiger: Tiger) => Promise<void> | void

export type TigerSetup = {
  config?: TigerConfig,
  call: TigerCall
};

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
  private _distributedConfig?: ReturnType<typeof resolveDistributedConfig>;
  private _monitorConfig: ReturnType<typeof resolveMonitorConfig>;
  private _targetModules: Record<string, ExtendedModule<any, any>[]> = {};
  private _persistence: PersistenceProvider;

  private _postInitializeProcesses: Array<TigerCall>;

  constructor(config: TigerConfig = {}) {
    this.config = config;
    this._plugins = {};
    this._modules = {};
    this._resolvers = {};
    this._state = {};

    this._logger = getLogger("tiger");
    this._postInitializeProcesses = [];
    this._instanceId = resolveInstanceId(this.config);
    this._monitorConfig = resolveMonitorConfig(this.config);
    configureMonitorServer(this._monitorConfig);

    this._distributedConfig = resolveDistributedConfig(this.config);
    const persistenceDriver =
      this._distributedConfig?.driver ??
      this.config.distributed?.driver ??
      "level";
    const levelPath =
      this._distributedConfig?.levelDbPath ??
      path.resolve(
        this.config.distributed?.levelDbPath ??
        process.env.TIGER_DISTRIBUTED_LEVEL_PATH ??
        ".tiger-level"
      );
    this._persistence = createPersistenceProvider({
      driver: persistenceDriver,
      levelPath,
    });
    this._postInitializeProcesses.push(async () => {
      await this._persistence.start();
    });
    configureManagementProvider(this._persistence);

    if (this._distributedConfig) {
      this._postInitializeProcesses.push(async () => {
        this._ensureDistributed();
      });
    }
  }

  async use(...plugins: TigerPlugin[]): Promise<Tiger> {
    for (const plugin of plugins) {
      if (this._plugins[plugin.id] === undefined) {
        this._plugins[plugin.id] = plugin;
        await plugin.setup(this)
      } else {
        this._warn(`Existed plugin: ${plugin.id}`)
      }
    }
    return this;
  }

  async define<M, State = object>(_module: Module<ModuleParam<M>, ModuleState<M> & State>) {
    if (_module.distributed && !_module.id) {
      throw new Error(
        "Distributed modules must provide a stable id in their definition"
      );
    }
    _module.id = _module.id || nanoid();

    const extended = Object.assign(_module, this._handlerAdapter(_module));

    this._modules[_module.id] = extended;
    (this._targetModules[extended.target] ??= []).push(extended);
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
    const targetModule =
      this._targetModules[target]?.find((mod) => mod.id === from) ??
      this._targetModules[target]?.[0] ??
      this._modules[from];

    if (await this._enqueueDistributed(target, param)) {
      return;
    }

    if (resolver && resolver.notified) {
      await resolver.notified(
        path,
        param,
        targetModule as any,
        async (nextTarget, nextParam) => {
          const handled = await this._enqueueDistributed(nextTarget, nextParam);
          if (!handled) {
            await this._notify(target, nextTarget, nextParam);
          }
        }
      );
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
    this._logger.info(`${scope ? `[${scope}] -- ` : ""}${log}`);
  }
  private _error(log: string, scope?: string) {
    this._logger.error(`${scope ? `[${scope}] -- ` : ""}${log}`);
  }
  private _warn(log: string, scope?: string) {
    this._logger.warn(`${scope ? `[${scope}] -- ` : ""}${log}`);
  }

  private _ensureDistributed(): DistributedCoordinator {
    if (!this._distributed) {
      const config =
        this._distributedConfig ?? resolveDistributedConfig(this.config);
      if (!config) {
        throw new Error(
          "Distributed modules require a configured distributed section"
        );
      }
      const monitorBaseUrl = `http://${this._monitorConfig.host}:${this._monitorConfig.port}`;
      this._distributedConfig = config;
      const logger = getLogger("distributed");
      const monitorUrl = this._monitorConfig.disabled
        ? undefined
        : `${monitorBaseUrl}${MONITOR_BASE_PATH}`;
      const managementUrl = this._monitorConfig.disabled
        ? undefined
        : `${monitorBaseUrl}${MANAGEMENT_BASE_PATH}`;
      this._distributed = initDistributedCoordinator(
        config,
        this._instanceId,
        logger,
        this._persistence,
        this,
        { monitorUrl, managementUrl }
      );
    }
    return this._distributed;
  }

  async _enqueueDistributed(
    target: string,
    param: any
  ): Promise<boolean> {
    const modules = this._targetModules[target];
    if (!modules) {
      return false;
    }
    const distributedModules = modules.filter((mod) => mod.distributed);
    if (!distributedModules.length) {
      return false;
    }
    const coordinator = this._ensureDistributed();
    await Promise.all(
      distributedModules.map((mod) => coordinator.enqueue(mod, param))
    );
    return true;
  }

  get persistence(): PersistenceProvider {
    return this._persistence;
  }

  async resolver(key: string): Promise<Resolver<any, any> | undefined> {
    return this._resolvers[key];
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

  async apply(setup: TigerSetup): Promise<void> {
    if (setup.config) {
      this._log(`Error: Tiger setup config is not supported in runtime, please use defineServer to define the server`);
    }
    await setup.call(this);
  }
}

export type Extension<Param, State> = {
  notify(target: string, param: Param): Promise<void>;
  log(message: string): void;
  error(message: string): void;
  state(data?: Partial<State>): State;
}

export function defineServer(call: TigerCall): TigerSetup;
export function defineServer(config: TigerConfig, call: TigerCall): TigerSetup
export function defineServer(configOrCall: TigerConfig | TigerCall, call?: TigerCall): TigerSetup {
  let config: TigerConfig | undefined = undefined;
  if (typeof configOrCall === "function") {
    call = configOrCall;
  } else {
    config = configOrCall;
  }
  return { config, call };
}
