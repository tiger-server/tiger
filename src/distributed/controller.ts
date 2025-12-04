import type { ExtendedModule } from "../tiger.ts";
import type { Logger } from "../logger.ts";
import type { ResolvedDistributedConfig } from "../config.ts";
import type { PersistenceProvider } from "../persistence/index.ts";
import { processWithMutableState } from "../core/common.ts";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

interface Worker {
  running: boolean;
}

export interface NodeMetadata {
  monitorUrl?: string;
  managementUrl?: string;
}

export class DistributedCoordinator {
  private readonly workers: Map<string, Worker> = new Map();
  private heartbeatTimer?: NodeJS.Timeout;
  private recoveryTimer?: NodeJS.Timeout;
  private nodeEnabled = true;
  private readonly config: ResolvedDistributedConfig;
  private readonly instanceId: string;
  private readonly logger: Logger;
  private readonly provider: PersistenceProvider;
  private readonly metadata?: NodeMetadata;

  constructor(
    config: ResolvedDistributedConfig,
    instanceId: string,
    logger: Logger,
    provider: PersistenceProvider,
    metadata?: NodeMetadata
  ) {
    this.config = config;
    this.instanceId = instanceId;
    this.logger = logger;
    this.provider = provider;
    this.metadata = metadata;
  }

  async start() {
    await this.sendHeartbeat();
    this.startHeartbeat();
    this.startRecoveryLoop();
  }

  async enqueue(module: ExtendedModule<any, any>, payload: unknown) {
    if (!module.id) {
      throw new Error("Distributed module requires an id");
    }
    const accepted = await this.provider.enqueueJob(
      module.id,
      payload,
      undefined,
      this.config.maxQueueLength
    );
    if (!accepted) {
      this.logger.warn(
        `dropping job for ${module.id}: queue reached ${this.config.maxQueueLength}`
      );
    }
  }

  async enqueueCron(moduleId: string, payload: unknown, scheduledAt: Date) {
    const accepted = await this.provider.enqueueJob(
      moduleId,
      payload,
      scheduledAt,
      this.config.maxQueueLength
    );
    if (!accepted) {
      this.logger.warn(
        `dropping cron job for ${moduleId}: queue reached ${this.config.maxQueueLength}`
      );
    }
  }

  registerModule(module: ExtendedModule<any, any>) {
    if (!module.id) {
      throw new Error("Distributed module requires an id");
    }
    if (this.workers.has(module.id)) {
      return;
    }
    const worker: Worker = { running: true };
    this.workers.set(module.id, worker);
    this.startWorker(module, worker).catch((error) => {
      this.logger.error(`worker for ${module.id} failed: ${error}`);
    });
  }

  async loadState(moduleId: string) {
    return this.provider.loadModuleState(moduleId);
  }

  async saveState(moduleId: string, state: object) {
    await this.provider.saveModuleState(moduleId, state);
  }

  async listNodes() {
    return this.provider.listNodes();
  }

  async setNodeDesiredState(nodeId: string, enabled: boolean) {
    await this.provider.setNodeDesiredState(nodeId, enabled);
  }

  private async startWorker(module: ExtendedModule<any, any>, worker: Worker) {
    while (worker.running) {
      if (!this.nodeEnabled) {
        await sleep(200);
        continue;
      }
      const job = await this.provider.claimJob(module.id!, this.instanceId);
      if (!job) {
        await sleep(200);
        continue;
      }
      try {
        await processWithMutableState(module, job.payload);
        await this.provider.ackJob(job, this.instanceId);
      } catch (error) {
        this.logger.error(`distributed job ${job.id} failed: ${error}`);
        await this.provider.failJob(
          job,
          this.instanceId,
          error instanceof Error ? error.message : String(error)
        );
      }
    }
  }

  private startHeartbeat() {
    this.heartbeatTimer = setInterval(() => {
      void this.sendHeartbeat();
    }, this.config.heartbeatIntervalMs);
  }

  private async sendHeartbeat() {
    const metadata: Record<string, string> = {
      monitorUrl: this.metadata?.monitorUrl || "",
      managementUrl: this.metadata?.managementUrl || "",
    };
    const desired = await this.provider.heartbeat(
      this.instanceId,
      metadata,
      this.nodeEnabled
    );
    if (desired !== this.nodeEnabled) {
      this.nodeEnabled = desired;
      this.logger.info(
        `node ${this.instanceId} ${desired ? "resuming" : "pausing"} work consumption`
      );
    }
  }

  private startRecoveryLoop() {
    this.recoveryTimer = setInterval(() => {
      void this.provider.requeueStaleJobs(
        this.instanceId,
        this.config.heartbeatTimeoutMs
      );
    }, this.config.heartbeatTimeoutMs);
  }

  getHeartbeatTimeout(): number {
    return this.config.heartbeatTimeoutMs;
  }
}
