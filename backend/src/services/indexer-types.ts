import { QbitStatus } from './qbittorrent';
import { TrackerStats as TrackerStatsType } from './tracker-stats';

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
  stats?: TrackerStatsType;
}

export interface ServiceStatus {
  ok: boolean;
  configured?: boolean;
  connectionStatus?: string;
  portOpen?: boolean | null;
}

export interface ServiceStatuses {
  prowlarr: ServiceStatus;
  autobrr: ServiceStatus;
  qbittorrent: ServiceStatus;
  appriseConfigured: boolean;
}
