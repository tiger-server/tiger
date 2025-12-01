import path from "node:path";
import { randomUUID } from "node:crypto";
import { Level } from "level";

import type { CronScheduleStore } from "./scheduler.ts";
import type { Logger } from "../../logger.ts";

interface LevelStoreOptions {
  dbPath: string;
  logger: Logger;
}

const KEY_PAD_LENGTH = 20;

export function createLevelScheduleStore({
  dbPath,
  logger,
}: LevelStoreOptions): CronScheduleStore {
  const scheduleDb = new Level<string, string>(
    path.join(dbPath, "schedule"),
    {
      valueEncoding: "utf8",
    }
  );
  const indexDb = new Level<string, string>(path.join(dbPath, "index"), {
    valueEncoding: "utf8",
  });

  const safeGet = async (key: string): Promise<string | undefined> => {
    try {
      return await indexDb.get(key);
    } catch (error) {
      if ((error as { code?: string })?.code === "LEVEL_NOT_FOUND") {
        return undefined;
      }
      throw error;
    }
  };

  const encodeTimestamp = (timestamp: number) =>
    String(timestamp).padStart(KEY_PAD_LENGTH, "0");

  const decodeTimestamp = (key: string) => {
    const [ts] = key.split("!");
    return Number(ts);
  };

  const putEntry = async (
    moduleId: string,
    timestamp: number,
    skipLookup?: boolean
  ) => {
    let previousKey: string | undefined;
    if (!skipLookup) {
      previousKey = await safeGet(moduleId);
    }
    if (previousKey) {
      await scheduleDb.del(previousKey).catch(() => {});
    }
    const entryKey = `${encodeTimestamp(timestamp)}!${moduleId}!${randomUUID()}`;
    await scheduleDb.put(entryKey, moduleId);
    await indexDb.put(moduleId, entryKey);
  };

  return {
    async schedule(moduleId, timestamp) {
      await putEntry(moduleId, timestamp);
    },
    async scheduleIfNotExists(moduleId, timestamp) {
      const existingKey = await safeGet(moduleId);
      if (existingKey) {
        return;
      }
      await putEntry(moduleId, timestamp, true);
    },
    async popDue(until) {
      const upperBound = `${encodeTimestamp(until)}~`;
      const iterator = scheduleDb.iterator({
        lt: upperBound,
        limit: 1,
      });
      for await (const [key, moduleId] of iterator) {
        await scheduleDb.del(key);
        await indexDb.del(moduleId).catch(() => {});
        return { moduleId, dueAt: decodeTimestamp(key) };
      }
      return undefined;
    },
  };
}
