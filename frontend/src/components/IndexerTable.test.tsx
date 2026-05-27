import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { IndexerTable } from './IndexerTable';

const baseIndexer = {
  id: 'prowlarr-1',
  name: 'Test Indexer',
  status: 'up' as const,
  lastChecked: '2026-05-27T00:00:00Z',
};

const defaultServices = {
  prowlarr: { ok: true },
  autobrr: { ok: true },
  qbittorrent: { ok: true, connectionStatus: 'connected' },
};

describe('IndexerTable', () => {
  it('renders indexer names', () => {
    render(<IndexerTable indexers={[{ ...baseIndexer }]} services={defaultServices} />);
    expect(screen.getByText('Test Indexer')).toBeInTheDocument();
  });

  it('renders all service headers', () => {
    render(<IndexerTable indexers={[{ ...baseIndexer }]} services={defaultServices} />);
    expect(screen.getByText('Prowlarr')).toBeInTheDocument();
    expect(screen.getByText('Autobrr')).toBeInTheDocument();
    expect(screen.getByText('qBittorrent')).toBeInTheDocument();
  });

  it('shows UP for prowlarr status when indexer is up', () => {
    render(<IndexerTable indexers={[{ ...baseIndexer }]} services={defaultServices} />);
    expect(screen.getByText('UP')).toBeInTheDocument();
  });

  it('shows down duration for prowlarr status when indexer is down with downtime', () => {
    render(<IndexerTable indexers={[{ ...baseIndexer, status: 'down', downtimeMinutes: 75 }]} services={defaultServices} />);
    expect(screen.getByText('1h')).toBeInTheDocument();
  });

  it('shows yellow DOWN label when indexer is down without downtime', () => {
    render(<IndexerTable indexers={[{ ...baseIndexer, status: 'down' }]} services={defaultServices} />);
    expect(screen.getByText('DOWN')).toBeInTheDocument();
  });

  it('renders dash for Autobrr when no autobrr data', () => {
    render(<IndexerTable indexers={[{ ...baseIndexer }]} services={defaultServices} />);
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBeGreaterThanOrEqual(1);
  });

  it('renders MISSING for Autobrr when autobrrMissing is true', () => {
    render(<IndexerTable indexers={[{ ...baseIndexer, autobrrMissing: true }]} services={defaultServices} />);
    expect(screen.getByText('MISSING')).toBeInTheDocument();
  });

  it('shows Autobrr UP when channel is connected and monitoring', () => {
    render(<IndexerTable indexers={[{
      ...baseIndexer,
      autobrr: { enabled: true, connected: true, monitoring: true, lastAnnounce: '2026-05-27T00:00:00Z' },
    }]} services={defaultServices} />);
    expect(screen.getAllByText('UP')).toHaveLength(2);
  });

  it('shows Autobrr down duration when channel is disconnected', () => {
    render(<IndexerTable indexers={[{
      ...baseIndexer,
      autobrr: { enabled: true, connected: false, monitoring: false, lastAnnounce: null },
      autobrrDowntimeMinutes: 30,
    }]} services={defaultServices} />);
    expect(screen.getByText('30m')).toBeInTheDocument();
  });

  it('renders dash for qBittorrent when indexer has no torrents', () => {
    render(<IndexerTable indexers={[{
      ...baseIndexer,
      qbittorrent: { working: true, hasTorrents: false, statuses: [], lastChecked: '2026-05-27T00:00:00Z' },
    }]} services={defaultServices} />);
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBeGreaterThanOrEqual(1);
  });

  it('shows WORKING for qBittorrent when working and has torrents', () => {
    render(<IndexerTable indexers={[{
      ...baseIndexer,
      qbittorrent: { working: true, hasTorrents: true, statuses: [], lastChecked: '2026-05-27T00:00:00Z' },
    }]} services={defaultServices} />);
    expect(screen.getByText('WORKING')).toBeInTheDocument();
  });

  it('shows ERROR for qBittorrent when not working but has torrents', () => {
    render(<IndexerTable indexers={[{
      ...baseIndexer,
      qbittorrent: { working: false, hasTorrents: true, statuses: [{ code: 2 }], lastChecked: '2026-05-27T00:00:00Z' },
      qbDowntimeMinutes: 5,
    }]} services={defaultServices} />);
    expect(screen.getByText('5m')).toBeInTheDocument();
  });

  it('renders status UP tooltip with 24h percentage on hover', () => {
    render(<IndexerTable indexers={[{
      ...baseIndexer, uptimePercentage: 99.5,
    }]} services={defaultServices} />);
    expect(screen.getByText('UP')).toBeInTheDocument();
  });

  it('hides buffer column when no indexers have stats', () => {
    render(<IndexerTable indexers={[{ ...baseIndexer }]} services={defaultServices} />);
    expect(screen.queryByText('Buffer')).not.toBeInTheDocument();
  });

  it('shows buffer column when an indexer has stats', () => {
    render(<IndexerTable indexers={[{
      ...baseIndexer,
      stats: { uploaded: 1073741824, downloaded: 536870912, ratio: 2.0, buffer: 536870912 },
    }]} services={defaultServices} />);
    expect(screen.getByText('Buffer')).toBeInTheDocument();
  });

  it('renders buffer value for indexer with stats', () => {
    render(<IndexerTable indexers={[{
      ...baseIndexer,
      stats: { uploaded: 2147483648, downloaded: 1073741824, ratio: 2.0, buffer: 1073741824 },
    }]} services={defaultServices} />);
    expect(screen.getByText((content) => content.includes('+') && content.includes('GB'))).toBeInTheDocument();
  });

  it('shows service unavailable icons', () => {
    render(<IndexerTable indexers={[{ ...baseIndexer }]} services={{
      prowlarr: { ok: false },
      autobrr: { ok: false },
      qbittorrent: { ok: false },
    }} />);
    expect(screen.getByText('Prowlarr')).toBeInTheDocument();
    expect(screen.getByText('Autobrr')).toBeInTheDocument();
    expect(screen.getByText('qBittorrent')).toBeInTheDocument();
  });

  it('links indexer name when siteUrl is provided', () => {
    render(<IndexerTable indexers={[{ ...baseIndexer, siteUrl: 'https://example.com' }]} services={defaultServices} />);
    const link = screen.getByText('Test Indexer').closest('a');
    expect(link).toHaveAttribute('href', 'https://example.com');
    expect(link).toHaveAttribute('target', '_blank');
  });
});
