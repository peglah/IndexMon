export interface AutobrrStatus {
  enabled: boolean;
  connected: boolean;
  monitoring: boolean;
  lastAnnounce: string | null;
}

export interface TrackerStats {
  uploaded: number;
  downloaded: number;
  ratio: number | null;
  buffer: number;
  warning?: boolean;
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
  stats?: TrackerStats;
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

export interface ServiceStatus {
  ok: boolean;
  configured?: boolean;
  connectionStatus?: string;
  portOpen?: boolean | null;
}

export interface ServicesStatus {
  prowlarr: ServiceStatus;
  autobrr: ServiceStatus;
  qbittorrent: ServiceStatus;
}