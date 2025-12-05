import type { TigerPlugin, Tiger, ExtendedModule } from "../tiger.ts";
import { BaseResolver } from "../resolver.ts";

import express from "express";
import cors from "cors";
import { getLogger } from "../logger.ts";
import { resolveHttpConfig } from "../config.ts";
import { dispatchModule } from "../runner.ts";

class HttpPlugin implements TigerPlugin {
  id: string = "http";
  private _server = express();
  private _logger = getLogger("http");
  
  setup(tiger: Tiger): void {
    const server = this._server;
    const logger = this._logger;
    server.use(cors())
    const httpConfig = resolveHttpConfig(tiger.config);
  
    tiger.register(new class extends BaseResolver<object, object> {
      readonly protocol: string = "http";
      async define(path: string, _module: ExtendedModule<object, object>) {
        if (_module.distributed) {
          throw new Error("http resolver does not support distributed modules");
        }
        server.get(path, async (req, res) => {
          try {
            await dispatchModule(_module, { req, res });
          } catch (error) {
            logger.error(`http handler error on ${path}: ${error}`)
            res.status(500).send("Internal Server Error");
          }
        })
      }
    })
  
    process.nextTick(() => {
      server.listen(httpConfig.port, httpConfig.host, () => {
        logger.info(
          `http server listening on http://${httpConfig.host}:${httpConfig.port}`
        );
      });
    });
  }
}

export default new HttpPlugin();
