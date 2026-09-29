type LogLevel = 'info' | 'warn' | 'error' | 'debug';

interface LogContext {
  [key: string]: unknown;
}

export const logger = {
  info: (message: string, context?: LogContext) => {
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'info' as LogLevel,
        message,
        ...context,
      })
    );
  },
  warn: (message: string, context?: LogContext) => {
    console.warn(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'warn' as LogLevel,
        message,
        ...context,
      })
    );
  },
  error: (message: string, error?: unknown, context?: LogContext) => {
    console.error(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'error' as LogLevel,
        message,
        error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : error,
        ...context,
      })
    );
  },
  debug: (message: string, context?: LogContext) => {
    if (process.env.DEBUG || process.env.NODE_ENV === 'development') {
      console.debug(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: 'debug' as LogLevel,
          message,
          ...context,
        })
      );
    }
  },
};
