import type { Logger } from "../logger.ts";
import type { ResolvedDistributedConfig } from "../config.ts";
import { DistributedCoordinator } from "./controller.ts";

let coordinator: DistributedCoordinator | undefined;

export function initDistributedCoordinator(
  config: ResolvedDistributedConfig,
  instanceId: string,
  logger: Logger
): DistributedCoordinator {
  if (!coordinator) {
    coordinator = new DistributedCoordinator(config, instanceId, logger);
  }
  return coordinator;
}

export function getDistributedCoordinator():
  | DistributedCoordinator
  | undefined {
  return coordinator;
}

export function ensureDistributedCoordinator(): DistributedCoordinator {
  if (!coordinator) {
    throw new Error(
      "Distributed coordinator is not initialized but required for distributed modules"
    );
  }
  return coordinator;
}
