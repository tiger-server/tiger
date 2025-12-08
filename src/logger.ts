import pino from "pino";
import pretty from "pino-pretty";

const level = process.env.TIGER_LOG_LEVEL || "info";
const logFile = process.env.TIGER_LOG_DEST ?? "tiger.log";

const prettyStream = pretty({
  colorize: true,
  translateTime: "SYS:yyyy-mm-dd HH:MM:ss",
  ignore: "pid,hostname,time"
});

const streams: pino.StreamEntry[] = [{ stream: prettyStream }];

if (logFile) {
  streams.push({ stream: pino.destination({ dest: logFile, sync: true }) });
}

const destination =
  streams.length > 1 ? pino.multistream(streams) : streams[0].stream;

const rootLogger = pino({ level }, destination);

export type Logger = pino.Logger;

export function getLogger(scope: string): Logger {
  return rootLogger.child({ scope });
}
