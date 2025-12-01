import { Redis } from "ioredis";

import type { CronScheduleStore } from "./scheduler.ts";
import type { Logger } from "../../logger.ts";

interface RedisStoreOptions {
  redisUrl: string;
  scheduleKey: string;
  logger: Logger;
}

export function createRedisScheduleStore({
  redisUrl,
  scheduleKey,
  logger,
}: RedisStoreOptions): CronScheduleStore {
  const client = new Redis(redisUrl);
  client.on("error", (error) => {
    logger.error(
      `redis connection error: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  });

  return {
    async schedule(moduleId, timestamp) {
      await client.zadd(scheduleKey, timestamp, moduleId);
    },
    async scheduleIfNotExists(moduleId, timestamp) {
      await client.zadd(scheduleKey, "NX", timestamp, moduleId);
    },
    async popDue(until) {
      const entries = await client.zrangebyscore(
        scheduleKey,
        "-inf",
        until,
        "WITHSCORES",
        "LIMIT",
        0,
        1
      );
      if (!entries.length) {
        return undefined;
      }
      const [moduleId, score] = entries;
      const removed = await client.zrem(scheduleKey, moduleId);
      if (removed === 0) {
        return undefined;
      }
      return { moduleId, dueAt: Number(score) };
    },
  };
}
