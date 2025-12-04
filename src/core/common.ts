import type { ExtendedModule } from "../tiger.ts"
import { getLogger } from "../logger.ts";
import monitor from "../monitor.ts";
import { getDistributedCoordinator } from "../distributed/index.ts";

const logger = getLogger("state")
const DISTRIBUTED_STATE_SYMBOL = Symbol("distributedState");

export { DISTRIBUTED_STATE_SYMBOL };

export async function processWithMutableState<Param, State>(
  _module: ExtendedModule<Param, State>,
  param: Param
) {
  const startAt = Date.now();
  let errorMessage: string | undefined;
  const isDistributed = Boolean(_module.distributed);
  const distributed = isDistributed ? getDistributedCoordinator() : undefined;
  if (isDistributed && (!distributed || !_module.id)) {
    throw new Error(
      `Distributed module ${_module.id ?? "<unknown>"} requires distributed coordinator`
    );
  }

  const runtimeState =
    isDistributed && _module.id
      ? await (async () => {
          const loaded = await distributed!.loadState(_module.id!);
          (_module as any)[DISTRIBUTED_STATE_SYMBOL] = loaded;
          _module.state(loaded as State);
          return loaded;
        })()
      : ((_module.state() as any as object) ?? {});

  try {
    const result = await _module.process.call(_module, runtimeState, param);
    if (result) {
      logger.info(
        `Patch state of ${_module.id} with ${JSON.stringify(result)}`
      );
      Object.assign(runtimeState, result as object);
      _module.state(runtimeState as State);
    }
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    if (isDistributed) {
      _module.state(runtimeState as State);
    }
    const latestState =
      (isDistributed && _module.id
        ? runtimeState
        : ((_module.state() as any as object) ?? {}));
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
