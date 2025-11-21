import type { ExtendedModule } from "../tiger.ts"
import { getLogger } from "../logger.ts";

const logger = getLogger("state")

export async function processWithMutableState<Param, State>(_module: ExtendedModule<Param, State>, param: Param) {
  const state = _module.state() as any as object;

  const result = await _module.process.call(_module, state, param)
  if (result) {
    logger.info(`Patch state of ${_module.id} with ${JSON.stringify(result)}`)
    _module.state({ ...state, ...result });
  }
}
