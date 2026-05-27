const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
type Level = keyof typeof LEVELS;

const currentLevel: number = LEVELS[(process.env.LOG_LEVEL as Level) ?? 'info'] ?? LEVELS.info;

const timestamp = (): string => new Date().toISOString();

const makeLogger = (requestId?: string) => {
  const log = (level: string, method: 'log' | 'warn' | 'error', args: unknown[]) => {
    const entry: Record<string, unknown> = { timestamp: timestamp(), level };
    if (requestId) entry.requestId = requestId;

    const parts: string[] = [];
    for (const a of args) {
      if (a instanceof Error) {
        parts.push(a.message);
        if (level === 'error') {
          entry.stack = a.stack?.split('\n').slice(0, 5).join('\n');
        }
      } else if (typeof a === 'object' && a !== null) {
        Object.assign(entry, a);
      } else {
        parts.push(String(a));
      }
    }
    entry.msg = parts.join(' ');
    console[method](JSON.stringify(entry));
  };

  return {
    debug: (...args: unknown[]) => { if (currentLevel <= LEVELS.debug) log('debug', 'log', args); },
    info: (...args: unknown[]) => { if (currentLevel <= LEVELS.info) log('info', 'log', args); },
    warn: (...args: unknown[]) => { if (currentLevel <= LEVELS.warn) log('warn', 'warn', args); },
    error: (...args: unknown[]) => { if (currentLevel <= LEVELS.error) log('error', 'error', args); },
    child: (id: string) => makeLogger(id),
  };
};

export const logger = makeLogger();
