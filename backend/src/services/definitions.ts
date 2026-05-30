import axios from 'axios';
import { randomUUID } from 'crypto';
import { logger } from '../utils/logger';
import { normalize } from '../utils/normalize';

const GITHUB_API = 'https://api.github.com/repos/autobrr/autobrr/contents/internal/indexer/definitions';
const REFRESH_INTERVAL = 24 * 60 * 60 * 1000;

let knownDefinitions = new Set<string>();

const fetchDefinitions = async () => {
  const log = logger.child(randomUUID());
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await axios.get<{ name: string }[]>(GITHUB_API, { timeout: 15000 });
      const names = response.data
        .filter((f) => f.name.endsWith('.yaml'))
        .map((f) => normalize(f.name.replace(/\.yaml$/, '')));
      knownDefinitions = new Set(names);
      log.info(`Loaded ${names.length} Autobrr indexer definitions`);
      return;
    } catch (error) {
      if (attempt < 2) {
        log.warn(`Retry attempt ${attempt + 1}/3 for Autobrr definitions`);
        await new Promise(r => setTimeout(r, Math.min(1000 * 2 ** attempt, 10000)));
      } else {
        log.error('Failed to fetch Autobrr definitions:', error);
      }
    }
  }
};

export const initDefinitionChecker = async () => {
  await fetchDefinitions();
  const jitter = (Math.random() - 0.5) * 60 * 60 * 1000;
  setInterval(fetchDefinitions, REFRESH_INTERVAL + jitter);
};

export const hasDefinition = (name: string): boolean => knownDefinitions.has(normalize(name));
