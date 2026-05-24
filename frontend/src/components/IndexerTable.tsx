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

const StatusCell = ({
  status,
  downtimeMinutes,
}: {
  status: 'up' | 'down';
  downtimeMinutes?: number;
}) => {
  if (status === 'up') {
    return <span className="text-green-600 dark:text-green-400 font-semibold">UP</span>;
  }
  if (downtimeMinutes !== undefined) {
    return (
      <span className="bg-red-100 dark:bg-red-900/60 text-red-800 dark:text-red-200 px-2 py-1 rounded-full text-xs font-semibold">
        {formatDuration(downtimeMinutes)}
      </span>
    );
  }
  return <span className="text-yellow-600 dark:text-yellow-400 font-semibold">DOWN</span>;
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
          <TableHead>Availability</TableHead>
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
                <StatusCell status={indexer.status} downtimeMinutes={indexer.downtimeMinutes} />
              </TableCell>
              <TableCell>
                {indexer.autobrrMissing ? (
                  <span className="text-gray-400 dark:text-gray-500 font-semibold">MISSING</span>
                ) : indexer.autobrr ? (
                  <StatusCell status={abUp ? 'up' : 'down'} />
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell>
                {indexer.qbittorrent?.hasTorrents ? (
                  indexer.qbittorrent.working ? (
                    <span className="text-green-600 dark:text-green-400 font-semibold">WORKING</span>
                  ) : (
                    <span className="text-red-600 dark:text-red-400 font-semibold">ERROR</span>
                  )
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell>{indexer.uptimePercentage?.toFixed(0) || 'N/A'}%</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
};
