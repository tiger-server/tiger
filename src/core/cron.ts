import { CronExpressionParser } from "cron-parser";

import type { TigerPlugin, Tiger, ExtendedModule } from "../tiger.ts";
import { BaseResolver } from "../resolver.ts";
import { getLogger, type Logger } from "../logger.ts";
import {
  resolveCronConfig,
  type ResolvedCronConfig,
} from "../config.ts";
import type { CronScheduleStore } from "./cron/scheduler.ts";
import { createRedisScheduleStore } from "./cron/redis-store.ts";
import { createLevelScheduleStore } from "./cron/level-store.ts";
import { dispatchModule } from "../runner.ts";

type CronModuleEntry = {
  readonly expression: string;
  readonly module: ExtendedModule<object, object>;
};

const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export default new (class implements TigerPlugin {
  id: string = "cron";

  private _logger: Logger = getLogger("cron");
  private _config!: ResolvedCronConfig;
  private _registry: Map<string, CronModuleEntry> = new Map();
  private _polling = false;
  private _store!: CronScheduleStore;

  async setup(tiger: Tiger): Promise<void> {
    this._config = resolveCronConfig(tiger.config);
    this._store = this._createStore();
    this._startPolling();

    this._logger.info(
      `cron scheduler initialized using ${
        this._config.redisUrl ? "redis" : "leveldb"
      } backend`
    );

    const plugin = this;
    tiger.register(
      new (class extends BaseResolver<object, object> {
        readonly protocol: string = "cron";
        async define(path: string, _module: ExtendedModule<object, object>) {
          await plugin._registerModule(path, _module);
        }
      })()
    );
  }

  private _createStore(): CronScheduleStore {
    if (this._config.redisUrl) {
      return createRedisScheduleStore({
        redisUrl: this._config.redisUrl,
        scheduleKey: this._config.scheduleKey,
        logger: this._logger,
      });
    }
    return createLevelScheduleStore({
      dbPath: this._config.levelDbPath,
      logger: this._logger,
    });
  }

  private async _registerModule(
    expression: string,
    _module: ExtendedModule<object, object>
  ) {
    if (!_module.id) {
      this._logger.error(
        `skip cron registration for module without id on expression ${expression}`
      );
      return;
    }
    if (!this._isExpressionValid(expression, _module.id)) {
      return;
    }

    this._registry.set(_module.id, {
      expression,
      module: _module,
    });
    this._logger.info(
      `registered cron job ${_module.id} with schedule [${expression}]`
    );

    const nextRun = this._computeNextRun(expression);
    if (!nextRun) {
      return;
    }
    await this._store.scheduleIfNotExists(_module.id, nextRun.getTime());
  }

  private async _scheduleNextRun(
    moduleId: string,
    expression: string,
    reference?: Date
  ): Promise<Date | undefined> {
    try {
      const nextRun = this._computeNextRun(expression, reference);
      if (!nextRun) {
        return undefined;
      }
      await this._store.schedule(moduleId, nextRun.getTime());
      this._logger.debug?.(
        `scheduled ${moduleId} for ${nextRun.toISOString()}`
      );
      return nextRun;
    } catch (error) {
      this._logger.error(
        `failed to schedule cron module ${moduleId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return undefined;
    }
  }

  private _startPolling() {
    if (this._polling) {
      return;
    }
    this._polling = true;

    const poll = async () => {
      while (this._polling) {
        try {
          const due = await this._store.popDue(Date.now());
          if (!due) {
            await sleep(this._config.pollIntervalMs);
            continue;
          }
          await this._executeModule(due.moduleId, due.dueAt);
        } catch (error) {
          this._logger.error(
            `cron scheduler loop failed: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
          await sleep(this._config.pollIntervalMs);
        }
      }
    };

    void poll();
  }

  private async _executeModule(moduleId: string, scheduledFor: number) {
    const entry = this._registry.get(moduleId);
    if (!entry) {
      this._logger.warn(
        `module ${moduleId} is not registered locally, requeueing`
      );
      await this._store.schedule(
        moduleId,
        scheduledFor + this._config.requeueDelayMs
      );
      return;
    }

    const nextRun = await this._scheduleNextRun(
      moduleId,
      entry.expression,
      new Date(scheduledFor)
    );
    const now = Date.now();
    if (
      nextRun &&
      now - scheduledFor >
        Math.max(nextRun.getTime() - scheduledFor, this._config.pollIntervalMs)
    ) {
      this._logger.warn(
        `dropping stale cron job ${moduleId} scheduled for ${new Date(
          scheduledFor
        ).toISOString()}`
      );
      return;
    }

    this._logger.info(
      `invoking cron job ${moduleId} scheduled for ${new Date(
        scheduledFor
      ).toISOString()}`
    );
    try {
      await dispatchModule(entry.module, {});
    } catch (error) {
      this._logger.error(
        `cron job ${moduleId} failed: ${
          error instanceof Error ? error.stack ?? error.message : String(error)
        }`
      );
    }
  }

  private _computeNextRun(
    expression: string,
    reference?: Date
  ): Date | undefined {
    try {
      const base =
        reference instanceof Date
          ? new Date(reference.getTime() + 1000)
          : new Date();
      const cron = CronExpressionParser.parse(expression, {
        currentDate: base,
      });
      return cron.next().toDate();
    } catch (error) {
      this._logger.error(
        `failed to compute next run for ${expression}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return undefined;
    }
  }

  private _isExpressionValid(expression: string, moduleId: string): boolean {
    try {
      CronExpressionParser.parse(expression);
      return true;
    } catch (error) {
      this._logger.error(
        `invalid cron expression ${expression} for module ${moduleId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return false;
    }
  }
})();
