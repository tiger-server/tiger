export interface CronScheduleStore {
  schedule(moduleId: string, timestamp: number): Promise<void>;
  scheduleIfNotExists(moduleId: string, timestamp: number): Promise<void>;
  popDue(
    until: number
  ): Promise<{ moduleId: string; dueAt: number } | undefined>;
}
