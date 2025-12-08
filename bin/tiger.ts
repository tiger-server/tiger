#!/usr/bin/env node

import { Command } from "commander";
import { Tiger, type TigerSetup } from "../src/index.js";
import path from "node:path";
import { fileURLToPath } from 'node:url';

import { assign } from "radash";


import { Umzug, SequelizeStorage } from "umzug";
import { Sequelize } from "sequelize";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Determine migrations path based on whether running TS or JS
const migrationsPath = __filename.endsWith(".ts") ?
  path.resolve(__dirname, "..", "db", "migrations") :
  path.resolve(__dirname, "..", "..", "db", "migrations");

const program = new Command("tiger-server");

let configPath = ".tigerconf.json";

program.option("-c, --config <path>", "Path to the Tiger config file", ".tigerconf.json");

program.command("setup").description("Setup Tiger Server")
  .alias("upgrade")
  .argument("[action]", "Action to perform", "up")
  .action(async (action) => {
    dotenv.config();
    const { sequelize } = await import(path.resolve(__dirname, "..", "src", "db", "sequelize.js"));
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
    dotenv.config();
    const { DEFAULT_CONFIG } = await import(path.resolve(__dirname, "..", "src", "config.js"));
    configPath = program.opts().config;
    
    let localDirConfig = {};
    try {
      const localConfigPath = path.resolve(process.cwd(), configPath);
      console.log(`Loaded local config from ${localConfigPath}`);
      localDirConfig = await import(localConfigPath, { with: { type: "json" } }).then(mod => mod.default);
    } catch (e) {
      console.warn(`No local config found at ${configPath}, using defaults.`);
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

async function main() {
  await program.parseAsync(process.argv);
}

main().catch((error) => {
  console.error("Error running tiger-server:", error);
});
