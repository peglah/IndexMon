import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DashboardPage } from '../pages/DashboardPage';
import { useIndexers } from '../hooks/useIndexers';

vi.mock('../hooks/useIndexers');

const mockIndexers = [
  {
    id: 'prowlarr-1',
    name: 'TorrentLeech',
    status: 'up' as const,
    lastChecked: '2025-01-01T00:00:00Z',
    siteUrl: 'https://torrentleech.org',
    autobrr: { enabled: true, connected: true, monitoring: true, lastAnnounce: '2025-01-01T00:00:00Z' },
    autobrrMissing: false,
  },
  {
    id: 'prowlarr-2',
    name: 'HD-Space (API)',
    status: 'up' as const,
    lastChecked: '2025-01-01T00:00:00Z',
    siteUrl: 'https://hd-space.org',
    autobrr: { enabled: true, connected: true, monitoring: true, lastAnnounce: '2025-01-01T00:00:00Z' },
    autobrrMissing: false,
  },
];

const mockServices = {
  prowlarr: { ok: true },
  autobrr: { ok: true },
  qbittorrent: { ok: true, connectionStatus: 'connected' },
};

const renderDashboard = () => {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <DashboardPage />
    </QueryClientProvider>,
  );
};

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('renders loading state', () => {
    vi.mocked(useIndexers).mockReturnValue({ data: undefined, isLoading: true, isError: false } as never);
    renderDashboard();
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('renders error state', () => {
    vi.mocked(useIndexers).mockReturnValue({ data: undefined, isLoading: false, isError: true } as never);
    renderDashboard();
    expect(screen.getByText('Failed to load indexer data.')).toBeInTheDocument();
  });

  it('renders indexer table and status grid with mock data', () => {
    vi.mocked(useIndexers).mockReturnValue({
      data: { indexers: mockIndexers, services: mockServices },
      isLoading: false,
      isError: false,
    } as never);
    renderDashboard();
    expect(screen.getAllByText('TorrentLeech')).toHaveLength(2);
    expect(screen.getAllByText('HD-Space')).toHaveLength(2);
    expect(screen.getByText('Indexer Status Dashboard')).toBeInTheDocument();
  });
});
