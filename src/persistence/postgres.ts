import { randomUUID } from "node:crypto";
import { Op, Transaction, UniqueConstraintError } from "sequelize";

import type { PersistenceProvider, QueueJob, PendingJob } from "./index.ts";
import {
  DistributedJobModel,
  DistributedModuleStateModel,
  DistributedNodeModel,
  DistributedJobHistoryModel,
  ensureDatabaseConnection,
  sequelize,
} from "../db/sequelize.ts";

export class PostgresPersistenceProvider implements PersistenceProvider {
  async start() {
    await ensureDatabaseConnection();
  }

  async stop() {
    await sequelize.close();
  }

  async heartbeat(
    nodeId: string,
    metadata: Record<string, string>,
    running: boolean
  ): Promise<boolean> {
    const existing = await DistributedNodeModel.findByPk(nodeId);
    const desiredEnabled = existing?.desiredEnabled ?? true;
    await DistributedNodeModel.upsert({
      id: nodeId,
      enabled: running,
      desiredEnabled,
      lastHeartbeat: new Date(),
      monitorUrl: metadata.monitorUrl,
      managementUrl: metadata.managementUrl,
    });
    return desiredEnabled;
  }

  async setNodeDesiredState(nodeId: string, enabled: boolean): Promise<void> {
    const existing = await DistributedNodeModel.findByPk(nodeId);
    await DistributedNodeModel.upsert({
      id: nodeId,
      desiredEnabled: enabled,
      enabled: existing?.enabled ?? false,
      lastHeartbeat: existing?.lastHeartbeat ?? new Date(),
      monitorUrl: existing?.monitorUrl ?? undefined,
      managementUrl: existing?.managementUrl ?? undefined,
    });
  }

  async listNodes() {
    const records = await DistributedNodeModel.findAll();
    return records.map((node) => ({
      id: node.get("id") as string,
      enabled: Boolean(node.get("enabled")),
      desiredEnabled: Boolean(node.get("desiredEnabled")),
      lastHeartbeat: new Date(node.get("lastHeartbeat") as any).getTime(),
      metadata: {
        monitorUrl: node.get("monitorUrl") as string | undefined,
        managementUrl: node.get("managementUrl") as string | undefined,
      },
    }));
  }

  async loadModuleState(moduleId: string): Promise<object> {
    const record = await DistributedModuleStateModel.findByPk(moduleId);
    return record ? (record.get("state") as object) : {};
  }

  async enqueueJob(
    moduleId: string,
    payload: unknown,
    scheduledAt: Date = new Date(),
    maxQueueLength?: number
  ): Promise<string | undefined> {
    return this.enqueueWithLimit(moduleId, payload, scheduledAt, maxQueueLength);
  }

  async claimJob(moduleId: string, workerId: string): Promise<QueueJob | undefined> {
    return sequelize.transaction(
      { isolationLevel: Transaction.ISOLATION_LEVELS.READ_COMMITTED },
      async (transaction) => {
        const job = await DistributedJobModel.findOne({
          where: {
            moduleId,
            status: "queued",
            scheduledAt: { [Op.lte]: new Date() },
          },
          order: [
            ["scheduledAt", "ASC"],
            ["createdAt", "ASC"],
          ],
          lock: transaction.LOCK.UPDATE,
          skipLocked: true,
          transaction,
        });

        if (!job) {
          return undefined;
        }

        await job.update(
          {
            status: "processing",
            lockedBy: workerId,
            lockedAt: new Date(),
          },
          { transaction }
        );

        return {
          id: job.id as string,
          moduleId,
          payload: job.payload,
          scheduledAt: job.scheduledAt as Date,
        };
      }
    );
  }

  async ackJob(
    job: QueueJob,
    workerId: string,
    state: object,
    pendingJobs: PendingJob[]
  ): Promise<string[]> {
    return sequelize.transaction(async (transaction) => {
      await DistributedModuleStateModel.upsert(
        { moduleId: job.moduleId, state },
        { transaction }
      );
      const record = await DistributedJobModel.findByPk(job.id, {
        lock: transaction.LOCK.UPDATE,
        transaction,
      });
      if (!record) {
        return [];
      }
      await DistributedJobHistoryModel.create(
        {
          jobId: record.id,
          moduleId: record.moduleId,
          payload: record.payload,
          status: "completed",
          workerId,
          startedAt: record.lockedAt,
          finishedAt: new Date(),
        },
        { transaction }
      );
      await record.destroy({ transaction });
      return this.flushPendingJobs(pendingJobs, transaction);
    });
  }

  async failJob(
    job: QueueJob,
    workerId: string,
    state: object,
    pendingJobs: PendingJob[],
    reason?: string
  ): Promise<string[]> {
    await sequelize.transaction(async (transaction) => {
      await DistributedModuleStateModel.upsert(
        { moduleId: job.moduleId, state },
        { transaction }
      );
      const record = await DistributedJobModel.findByPk(job.id, {
        lock: transaction.LOCK.UPDATE,
        transaction,
      });
      if (!record) {
        return;
      }
      await DistributedJobHistoryModel.create(
        {
          jobId: record.id,
          moduleId: record.moduleId,
          payload: record.payload,
          status: "failed",
          workerId,
          startedAt: record.lockedAt,
          finishedAt: new Date(),
          error: reason,
        },
        { transaction }
      );
      await record.destroy({ transaction });
    });
    return pendingJobs.map((job) => job.moduleId);
  }

  private async enqueueWithLimit(
    moduleId: string,
    payload: unknown,
    scheduledAt: Date,
    maxQueueLength?: number,
    transaction?: Transaction
  ): Promise<string | undefined> {
    if (typeof maxQueueLength === "number") {
      const queued = await DistributedJobModel.count({
        where: { moduleId, status: "queued" },
        transaction,
      });
      if (queued >= maxQueueLength) {
        return undefined;
      }
    }
    const job = await this.insertJobRecord(
      moduleId,
      payload,
      scheduledAt,
      transaction
    );
    return job.id;
  }

  private async flushPendingJobs(
    pendingJobs: PendingJob[],
    transaction: Transaction
  ): Promise<string[]> {
    const dropped: string[] = [];
    for (const pending of pendingJobs) {
      const accepted = await this.enqueueWithLimit(
        pending.moduleId,
        pending.payload,
        pending.scheduledAt ?? new Date(),
        pending.maxQueueLength,
        transaction
      );
      if (!accepted) {
        dropped.push(pending.moduleId);
      }
    }
    return dropped;
  }

  private async insertJobRecord(
    moduleId: string,
    payload: unknown,
    scheduledAt: Date,
    transaction?: Transaction
  ): Promise<DistributedJobModel> {
    try {
      return await DistributedJobModel.create(
        {
          id: randomUUID(),
          moduleId,
          payload,
          scheduledAt,
          status: "queued",
        },
        { transaction }
      );
    } catch (error) {
      if (error instanceof UniqueConstraintError) {
        const existing = await DistributedJobModel.findOne({
          where: { moduleId, scheduledAt },
          transaction,
        });
        if (existing) {
          return existing;
        }
        return await DistributedJobModel.create(
          {
            id: randomUUID(),
            moduleId,
            payload,
            scheduledAt,
            status: "queued",
          },
          { transaction }
        );
      }
      throw error;
    }
  }

  async requeueStaleJobs(workerId: string, timeoutMs: number): Promise<void> {
    const threshold = new Date(Date.now() - timeoutMs);
    await DistributedJobModel.update(
      {
        status: "queued",
        lockedBy: null,
        lockedAt: null,
      },
      {
        where: {
          status: "processing",
          lockedAt: { [Op.lte]: threshold },
        },
      }
    );
  }

  async listJobHistory(limit = 50) {
    const rows = await DistributedJobHistoryModel.findAll({
      order: [["finishedAt", "DESC"]],
      limit,
    });
    return rows.map((row) => ({
      id: row.id as string,
      moduleId: row.moduleId,
      status: row.status,
      workerId: row.workerId,
      finishedAt: row.finishedAt?.getTime(),
    }));
  }
}
