import { Op, Transaction } from "sequelize";

import { CronScheduleModel, sequelize } from "../../db/sequelize.ts";
import type { CronScheduleStore } from "./scheduler.ts";

export function createPostgresScheduleStore(): CronScheduleStore {
  return {
    async schedule(moduleId, timestamp) {
      await CronScheduleModel.update(
        { nextRun: new Date(timestamp) },
        { where: { moduleId } }
      );
    },
    async scheduleIfNotExists(moduleId, timestamp, expression) {
      await CronScheduleModel.findOrCreate({
        where: { moduleId },
        defaults: {
          expression,
          nextRun: new Date(timestamp),
        },
      });
    },
    async popDue(until) {
      return sequelize.transaction(
        { isolationLevel: Transaction.ISOLATION_LEVELS.READ_COMMITTED },
        async (transaction) => {
          const schedule = await CronScheduleModel.findOne({
            where: {
              nextRun: { [Op.lte]: new Date(until) },
            },
            order: [["nextRun", "ASC"]],
            lock: transaction.LOCK.UPDATE,
            skipLocked: true,
            transaction,
          });

          if (!schedule) {
            return undefined;
          }

          return {
            moduleId: schedule.moduleId,
            dueAt: schedule.nextRun.getTime(),
          };
        }
      );
    },
  };
}
