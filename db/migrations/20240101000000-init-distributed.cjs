"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("distributed_nodes", {
      id: {
        type: Sequelize.STRING,
        allowNull: false,
        primaryKey: true,
      },
      enabled: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      desired_enabled: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      monitor_url: {
        type: Sequelize.TEXT,
      },
      management_url: {
        type: Sequelize.TEXT,
      },
      last_heartbeat: {
        type: Sequelize.DATE,
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

    await queryInterface.createTable("distributed_module_states", {
      module_id: {
        type: Sequelize.STRING,
        allowNull: false,
        primaryKey: true,
      },
      state: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      updated_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.fn("NOW"),
      },
    });

    await queryInterface.createTable("distributed_jobs", {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal("gen_random_uuid()"),
        primaryKey: true,
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
        defaultValue: "queued",
      },
      scheduled_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.fn("NOW"),
      },
      locked_by: {
        type: Sequelize.STRING,
      },
      locked_at: {
        type: Sequelize.DATE,
      },
      attempts: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
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

    await queryInterface.addIndex("distributed_jobs", ["module_id", "status"]);
  },

  async down(queryInterface) {
    await queryInterface.dropTable("distributed_jobs");
    await queryInterface.dropTable("distributed_module_states");
    await queryInterface.dropTable("distributed_nodes");
  },
};
