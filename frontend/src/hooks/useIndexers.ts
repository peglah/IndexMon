import { useQuery } from '@tanstack/react-query';
import axios from '../utils/axios';
import { Indexer, ServicesStatus } from '../types';

const POLLING_INTERVAL_MS = 15_000;

interface IndexerResponse {
  indexers: Indexer[];
  services: ServicesStatus;
}

const fetchIndexers = async (): Promise<IndexerResponse> => {
  const response = await axios.get('/api/indexers');
  return response.data;
};

export const useIndexers = () => {
  return useQuery({
    queryKey: ['indexers'],
    queryFn: fetchIndexers,
    refetchInterval: POLLING_INTERVAL_MS,
    retry: 2,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10000),
});
};