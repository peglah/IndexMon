import { fetchIndexers } from './indexer';

export const pollIndexers = () => {
  const interval = parseInt(process.env.POLLING_INTERVAL_MS || '30000', 10);
  
  // Initial fetch
  fetchIndexers().catch(console.error);
  
  // Poll at intervals
  setInterval(() => {
    fetchIndexers().catch(console.error);
  }, interval);
};