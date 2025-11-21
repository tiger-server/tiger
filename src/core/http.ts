import type { TigerPlugin, Tiger, ExtendedModule } from "../tiger.ts";
import { processWithMutableState } from "./common.ts"

import { BaseResolver } from "../resolver.ts"

import express from "express";
import cors from "cors";
import { getLogger } from "../logger.ts";

class HttpPlugin implements TigerPlugin {
  id: string = "http";
  private _server = express();
  private _logger = getLogger("http");
  
  setup(tiger: Tiger): void {
    const server = this._server;
    const logger = this._logger;
    server.use(cors())
  
    tiger.register(new class extends BaseResolver<object, object> {
      readonly protocol: string = "http";
      async define(path: string, _module: ExtendedModule<object, object>) {
        server.get(path, async (req, res) => {
          try {
            await processWithMutableState(_module, {req, res})
          } catch (error) {
            logger.error(`http handler error on ${path}: ${error}`)
            res.status(500).send("Internal Server Error");
          }
        })
      }
    })
  
    process.nextTick(() => {
      server.listen(9527);
    });
  }
}

export default new HttpPlugin();
