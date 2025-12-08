import { Sequelize, DataTypes, Model } from "sequelize";
import type {
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from "sequelize";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://postgres:password@localhost:5432/postgres";

export const sequelize = new Sequelize(DATABASE_URL, {
  logging: false,
  dialect: "postgres",
});

export class DistributedNodeModel extends Model<
  InferAttributes<DistributedNodeModel>,
  InferCreationAttributes<DistributedNodeModel>
> {
  declare id: string;
  declare enabled: CreationOptional<boolean>;
  declare desiredEnabled: CreationOptional<boolean>;
  declare monitorUrl: string | null;
  declare managementUrl: string | null;
  declare lastHeartbeat: Date | null;
}
export class DistributedModuleStateModel extends Model<
  InferAttributes<DistributedModuleStateModel>,
  InferCreationAttributes<DistributedModuleStateModel>
> {
  declare moduleId: string;
  declare state: object;
}
export class DistributedJobModel extends Model<
  InferAttributes<DistributedJobModel>,
  InferCreationAttributes<DistributedJobModel>
> {
  declare id: CreationOptional<string>;
  declare moduleId: string;
  declare payload: unknown;
  declare status: CreationOptional<string>;
  declare scheduledAt: Date;
  declare lockedBy: string | null;
  declare lockedAt: Date | null;
  declare attempts: CreationOptional<number>;
}
export class DistributedJobHistoryModel extends Model<
  InferAttributes<DistributedJobHistoryModel>,
  InferCreationAttributes<DistributedJobHistoryModel>
> {
  declare id: CreationOptional<string>;
  declare jobId: string;
  declare moduleId: string;
  declare payload: unknown;
  declare status: string;
  declare workerId: string | null;
  declare startedAt: Date | null;
  declare finishedAt: CreationOptional<Date>;
  declare error: string | null;
}
export class CronScheduleModel extends Model<
  InferAttributes<CronScheduleModel>,
  InferCreationAttributes<CronScheduleModel>
> {
  declare moduleId: string;
  declare expression: string;
  declare nextRun: Date;
}

DistributedNodeModel.init(
  {
    id: {
      type: DataTypes.STRING,
      primaryKey: true,
    },
    enabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    desiredEnabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      field: "desired_enabled",
    },
    monitorUrl: {
      type: DataTypes.TEXT,
      field: "monitor_url",
    },
    managementUrl: {
      type: DataTypes.TEXT,
      field: "management_url",
    },
    lastHeartbeat: {
      type: DataTypes.DATE,
      field: "last_heartbeat",
    },
  },
  {
    modelName: "DistributedNode",
    tableName: "distributed_nodes",
    sequelize,
    timestamps: true,
    underscored: true,
  }
);

DistributedModuleStateModel.init(
  {
    moduleId: {
      type: DataTypes.STRING,
      allowNull: false,
      primaryKey: true,
      field: "module_id",
    },
    state: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: {},
    },
  },
  {
    modelName: "DistributedModuleState",
    tableName: "distributed_module_states",
    sequelize,
    timestamps: false,
    underscored: true,
  }
);

DistributedJobModel.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    moduleId: {
      type: DataTypes.STRING,
      allowNull: false,
      field: "module_id",
    },
    payload: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: {},
    },
    status: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "queued",
    },
    scheduledAt: {
      type: DataTypes.DATE,
      allowNull: false,
      field: "scheduled_at",
      defaultValue: Sequelize.fn("NOW"),
    },
    lockedBy: {
      type: DataTypes.STRING,
      field: "locked_by",
    },
    lockedAt: {
      type: DataTypes.DATE,
      field: "locked_at",
    },
    attempts: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
  },
  {
    modelName: "DistributedJob",
    tableName: "distributed_jobs",
    sequelize,
    timestamps: true,
    underscored: true,
  }
);

DistributedJobHistoryModel.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    jobId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: "job_id",
    },
    moduleId: {
      type: DataTypes.STRING,
      allowNull: false,
      field: "module_id",
    },
    payload: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: {},
    },
    status: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    workerId: {
      type: DataTypes.STRING,
      field: "worker_id",
    },
    startedAt: {
      type: DataTypes.DATE,
      field: "started_at",
    },
    finishedAt: {
      type: DataTypes.DATE,
      field: "finished_at",
    },
    error: {
      type: DataTypes.TEXT,
    },
  },
  {
    modelName: "DistributedJobHistory",
    tableName: "distributed_job_histories",
    sequelize,
    timestamps: true,
    updatedAt: false,
    underscored: true,
  }
);

CronScheduleModel.init(
  {
    moduleId: {
      type: DataTypes.STRING,
      primaryKey: true,
      field: "module_id",
    },
    expression: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    nextRun: {
      type: DataTypes.DATE,
      allowNull: false,
      field: "next_run",
    },
  },
  {
    modelName: "CronSchedule",
    tableName: "cron_schedules",
    sequelize,
    timestamps: true,
    underscored: true,
  }
);

export async function ensureDatabaseConnection(): Promise<void> {
  await sequelize.authenticate();
}
