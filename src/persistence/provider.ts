import type { PersistenceProvider } from "./index.js";
import { LevelPersistenceProvider } from "./level.js";
import { PostgresPersistenceProvider } from "./postgres.js";

export type PersistenceDriver = "level" | "postgres";

export interface PersistenceOptions {
  driver?: PersistenceDriver;
  levelPath?: string;
}

export function createPersistenceProvider(
  options: PersistenceOptions = {}
): PersistenceProvider {
  const driver = options.driver ?? "level";
  if (driver === "postgres") {
    return new PostgresPersistenceProvider();
  }
  return new LevelPersistenceProvider(options.levelPath);
}
