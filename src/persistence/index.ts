export interface QueueJob {
  id: string;
  moduleId: string;
  payload: unknown;
  scheduledAt: Date;
}

export interface PendingJob {
  moduleId: string;
  payload: unknown;
  scheduledAt?: Date;
  maxQueueLength?: number;
}

export interface PersistenceProvider {
  start(): Promise<void>;
  stop(): Promise<void>;

  // node registry
  heartbeat(
    nodeId: string,
    metadata: Record<string, string>,
    running: boolean
  ): Promise<boolean>;
  setNodeDesiredState(nodeId: string, enabled: boolean): Promise<void>;
  listNodes(): Promise<
    Array<{
      id: string;
      enabled: boolean;
      desiredEnabled: boolean;
      lastHeartbeat: number;
      metadata?: Record<string, string>;
    }>
  >;

  // module state
  loadModuleState(moduleId: string): Promise<object>;

  // job queue
  enqueueJob(
    moduleId: string,
    payload: unknown,
    scheduledAt?: Date,
    maxQueueLength?: number
  ): Promise<string | undefined>;
  claimJob(moduleId: string, workerId: string): Promise<QueueJob | undefined>;
  ackJob(
    job: QueueJob,
    workerId: string,
    state: object,
    pendingJobs: PendingJob[]
  ): Promise<string[]>;
  failJob(
    job: QueueJob,
    workerId: string,
    state: object,
    pendingJobs: PendingJob[],
    reason?: string
  ): Promise<string[]>;
  requeueStaleJobs(workerId: string, timeoutMs: number): Promise<void>;
  listJobHistory(limit: number): Promise<
    Array<{
      id: string;
      moduleId: string;
      status: string;
      workerId?: string | null;
      finishedAt?: number;
    }>
  >;
}
