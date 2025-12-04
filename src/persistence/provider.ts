import type { PersistenceProvider } from "./index.ts";
import { LevelPersistenceProvider } from "./level.ts";
import { PostgresPersistenceProvider } from "./postgres.ts";

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
