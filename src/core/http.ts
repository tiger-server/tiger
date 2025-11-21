import { TigerPlugin, Tiger, ExtendedModule } from "../tiger";
import { processWithMutableState } from "./common"

import { BaseResolver } from "../resolver"

import express = require("express");
import cors = require("cors");

class HttpPlugin implements TigerPlugin {
  id: string = "http";
  private _server = express();
  
  setup(tiger: Tiger): void {
    const server = this._server;
    server.use(cors())
  
    tiger.register(new class extends BaseResolver<object, object> {
      readonly protocol: string = "http";
      define(path: string, _module: ExtendedModule<object, object>) {
        server.get(path, (req, res) => {
          processWithMutableState(_module, {req, res})
        })
      }
    })
  
    process.nextTick(() => {
      server.listen(9527);
    });
  }
}

export default new HttpPlugin();