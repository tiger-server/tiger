"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("distributed_job_histories", {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal("gen_random_uuid()"),
        primaryKey: true,
      },
      job_id: {
        type: Sequelize.UUID,
        allowNull: false,
      },
      module_id: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      payload: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      status: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      worker_id: {
        type: Sequelize.STRING,
      },
      started_at: {
        type: Sequelize.DATE,
      },
      finished_at: {
        type: Sequelize.DATE,
      },
      error: {
        type: Sequelize.TEXT,
      },
      created_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.fn("NOW"),
      },
    });
    await queryInterface.addIndex("distributed_job_histories", ["module_id", "status"]);

    await queryInterface.createTable("cron_schedules", {
      module_id: {
        type: Sequelize.STRING,
        allowNull: false,
        primaryKey: true,
      },
      expression: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      next_run: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      created_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.fn("NOW"),
      },
      updated_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.fn("NOW"),
      },
    });
    await queryInterface.addIndex("distributed_jobs", ["module_id", "scheduled_at"], {
      unique: true,
      name: "distributed_jobs_module_schedule_unique",
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex("distributed_jobs", "distributed_jobs_module_schedule_unique");
    await queryInterface.dropTable("cron_schedules");
    await queryInterface.dropTable("distributed_job_histories");
  },
};
