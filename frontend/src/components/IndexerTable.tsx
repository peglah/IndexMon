import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Indexer, ServicesStatus } from '../types';

const MINUTE = 1;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

const formatDuration = (minutes: number): string => {
  if (minutes < 1) return '0m';
  if (minutes < HOUR) return `${Math.floor(minutes)}m`;
  if (minutes < DAY) return `${Math.floor(minutes / HOUR)}h`;
  if (minutes < WEEK) return `${Math.floor(minutes / DAY)}d`;
  if (minutes < MONTH) return `${Math.floor(minutes / WEEK)}w`;
  if (minutes < YEAR) return `${Math.floor(minutes / MONTH)}M`;
  return `${Math.floor(minutes / YEAR)}y`;
};

const formatBytes = (bytes: number): string => {
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let unitIdx = 0;
  let value = Math.abs(bytes);
  while (value >= 1024 && unitIdx < units.length - 1) {
    value /= 1024;
    unitIdx++;
  }
  const decimals = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(decimals)} ${units[unitIdx]}`;
};

const UptimeTooltip = ({ uptimePercentage, children }: { uptimePercentage?: number; children: React.ReactNode }) => (
  <div className="group relative inline-flex">
    {children}
    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-10 pointer-events-none">
      <div className="bg-popover text-popover-foreground text-xs font-medium px-2 py-1 rounded shadow-md border border-border whitespace-nowrap">
        24h: {uptimePercentage?.toFixed(0) ?? 'N/A'}%
      </div>
    </div>
  </div>
);

const BufferTooltip = ({ stats, children }: { stats: { uploaded: number; downloaded: number; ratio: number | null }; children: React.ReactNode }) => (
  <div className="group relative inline-flex">
    {children}
    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-10 pointer-events-none">
      <div className="bg-popover text-popover-foreground text-xs font-medium px-2 py-1 rounded shadow-md border border-border whitespace-nowrap">
        Uploaded: {formatBytes(stats.uploaded)} &middot; Downloaded: {formatBytes(stats.downloaded)} &middot; Ratio: {stats.ratio !== null ? stats.ratio.toFixed(2) : '∞'}
      </div>
    </div>
  </div>
);

const StatusCell = ({
  status,
  downtimeMinutes,
  uptimePercentage,
  upLabel = 'UP',
  downLabel = 'DOWN',
}: {
  status: 'up' | 'down';
  downtimeMinutes?: number;
  uptimePercentage?: number;
  upLabel?: string;
  downLabel?: string;
}) => {
  const content = status === 'up' ? (
    <span className="text-green-600 dark:text-green-400 font-semibold">{upLabel}</span>
  ) : downtimeMinutes !== undefined ? (
    <span className="bg-red-100 dark:bg-red-900/60 text-red-800 dark:text-red-200 px-2 py-1 rounded-full text-xs font-semibold">
      {formatDuration(downtimeMinutes)}
    </span>
  ) : (
    <span className="text-yellow-600 dark:text-yellow-400 font-semibold">{downLabel}</span>
  );

  return <UptimeTooltip uptimePercentage={uptimePercentage}>{content}</UptimeTooltip>;
};

const CheckIcon = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}><polyline points="20 6 9 17 4 12"/></svg>
);

const XIcon = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
);

const ShieldIcon = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
);

const serviceIcon = (ok: boolean, connectionStatus?: string) => {
  if (!ok) return <XIcon className="text-red-500" />;
  if (connectionStatus === 'firewalled') return <ShieldIcon className="text-yellow-500" />;
  return <CheckIcon className="text-green-500" />;
};

const ServiceHeader = ({ label, ok, connectionStatus }: { label: string; ok: boolean; connectionStatus?: string }) => (
  <TableHead>
    <span className="inline-flex items-center gap-1.5">
      {label}
      {serviceIcon(ok, connectionStatus)}
    </span>
  </TableHead>
);

const BufferCell = ({ stats }: { stats: { uploaded: number; downloaded: number; ratio: number | null; buffer: number } }) => {
  const sign = stats.buffer > 0 ? '+' : stats.buffer < 0 ? '-' : '';
  const ratioColor = stats.ratio === null ? 'text-green-500' : stats.ratio < 0.8 ? 'text-red-500' : stats.ratio <= 1.2 ? 'text-yellow-500' : 'text-green-500';
  return (
    <BufferTooltip stats={stats}>
      <span className={`font-semibold ${ratioColor}`}>
        {sign}{formatBytes(Math.abs(stats.buffer))}
      </span>
    </BufferTooltip>
  );
};

export const IndexerTable = ({ indexers, services }: { indexers: Indexer[]; services?: ServicesStatus }) => {
  const hasStats = indexers.some((i) => i.stats !== undefined);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-8"></TableHead>
          <TableHead>Indexer</TableHead>
          <ServiceHeader label="Prowlarr" ok={!!services?.prowlarr.ok} />
          <ServiceHeader label="Autobrr" ok={!!services?.autobrr.ok} />
          <ServiceHeader label="qBittorrent" ok={!!services?.qbittorrent.ok} connectionStatus={services?.qbittorrent.connectionStatus} />
          {hasStats && <TableHead>Buffer</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {indexers.map((indexer) => {
          const abUp = !!(indexer.autobrr?.connected && indexer.autobrr?.monitoring);
          return (
            <TableRow key={indexer.id}>
              <TableCell className="w-8 p-1">
                <img
                  src={`/api/indexers/icon/${indexer.id.replace('prowlarr-', '')}`}
                  alt=""
                  className="w-5 h-5"
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                />
              </TableCell>
              <TableCell className="font-medium">
                {indexer.siteUrl ? (
                  <a href={indexer.siteUrl} target="_blank" rel="noreferrer" className="hover:underline">
                    {indexer.name.replace(/\s*\(API\)/gi, '')}
                  </a>
                ) : (
                  indexer.name.replace(/\s*\(API\)/gi, '')
                )}
              </TableCell>
              <TableCell>
                <StatusCell status={indexer.status} downtimeMinutes={indexer.downtimeMinutes} uptimePercentage={indexer.uptimePercentage} />
              </TableCell>
              <TableCell>
                {indexer.autobrrMissing ? (
                  <span className="text-gray-400 dark:text-gray-500 font-semibold">MISSING</span>
                ) : indexer.autobrr ? (
                  <StatusCell status={abUp ? 'up' : 'down'} downtimeMinutes={indexer.autobrrDowntimeMinutes} uptimePercentage={indexer.autobrrUptimePercentage} />
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell>
                {indexer.qbittorrent?.hasTorrents ? (
                  <StatusCell status={indexer.qbittorrent.working ? 'up' : 'down'} downtimeMinutes={indexer.qbDowntimeMinutes} uptimePercentage={indexer.qbUptimePercentage} upLabel="WORKING" downLabel="ERROR" />
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              {hasStats && (
                <TableCell>
                  {indexer.stats ? (
                    <BufferCell stats={indexer.stats} />
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
              )}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
};
