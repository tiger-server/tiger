import { randomUUID } from "node:crypto";
import path from "node:path";

import { Level } from "level";

import type { PersistenceProvider, QueueJob } from "./index.ts";

type NodeRecord = {
  id: string;
  enabled: boolean;
  desiredEnabled: boolean;
  metadata: Record<string, string>;
  lastHeartbeat: number;
};

type QueueRecord = {
  id: string;
  moduleId: string;
  payload: unknown;
  scheduledAt: number;
};

type HistoryRecord = {
  id: string;
  moduleId: string;
  payload: unknown;
  status: string;
  workerId?: string;
  finishedAt: number;
  error?: string;
};

export class LevelPersistenceProvider implements PersistenceProvider {
  private readonly basePath: string;
  private readonly nodeDb: Level<string, NodeRecord>;
  private readonly stateDb: Level<string, any>;
  private readonly queueDb: Level<string, QueueRecord>;
  private readonly historyDb: Level<string, HistoryRecord>;

  constructor(basePath = ".tiger-level") {
    this.basePath = path.resolve(basePath);
    this.nodeDb = new Level(path.join(this.basePath, "nodes"), {
      valueEncoding: "json",
    });
    this.stateDb = new Level(path.join(this.basePath, "state"), {
      valueEncoding: "json",
    });
    this.queueDb = new Level(path.join(this.basePath, "queue"), {
      valueEncoding: "json",
    });
    this.historyDb = new Level(path.join(this.basePath, "history"), {
      valueEncoding: "json",
    });
  }

  async start(): Promise<void> {}
  async stop(): Promise<void> {}

  async heartbeat(
    nodeId: string,
    metadata: Record<string, string>,
    running: boolean
  ): Promise<boolean> {
    const existing = await this.nodeDb.get(nodeId).catch(() => undefined);
    const desiredEnabled = existing?.desiredEnabled ?? true;
    const record: NodeRecord = {
      id: nodeId,
      enabled: running,
      desiredEnabled,
      metadata,
      lastHeartbeat: Date.now(),
    };
    await this.nodeDb.put(nodeId, record);
    return desiredEnabled;
  }

  async setNodeDesiredState(nodeId: string, desiredEnabled: boolean): Promise<void> {
    const existing =
      (await this.nodeDb.get(nodeId).catch(() => undefined)) ??
      ({
        id: nodeId,
        enabled: false,
        desiredEnabled,
        metadata: {},
        lastHeartbeat: Date.now(),
      } satisfies NodeRecord);
    await this.nodeDb.put(nodeId, {
      ...existing,
      desiredEnabled,
      lastHeartbeat: Date.now(),
    });
  }

  async listNodes(): Promise<NodeRecord[]> {
    const nodes: NodeRecord[] = [];
    for await (const [, value] of this.nodeDb.iterator()) {
      nodes.push(value);
    }
    return nodes;
  }

  async loadModuleState(moduleId: string): Promise<object> {
    return (await this.stateDb.get(moduleId).catch(() => ({}))) ?? {};
  }

  async saveModuleState(moduleId: string, state: object): Promise<void> {
    await this.stateDb.put(moduleId, state);
  }

  async enqueueJob(
    moduleId: string,
    payload: unknown,
    scheduledAt: Date = new Date(),
    maxQueueLength?: number
  ): Promise<boolean> {
    if (typeof maxQueueLength === "number") {
      let count = 0;
      for await (const _ of this.queueDb.iterator({
        gte: `${moduleId}:`,
        lt: `${moduleId};`,
      })) {
        count += 1;
        if (count >= maxQueueLength) {
          return false;
        }
      }
    }
    const id = randomUUID();
    await this.queueDb.put(`${moduleId}:${id}`, {
      id,
      moduleId,
      payload,
      scheduledAt: scheduledAt.getTime(),
    });
    return true;
  }

  async claimJob(
    moduleId: string,
    _workerId: string
  ): Promise<QueueJob | undefined> {
    for await (const [key, value] of this.queueDb.iterator({
      gte: `${moduleId}:`,
      lt: `${moduleId};`,
    })) {
      await this.queueDb.del(key);
      return {
        id: value.id,
        moduleId: value.moduleId,
        payload: value.payload,
        scheduledAt: new Date(value.scheduledAt),
      } satisfies QueueJob;
    }
    return undefined;
  }

  async ackJob(job: QueueJob, workerId: string): Promise<void> {
    await this.historyDb.put(this.makeHistoryKey(job), {
      id: job.id,
      moduleId: job.moduleId,
      payload: job.payload,
      status: "completed",
      workerId,
      finishedAt: Date.now(),
    });
  }

  async failJob(job: QueueJob, workerId: string, reason?: string): Promise<void> {
    await this.historyDb.put(this.makeHistoryKey(job), {
      id: job.id,
      moduleId: job.moduleId,
      payload: job.payload,
      status: "failed",
      workerId,
      finishedAt: Date.now(),
      error: reason,
    });
  }

  async requeueStaleJobs(_workerId: string, _timeoutMs: number): Promise<void> {}

  async listJobHistory(limit = 50): Promise<HistoryRecord[]> {
    const records: HistoryRecord[] = [];
    for await (const [, value] of this.historyDb.iterator({
      reverse: true,
      limit,
    })) {
      records.push(value);
    }
    return records;
  }

  private makeHistoryKey(job: QueueJob): string {
    return `${String(Date.now()).padStart(20, "0")}!${job.moduleId}!${job.id}`;
  }
}
