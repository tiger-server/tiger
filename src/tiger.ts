
import { Logger, getLogger, configure } from  "log4js"
import { nanoid } from "nanoid"

import { Resolver } from "./resolver"
import { TigerConfig, Module, Target } from "./types"

export {
  TigerConfig, Module, Target
}

function makeTargetFromString(target: string): Target {
  const EXTRACTOR = /(?<protocol>\w+):(?<path>.+)/;
  const { protocol, path } = EXTRACTOR.exec(target)!["groups"];
  return { protocol, path };
}

export type ExtendedModule<Param, State> = Module<Param, State> & Extension<Param, State>

export type TigerCall = (tiger: Tiger) => void

export interface TigerPlugin {
  readonly id: string;
  setup(tiger: Tiger): void
}

configure({
  appenders: { out: { type: 'stdout' }, file: {type: "file", filename: "tiger.log"} },
  categories: { default: { appenders: ['out', 'file'], level: 'INFO' } }
});

export class Tiger {

  readonly config: TigerConfig
  private _plugins: { [key: string]: TigerPlugin }
  private _modules: { [key: string]: Module<any, any> }
  private _resolvers: { [key: string]: Resolver<any, any> }
  private _state: { [key: string]: object }
  private _logger: Logger

  private _postInitializeProcesses: Array<TigerCall>

  constructor(config: TigerConfig = {}) {
    this.config = config;
    this._plugins = {};
    this._modules = {};
    this._resolvers = {};
    this._state = {};

    this._logger = getLogger("tiger");
    this._postInitializeProcesses = [];
  }

  use(plugin: TigerPlugin): Tiger {
    if (this._plugins[plugin.id] === undefined) {
      this._plugins[plugin.id] = plugin;
      plugin.setup(this)
    } else {
      this._warn(`Existed plugin: ${plugin.id}`)
    }
    return this;
  }

  define<Param = object, State = object>(_module: Module<Param, State>) {

    _module.id = _module.id || nanoid();;
    
    const extended = Object.assign(_module, this._handlerAdapter(_module))

    this._modules[_module.id] = extended;

    const target = makeTargetFromString(extended.target);
    const { path, protocol } = target;

    const resolver = this._resolvers[protocol]

    if (resolver && resolver.define) {
      resolver.define(path, extended);
    } else {
      this._warn(`No valid definition handler found for protocol [${protocol}]`)
    }
  }

  private _notify<Param>(from: string, target: string, param: Param) {
    this._log(`Notifying target: ${target}`, `tiger:${from}`)

    const { protocol, path } = makeTargetFromString(target);
    const resolver = this._resolvers[protocol]

    if (resolver && resolver.notified) {
      resolver.notified(path, param, (path, param) => {
        process.nextTick(() => {
          this._notify(target, path, param);
        })
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

  serve() {
    this._postInitializeProcesses.forEach(it => {
      it(this);
    })
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

  _handlerAdapter<Param, State>(handler: Module<Param, State>) {
    const tiger = this;
    return {
      notify(target: string, param: Param) {
        tiger._notify(handler.id, target, param);
      },
      
      log(message: string) {
        tiger._log(message, handler.id);
      },

      error(message: string) {
        tiger._error(message, handler.id);
      },
  
      state(data?: Partial<State>): State {
        const { id } = handler 
        if (data) {
          return tiger._stat(id, { ...tiger._stat(id), ...(data as object) }) as any as State
        }
        return tiger._stat(id) as any as State
      },
    }
  }

}

export type Extension<Param, State> = {
  notify(target: string, param: Param): void;
  log(message: string): void;
  error(message: string): void;
  state(data?: Partial<State>): State;
}
