export interface AutobrrStatus {
  enabled: boolean;
  connected: boolean;
  monitoring: boolean;
  lastAnnounce: string | null;
}

export interface Indexer {
  id: string;
  name: string;
  status: 'up' | 'down';
  lastChecked: string;
  downtimeMinutes?: number;
  autobrrDowntimeMinutes?: number;
  qbDowntimeMinutes?: number;
  uptimePercentage?: number;
  autobrrUptimePercentage?: number;
  qbUptimePercentage?: number;
  autobrr?: AutobrrStatus | null;
  autobrrMissing?: boolean;
  siteUrl?: string;
  qbittorrent?: QbitStatus | null;
}

export interface QbitTorrentStatus {
  code: number;
  msg?: string;
  seeds?: number;
}

export interface QbitStatus {
  working: boolean;
  hasTorrents: boolean;
  statuses: QbitTorrentStatus[];
  lastChecked: string;
}

export interface IndexerHistory {
  indexerId: string;
  name: string;
  status: 'up' | 'down';
  timestamp: string;
}