import axios from 'axios';

const GITHUB_API = 'https://api.github.com/repos/autobrr/autobrr/contents/internal/indexer/definitions';
const REFRESH_INTERVAL = 24 * 60 * 60 * 1000;

let knownDefinitions: Set<string> | null = null;

const normalize = (name: string): string =>
  name
    .toLowerCase()
    .replace(/\s*\(api\)\s*/g, '')
    .replace(/[\s_-]+/g, '')
    .replace(/^#/, '')
    .trim();

const fetchDefinitions = async () => {
  try {
    const response = await axios.get<{ name: string }[]>(GITHUB_API, { timeout: 15000 });
    const names = response.data
      .filter((f) => f.name.endsWith('.yaml'))
      .map((f) => normalize(f.name.replace(/\.yaml$/, '')));
    knownDefinitions = new Set(names);
    console.log(`Loaded ${names.length} Autobrr indexer definitions`);
  } catch (error) {
    console.error('Failed to fetch Autobrr definitions:', error);
  }
};

export const initDefinitionChecker = async () => {
  await fetchDefinitions();
  const jitter = Math.random() * 60000;
  setInterval(fetchDefinitions, REFRESH_INTERVAL + jitter);
};

export const hasDefinition = (name: string): boolean => {
  if (!knownDefinitions) return false;
  return knownDefinitions.has(normalize(name));
};
