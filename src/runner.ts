import type { ExtendedModule } from "./tiger.ts";

import { processWithMutableState } from "./core/common.ts";
import { ensureDistributedCoordinator } from "./distributed/index.ts";

export async function dispatchModule<Param, State>(
  _module: ExtendedModule<Param, State>,
  param: Param
): Promise<void> {
  if (_module.distributed) {
    const coordinator = ensureDistributedCoordinator();
    await coordinator.enqueue(_module, param);
    return;
  }
  await processWithMutableState(_module, param);
}
