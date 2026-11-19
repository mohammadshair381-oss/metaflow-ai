import type { LogLevel } from '../config/env';
import { redactForLog } from './redact';

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export type LogContext = Record<string, unknown>;

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
}

export interface LoggerOptions {
  level: LogLevel | 'silent';
  /** Output sink, one JSON line per call. Defaults to stdout/stderr. */
  write?: (line: string, level: LogLevel) => void;
}

const defaultWrite = (line: string, level: LogLevel) => {
  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  stream.write(`${line}\n`);
};

/**
 * Minimal structured JSON logger. Context is passed through redactForLog, so passwords,
 * tokens, cookies and connection-string credentials never reach the output.
 */
export function createLogger({ level, write = defaultWrite }: LoggerOptions): Logger {
  const threshold = level === 'silent' ? Number.POSITIVE_INFINITY : LEVEL_WEIGHT[level];

  const log = (entryLevel: LogLevel, message: string, context?: LogContext) => {
    if (LEVEL_WEIGHT[entryLevel] < threshold) return;
    const safeContext = context ? (redactForLog(context) as LogContext) : {};
    write(
      JSON.stringify({
        level: entryLevel,
        time: new Date().toISOString(),
        msg: message,
        ...safeContext,
      }),
      entryLevel,
    );
  };

  return {
    debug: (message, context) => log('debug', message, context),
    info: (message, context) => log('info', message, context),
    warn: (message, context) => log('warn', message, context),
    error: (message, context) => log('error', message, context),
  };
}
