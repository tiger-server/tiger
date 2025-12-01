import type { ExtendedModule } from "../tiger.ts"
import { getLogger } from "../logger.ts";
import monitor from "../monitor.ts";

const logger = getLogger("state")

export async function processWithMutableState<Param, State>(_module: ExtendedModule<Param, State>, param: Param) {
  const state = (_module.state() as any as object) ?? {};
  const startAt = Date.now();
  let errorMessage: string | undefined;

  try {
    const result = await _module.process.call(_module, state, param)
    if (result) {
      logger.info(`Patch state of ${_module.id} with ${JSON.stringify(result)}`)
      _module.state({ ...state, ...result });
    }
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    const latestState = (_module.state() as any as object) ?? {};
    await monitor.recordRun(
      _module,
      param,
      latestState,
      startAt,
      Date.now() - startAt,
      errorMessage
    );
  }
}
