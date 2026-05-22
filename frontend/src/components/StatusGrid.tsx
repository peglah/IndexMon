import { Indexer } from '../types';

const stripApi = (name: string): string => name.replace(/\s*\(API\)/gi, '');

type TileStatus = 'red' | 'yellow' | 'grey' | 'green';

const tileColor = (status: TileStatus): string => {
  switch (status) {
    case 'red': return 'bg-red-500';
    case 'yellow': return 'bg-yellow-400';
    case 'grey': return 'bg-gray-400';
    case 'green': return 'bg-green-500';
  }
};

const classify = (indexer: Indexer): TileStatus => {
  if (indexer.status === 'down') return 'red';
  if (indexer.autobrr && !(indexer.autobrr.connected && indexer.autobrr.monitoring)) return 'yellow';
  if (indexer.autobrrMissing) return 'grey';
  return 'green';
};

export const StatusGrid = ({ indexers }: { indexers: Indexer[] }) => {
  const sorted = [...indexers].sort((a, b) =>
    stripApi(a.name).localeCompare(stripApi(b.name))
  );

  return (
    <div className="grid grid-cols-5 gap-2">
      {sorted.map((indexer) => {
        const status = classify(indexer);
        const displayName = stripApi(indexer.name);
        return (
          <div key={indexer.id} className="group relative flex">
            <div
              className={`aspect-square w-full rounded-md ${tileColor(status)} hover:scale-110 transition-transform cursor-default flex items-center justify-center`}
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
        );
      })}
    </div>
  );
};
