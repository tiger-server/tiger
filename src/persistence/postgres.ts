import { randomUUID } from "node:crypto";
import { Op, Transaction, UniqueConstraintError } from "sequelize";

import type { PersistenceProvider, QueueJob } from "./index.ts";
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

  async saveModuleState(moduleId: string, state: object): Promise<void> {
    await DistributedModuleStateModel.upsert({ moduleId, state });
  }

  async enqueueJob(
    moduleId: string,
    payload: unknown,
    scheduledAt: Date = new Date(),
    maxQueueLength?: number
  ): Promise<boolean> {
    if (typeof maxQueueLength === "number") {
      return sequelize.transaction(
        { isolationLevel: Transaction.ISOLATION_LEVELS.READ_COMMITTED },
        async (transaction) => {
          const queued = await DistributedJobModel.count({
            where: { moduleId, status: "queued" },
            transaction,
          });
          if (queued >= maxQueueLength) {
            return false;
          }
          await this.insertJob(moduleId, payload, scheduledAt, transaction);
          return true;
        }
      );
    }
    await this.insertJob(moduleId, payload, scheduledAt);
    return true;
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

  async ackJob(job: QueueJob, workerId: string): Promise<void> {
    const record = await DistributedJobModel.findByPk(job.id);
    if (!record) {
      return;
    }
    await DistributedJobHistoryModel.create({
      jobId: record.id,
      moduleId: record.moduleId,
      payload: record.payload,
      status: "completed",
      workerId,
      startedAt: record.lockedAt,
      finishedAt: new Date(),
    });
    await record.destroy();
  }

  async failJob(job: QueueJob, workerId: string, reason?: string): Promise<void> {
    const record = await DistributedJobModel.findByPk(job.id);
    if (!record) {
      return;
    }
    await DistributedJobHistoryModel.create({
      jobId: record.id,
      moduleId: record.moduleId,
      payload: record.payload,
      status: "failed",
      workerId,
      startedAt: record.lockedAt,
      finishedAt: new Date(),
      error: reason,
    });
    await record.destroy();
  }

  private async insertJob(
    moduleId: string,
    payload: unknown,
    scheduledAt: Date,
    transaction?: Transaction
  ): Promise<void> {
    try {
      await DistributedJobModel.create(
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
        return;
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
