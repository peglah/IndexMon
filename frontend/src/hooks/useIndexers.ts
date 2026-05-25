import { useQuery } from '@tanstack/react-query';
import axios from '../utils/axios';
import { Indexer, IndexerHistory, ServicesStatus } from '../types';

const POLLING_INTERVAL_MS = 15_000;

interface IndexerResponse {
  indexers: Indexer[];
  services: ServicesStatus;
}

const fetchIndexers = async (): Promise<IndexerResponse> => {
  const response = await axios.get('/api/indexers');
  return response.data;
};

const fetchIndexerHistory = async (): Promise<IndexerHistory[]> => {
  const response = await axios.get('/api/indexers/history');
  return response.data;
};

export const useIndexers = () => {
  return useQuery({
    queryKey: ['indexers'],
    queryFn: fetchIndexers,
    refetchInterval: POLLING_INTERVAL_MS,
    retry: false,
  });
};

export const useIndexerHistory = () => {
  return useQuery({
    queryKey: ['indexerHistory'],
    queryFn: fetchIndexerHistory,
    retry: false,
  });
};