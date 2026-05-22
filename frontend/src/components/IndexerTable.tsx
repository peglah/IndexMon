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
  if (minutes < DAY) {
    const h = Math.floor(minutes / HOUR);
    const m = Math.floor(minutes % HOUR);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  if (minutes < WEEK) {
    const d = Math.floor(minutes / DAY);
    const h = Math.floor((minutes % DAY) / HOUR);
    return h > 0 ? `${d}d ${h}h` : `${d}d`;
  }
  if (minutes < MONTH) {
    const w = Math.floor(minutes / WEEK);
    const d = Math.floor((minutes % WEEK) / DAY);
    return d > 0 ? `${w}w ${d}d` : `${w}w`;
  }
  if (minutes < YEAR) {
    const M = Math.floor(minutes / MONTH);
    const w = Math.floor((minutes % MONTH) / WEEK);
    return w > 0 ? `${M}M ${w}w` : `${M}M`;
  }
  const y = Math.floor(minutes / YEAR);
  const M = Math.floor((minutes % YEAR) / MONTH);
  return M > 0 ? `${y}y ${M}M` : `${y}y`;
};

const StatusCell = ({
  status,
  downtimeMinutes,
}: {
  status: 'up' | 'down';
  downtimeMinutes?: number;
}) => {
  if (status === 'up') {
    return <span className="text-green-600 font-semibold">UP</span>;
  }
  if (downtimeMinutes !== undefined) {
    return (
      <span className="bg-red-100 text-red-800 px-2 py-1 rounded-full text-xs font-semibold">
        {formatDuration(downtimeMinutes)}
      </span>
    );
  }
  return <span className="text-yellow-600 font-semibold">DOWN</span>;
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
              <TableCell className="font-medium">{indexer.name.replace(/\s*\(API\)/gi, '')}</TableCell>
              <TableCell>
                <StatusCell status={indexer.status} downtimeMinutes={indexer.downtimeMinutes} />
              </TableCell>
              <TableCell>
                {indexer.autobrrMissing ? (
                  <span className="text-gray-400 font-semibold">MISSING</span>
                ) : indexer.autobrr ? (
                  <StatusCell status={abUp ? 'up' : 'down'} />
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
