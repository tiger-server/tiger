import type { TigerPlugin, Tiger } from "../tiger.ts";
import { BaseResolver } from "../resolver.ts"
import { getLogger, type Logger } from "../logger.ts";
import nodemailer from "nodemailer";

interface MailParam {
  subject: string
  text: string
  html: string
}

export default new class implements TigerPlugin {
  id: string = "mail";  
  _logger: Logger = getLogger("mail")

  setup(tiger: Tiger): void {
    const logger = this._logger;
    const config = tiger.config.mail

    if (!config) {
      logger.warn("mail plugin requires configuration; skipping setup");
      return;
    }

    const transport = nodemailer.createTransport(config.transport);

    tiger.register(new class extends BaseResolver<MailParam, object> {
      readonly protocol: string = "mail"
      async notified(target: string, param: MailParam) {
        logger.info(`Sending mail to ${target}: ${JSON.stringify(param)}`)
        const option = { from: config.sender, to: target, ...param }
        await transport.sendMail(option)
      }
    });
  }
}
