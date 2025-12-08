#!/usr/bin/env node

import { Command, Option } from "commander";
import { Tiger, type TigerSetup } from "../src/index.ts";
import path from "node:path";
import { fileURLToPath } from 'node:url';

import { assign } from "radash";


import { Umzug, SequelizeStorage } from "umzug";
import { Sequelize } from "sequelize";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsPath = path.resolve(__dirname, "..", "db", "migrations");

const program = new Command("tiger-server");

dotenv.config();

let configPath = ".tigerconf.json";

program.option("-c, --config <path>", "Path to the Tiger config file", ".tigerconf.json");

program.command("setup").description("Setup Tiger Server")
  .alias("upgrade")
  .argument("[action]", "Action to perform", "up")
  .action(async (action) => {
    const { sequelize } = await import("../src/db/sequelize.ts");
    const umzug = new Umzug({
      migrations: {
        glob: ["*.cjs", { cwd: migrationsPath }], resolve: ({ name, path, context }) => {
          return {
            name,
            up: async () => {
              const { default: migration } = await import(path!);
              migration.up(context, Sequelize);
            },
            down: async () => {
              const { default: migration } = await import(path!);
              migration.up(context, Sequelize);
            }
          }
        }
      },
      context: sequelize.getQueryInterface(),
      storage: new SequelizeStorage({ sequelize }),
      logger: console,
    });
    if (action === "up") {
      await umzug.up();
      console.log("Tiger Server setup completed.");
    } else if (action === "down") {
      await umzug.down();
      console.log("Tiger Server rolled back.");
    }
  });

program.command("run").description("Run Tiger Server")
  .argument("<target>", "Path to the Tiger setup module")
  .action(async (target: string) => {
    const { DEFAULT_CONFIG } = await import("../src/config.ts");
    configPath = program.opts().config;
    
    let localDirConfig = {};
    try {
      const localConfigPath = path.resolve(process.cwd(), configPath);
      console.log(`Loaded local config from ${localConfigPath}`);
      localDirConfig = await import(localConfigPath, { with: { type: "json" } }).then(mod => mod.default);
    } catch (e) {
      console.log(e);
      // No local config found, proceed with defaults
    }

    const tigerModulePath = path.isAbsolute(target) ? target : path.resolve(process.cwd(), target);
    const { default: setup }: { default: TigerSetup } = await import(tigerModulePath);
    const defaultConfig = { ... DEFAULT_CONFIG};
    let mergedConfig = assign(defaultConfig, localDirConfig);
    mergedConfig = setup.config ? assign(mergedConfig, setup.config) : mergedConfig;
    const tiger = new Tiger(mergedConfig);
    await setup.call(tiger);
    await tiger.serve();
  });

program.parse(process.argv);
