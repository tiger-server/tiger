
import type { TigerPlugin, Tiger, ExtendedModule } from "../tiger.ts";
import { BaseResolver } from "../resolver.ts"

export default new class implements TigerPlugin  {
  /**
   * cron protocol
   */
  id: string = "example";  
  
  setup(tiger: Tiger): void {
    tiger.register(new class extends BaseResolver<{ max: number }, { number: number }> {
      readonly protocol: string = "example";

      registry: { [key: string]: ExtendedModule<{ max: number }, { number: number }> } = {};

      async define(path: string, _module: ExtendedModule<{ max: number }, { number: number }>) {
        if (!this.registry[path]) {
          this.registry[path] = _module;
        }
      } 

      async notified(path: string, param, next?: (path: string, param: object) => Promise<void>) {
        if (this.registry[path]) {
          const { max  = 0 } = param;
          const _module = this.registry[path];
          const state = _module.state();
          const { number = 0 } = state
          if (number < max) {
            await this.run(_module, state, param, number)
            if (next) {
              await next(`${this.protocol}:${path}`, param)
            }
          } else {
            this.reset(_module)
          }
        }
      }

      reset(_module) {
        _module.state({number: 0})
      }

      async run(_module, state, param, number) {
        await _module.process(state, param)
        _module.state({number: number + 1})
      }
    });
  }
}
