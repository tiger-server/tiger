import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";

import type { ExtendedModule } from "../tiger.ts";
import type { Logger } from "../logger.ts";
import type { ResolvedDistributedConfig } from "../config.ts";
import { processWithMutableState } from "../core/common.ts";

interface QueueJob {
  id: string;
  payload: unknown;
  createdAt: number;
}

interface InflightEntry {
  job: QueueJob;
  assignedAt: number;
  workerId: string;
}

type Worker = {
  running: boolean;
};

export class DistributedCoordinator {
  private readonly redis: Redis;
  private readonly workers: Map<string, Worker> = new Map();
  private heartbeatTimer?: NodeJS.Timeout;
  private recoveryTimer?: NodeJS.Timeout;
  private readonly config: ResolvedDistributedConfig;
  private readonly instanceId: string;
  private readonly logger: Logger;

  constructor(
    config: ResolvedDistributedConfig,
    instanceId: string,
    logger: Logger
  ) {
    this.config = config;
    this.instanceId = instanceId;
    this.logger = logger;
    this.redis = new Redis(config.redisUrl);
    this.redis.on("error", (error) => {
      this.logger.error(
        `distributed redis error: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    });
    void this.sendHeartbeat();
    this.startHeartbeat();
    this.startRecoveryLoop();
  }

  async enqueue(module: ExtendedModule<any, any>, payload: unknown) {
    if (!module.id) {
      throw new Error("Distributed module requires an id");
    }
    const job: QueueJob = {
      id: randomUUID(),
      payload,
      createdAt: Date.now(),
    };
    await this.redis.rpush(this.queueKey(module.id), JSON.stringify(job));
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
    this.startWorker(module, worker);
  }

  async loadState(moduleId: string): Promise<object> {
    const raw = await this.redis.get(this.stateKey(moduleId));
    if (!raw) {
      return {};
    }
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  async saveState(moduleId: string, state: object) {
    await this.redis.set(this.stateKey(moduleId), JSON.stringify(state ?? {}));
  }

  private queueKey(moduleId: string) {
    return `${this.config.namespace}:queue:${moduleId}`;
  }
  private inflightKey(moduleId: string) {
    return `${this.config.namespace}:inflight:${moduleId}`;
  }
  private stateKey(moduleId: string) {
    return `${this.config.namespace}:state:${moduleId}`;
  }
  private nodeKey(nodeId: string) {
    return `${this.config.namespace}:nodes:${nodeId}`;
  }

  private startHeartbeat() {
    this.heartbeatTimer = setInterval(() => {
      void this.sendHeartbeat();
    }, this.config.heartbeatIntervalMs);
  }

  private async sendHeartbeat() {
    await this.redis.set(
      this.nodeKey(this.instanceId),
      Date.now().toString(),
      "PX",
      this.config.heartbeatTimeoutMs * 2
    );
  }

  private startRecoveryLoop() {
    this.recoveryTimer = setInterval(() => {
      void this.recoverStaleJobs();
    }, this.config.heartbeatTimeoutMs);
  }

  private async recoverStaleJobs() {
    const now = Date.now();
    for (const moduleId of this.workers.keys()) {
      const inflightKey = this.inflightKey(moduleId);
      const entries = await this.redis.hgetall(inflightKey);
      for (const [jobId, raw] of Object.entries(entries)) {
        let entry: InflightEntry;
        try {
          entry = JSON.parse(raw);
        } catch {
          await this.redis.hdel(inflightKey, jobId);
          continue;
        }
        const heartbeat = await this.redis.exists(
          this.nodeKey(entry.workerId)
        );
        if (
          !heartbeat ||
          now - entry.assignedAt > this.config.heartbeatTimeoutMs
        ) {
          this.logger.warn(
            `requeue job ${jobId} for module ${moduleId} due to stale worker`
          );
          await this.redis.lpush(
            this.queueKey(moduleId),
            JSON.stringify(entry.job)
          );
          await this.redis.hdel(inflightKey, jobId);
        }
      }
    }
  }

  private startWorker(module: ExtendedModule<any, any>, worker: Worker) {
    const queueKey = this.queueKey(module.id!);
    const inflightKey = this.inflightKey(module.id!);
    const loop = async () => {
      while (worker.running) {
        const result = await this.redis.brpop(queueKey, 5);
        if (!result) {
          continue;
        }
        const [, rawJob] = result;
        let job: QueueJob;
        try {
          job = JSON.parse(rawJob);
        } catch (error) {
          this.logger.error(
            `invalid job payload for module ${module.id}: ${rawJob}`
          );
          continue;
        }
        const inflightEntry: InflightEntry = {
          job,
          assignedAt: Date.now(),
          workerId: this.instanceId,
        };
        await this.redis.hset(
          inflightKey,
          job.id,
          JSON.stringify(inflightEntry)
        );
        try {
          await processWithMutableState(module, job.payload);
          await this.redis.hdel(inflightKey, job.id);
        } catch (error) {
          this.logger.error(
            `distributed module ${module.id} failed: ${
              error instanceof Error ? error.stack ?? error.message : String(error)
            }`
          );
          await this.redis.hdel(inflightKey, job.id);
          await this.redis.lpush(queueKey, JSON.stringify(job));
        }
      }
    };
    void loop();
  }
}
