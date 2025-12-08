import type { ExtendedModule } from "./tiger.js";

import { processWithMutableState } from "./core/common.js";
import { ensureDistributedCoordinator } from "./distributed/index.js";

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
