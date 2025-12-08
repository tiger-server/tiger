import type { Logger } from "../logger.js";
import type { ResolvedDistributedConfig } from "../config.js";
import { DistributedCoordinator, type NodeMetadata } from "./controller.js";
import type { PersistenceProvider } from "../persistence/index.js";
import { Tiger } from "../tiger.js";

let coordinator: DistributedCoordinator | undefined;

export function initDistributedCoordinator(
  config: ResolvedDistributedConfig,
  instanceId: string,
  logger: Logger,
  provider: PersistenceProvider,
  tiger: Tiger,
  metadata?: NodeMetadata
): DistributedCoordinator {
  if (!coordinator) {
    coordinator = new DistributedCoordinator(
      config,
      instanceId,
      logger,
      provider,
      tiger,
      metadata,
    );
    void coordinator.start();
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

export function getDistributedHeartbeatTimeout(): number | undefined {
  return coordinator?.getHeartbeatTimeout();
}
