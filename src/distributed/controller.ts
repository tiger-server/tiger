import { AsyncLocalStorage } from "node:async_hooks";

import type { ExtendedModule } from "../tiger.ts";
import type { Logger } from "../logger.ts";
import type { ResolvedDistributedConfig } from "../config.ts";
import type {
  PersistenceProvider,
  PendingJob,
  QueueJob,
} from "../persistence/index.ts";
import {
  processWithMutableState,
  DISTRIBUTED_STATE_SYMBOL,
} from "../core/common.ts";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

interface Worker {
  running: boolean;
}

interface JobContext {
  pending: PendingJob[];
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
  private readonly jobContext = new AsyncLocalStorage<JobContext>();
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
    const context = this.jobContext.getStore();
    if (context) {
      context.pending.push({
        moduleId: module.id,
        payload,
        maxQueueLength: this.config.maxQueueLength,
      });
      return;
    }
    await this.enqueueImmediate(module.id, payload);
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
      await this.handleJob(module, job);
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

  private getModuleState(module: ExtendedModule<any, any>): object {
    const state = (module as any)[DISTRIBUTED_STATE_SYMBOL];
    return state && typeof state === "object" ? state : {};
  }

  private async enqueueImmediate(
    moduleId: string,
    payload: unknown,
    scheduledAt?: Date
  ) {
    const accepted = await this.provider.enqueueJob(
      moduleId,
      payload,
      scheduledAt,
      this.config.maxQueueLength
    );
    if (!accepted) {
      this.logger.warn(
        `dropping job for ${moduleId}: queue reached ${this.config.maxQueueLength}`
      );
    }
  }

  private reportDroppedPending(modules: string[], reason: string) {
    for (const moduleId of modules) {
      this.logger.warn(`dropping pending job for ${moduleId} (${reason})`);
    }
  }

  private async handleJob(
    module: ExtendedModule<any, any>,
    job: QueueJob
  ): Promise<void> {
    const context: JobContext = { pending: [] };
    await this.jobContext.run(context, async () => {
      try {
        await processWithMutableState(module, job.payload);
        const state = this.getModuleState(module);
        const dropped = await this.provider.ackJob(
          job,
          this.instanceId,
          state,
          context.pending
        );
        this.reportDroppedPending(dropped, "queue full");
      } catch (error) {
        this.logger.error(`distributed job ${job.id} failed: ${error}`);
        const state = this.getModuleState(module);
        const dropped = await this.provider.failJob(
          job,
          this.instanceId,
          state,
          context.pending,
          error instanceof Error ? error.message : String(error)
        );
        this.reportDroppedPending(dropped, "job failed");
      }
    });
  }

}
