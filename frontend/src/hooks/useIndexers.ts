import { useQuery } from '@tanstack/react-query';
import axios from '../utils/axios';
import { Indexer, IndexerHistory } from '../types';

const POLLING_INTERVAL_MS = 15_000;

const fetchIndexers = async (): Promise<Indexer[]> => {
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
  });
};

export const useIndexerHistory = () => {
  return useQuery({
    queryKey: ['indexerHistory'],
    queryFn: fetchIndexerHistory,
  });
};