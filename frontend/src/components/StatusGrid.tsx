import { useEffect, useMemo, useRef, useState } from 'react';
import { Indexer } from '../types';
import { stripApi } from '../utils/stripApi';

type TileStatus = 'red' | 'orange' | 'yellow' | 'amber' | 'grey' | 'green';

const tileColor = (status: TileStatus): string => {
  switch (status) {
    case 'red': return 'bg-red-500';
    case 'orange': return 'bg-orange-500';
    case 'yellow': return 'bg-yellow-400';
    case 'amber': return 'bg-amber-400';
    case 'grey': return 'bg-gray-400 dark:bg-gray-500';
    case 'green': return 'bg-green-500';
  }
};

const classify = (indexer: Indexer): TileStatus => {
  if (indexer.status === 'down') return 'red';
  if (indexer.qbittorrent?.hasTorrents && !indexer.qbittorrent.working) return 'orange';
  if (indexer.autobrr && !(indexer.autobrr.connected && indexer.autobrr.monitoring)) return 'yellow';
  if (indexer.autobrrMissing) return 'grey';
  if (indexer.stats?.ratio !== null && indexer.stats?.ratio !== undefined && indexer.stats.ratio < 0.8) return 'amber';
  return 'green';
};

export const StatusGrid = ({ indexers }: { indexers: Indexer[] }) => {
  const prevStatuses = useRef<Record<string, TileStatus>>({});
  const [changedIds, setChangedIds] = useState<Set<string>>(new Set());

  const sorted = useMemo(
    () => [...indexers].sort((a, b) => stripApi(a.name).localeCompare(stripApi(b.name))),
    [indexers],
  );

  useEffect(() => {
    const ids = new Set<string>();
    for (const indexer of sorted) {
      const status = classify(indexer);
      const prev = prevStatuses.current[indexer.id];
      if (prev !== undefined && prev !== status) {
        ids.add(indexer.id);
      }
      prevStatuses.current[indexer.id] = status;
    }
    if (ids.size === 0) return;
    setChangedIds(ids);
    const timer = setTimeout(() => setChangedIds(new Set()), 800);
    return () => clearTimeout(timer);
  }, [sorted]);

  return (
    <div className="max-w-2xl mx-auto grid grid-cols-6 sm:grid-cols-8 md:grid-cols-10 lg:grid-cols-12 gap-2">
      {sorted.map((indexer, i) => {
        const status = classify(indexer);
        const displayName = stripApi(indexer.name);
        const changeAnim = changedIds.has(indexer.id)
          ? status === 'red' || status === 'orange' ? 'animate-alert-pulse' : 'animate-recover'
          : '';
        return (
          <div
            key={indexer.id}
            className="animate-pop-in"
            style={{ animationDelay: `${i * 35}ms` }}
          >
            <div className="group relative flex">
              <div
                className={`aspect-square w-full rounded-md ${tileColor(status)} hover:scale-110 hover:shadow-lg hover:shadow-current/30 transition-all duration-500 cursor-default flex items-center justify-center ${changeAnim}`}
              >
                <img
                  src={`/api/indexers/icon/${indexer.id.replace('prowlarr-', '')}`}
                  alt=""
                  className="w-5 h-5"
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                />
              </div>
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-10">
                <div className="bg-popover text-popover-foreground text-xs font-medium px-2 py-1 rounded shadow-md border border-border whitespace-nowrap">
                  {displayName}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
