import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Indexer } from '../types';

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

const StatusCell = ({
  status,
  downtimeMinutes,
  uptimePercentage,
}: {
  status: 'up' | 'down';
  downtimeMinutes?: number;
  uptimePercentage?: number;
}) => {
  const content = status === 'up' ? (
    <span className="text-green-600 dark:text-green-400 font-semibold">UP</span>
  ) : downtimeMinutes !== undefined ? (
    <span className="bg-red-100 dark:bg-red-900/60 text-red-800 dark:text-red-200 px-2 py-1 rounded-full text-xs font-semibold">
      {formatDuration(downtimeMinutes)}
    </span>
  ) : (
    <span className="text-yellow-600 dark:text-yellow-400 font-semibold">DOWN</span>
  );

  return <UptimeTooltip uptimePercentage={uptimePercentage}>{content}</UptimeTooltip>;
};

export const IndexerTable = ({ indexers }: { indexers: Indexer[] }) => {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-8"></TableHead>
          <TableHead>Indexer</TableHead>
          <TableHead>Prowlarr</TableHead>
          <TableHead>Autobrr</TableHead>
          <TableHead>qBittorrent</TableHead>
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
                  <StatusCell status={abUp ? 'up' : 'down'} uptimePercentage={indexer.autobrrUptimePercentage} />
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell>
                {indexer.qbittorrent?.hasTorrents ? (
                  indexer.qbittorrent.working ? (
                    <UptimeTooltip uptimePercentage={indexer.qbUptimePercentage}>
                      <span className="text-green-600 dark:text-green-400 font-semibold">WORKING</span>
                    </UptimeTooltip>
                  ) : (
                    <UptimeTooltip uptimePercentage={indexer.qbUptimePercentage}>
                      <span className="text-red-600 dark:text-red-400 font-semibold">ERROR</span>
                    </UptimeTooltip>
                  )
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
};
