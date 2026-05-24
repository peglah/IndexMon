const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
type Level = keyof typeof LEVELS;

const currentLevel: number = LEVELS[(process.env.LOG_LEVEL as Level) ?? 'info'] ?? LEVELS.info;

const timestamp = (): string => new Date().toISOString();

export const logger = {
  debug: (...args: unknown[]) => {
    if (currentLevel <= LEVELS.debug) console.log(`[${timestamp()}] [DEBUG]`, ...args);
  },
  info: (...args: unknown[]) => {
    if (currentLevel <= LEVELS.info) console.log(`[${timestamp()}] [INFO]`, ...args);
  },
  warn: (...args: unknown[]) => {
    if (currentLevel <= LEVELS.warn) console.warn(`[${timestamp()}] [WARN]`, ...args);
  },
  error: (...args: unknown[]) => {
    if (currentLevel <= LEVELS.error) console.error(`[${timestamp()}] [ERROR]`, ...args);
  },
};
