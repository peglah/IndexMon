import { render, screen, fireEvent } from '@testing-library/react';
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
    lastChecked: '2026-05-27T00:00:00Z',
    siteUrl: 'https://torrentleech.org',
    autobrr: { enabled: true, connected: true, monitoring: true, lastAnnounce: '2026-05-27T00:00:00Z' },
    autobrrMissing: false,
  },
  {
    id: 'prowlarr-2',
    name: 'HD-Space (API)',
    status: 'up' as const,
    lastChecked: '2026-05-27T00:00:00Z',
    siteUrl: 'https://hd-space.org',
    autobrr: { enabled: true, connected: true, monitoring: true, lastAnnounce: '2026-05-27T00:00:00Z' },
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

  it('renders generic error state', () => {
    vi.mocked(useIndexers).mockReturnValue({ data: undefined, isLoading: false, isError: true, error: new Error('Network failure') } as never);
    renderDashboard();
    expect(screen.getByText('Failed to load indexer data.')).toBeInTheDocument();
  });

  it('renders error detail from API response', () => {
    const apiError = {
      response: { data: { detail: 'Prowlarr is unreachable' } },
      message: 'Request failed',
    } as never;
    vi.mocked(useIndexers).mockReturnValue({ data: undefined, isLoading: false, isError: true, error: apiError } as never);
    renderDashboard();
    expect(screen.getByText('Prowlarr is unreachable')).toBeInTheDocument();
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

  it('renders last checked timestamp', () => {
    vi.mocked(useIndexers).mockReturnValue({
      data: { indexers: mockIndexers, services: mockServices },
      isLoading: false,
      isError: false,
    } as never);
    renderDashboard();
    expect(screen.getByText(/Last checked:/)).toBeInTheDocument();
    expect(screen.getByText((content) => content.includes('Last checked:') && content.includes('2026'))).toBeInTheDocument();
  });

  it('toggles dark mode on button click', () => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
    vi.mocked(useIndexers).mockReturnValue({
      data: { indexers: mockIndexers, services: mockServices },
      isLoading: false,
      isError: false,
    } as never);
    renderDashboard();

    const btn = screen.getByRole('button', { name: 'Toggle theme' });
    expect(btn).toBeInTheDocument();

    expect(document.documentElement.classList.contains('dark')).toBe(false);

    fireEvent.click(btn);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem('theme')).toBe('dark');

    fireEvent.click(btn);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(localStorage.getItem('theme')).toBe('light');
  });
});
