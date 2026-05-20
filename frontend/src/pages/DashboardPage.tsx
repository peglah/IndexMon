import { IndexerTable } from '../components/IndexerTable';
import { StatusGrid } from '../components/StatusGrid';
import { useIndexers } from '../hooks/useIndexers';

import { useCallback, useEffect, useState } from 'react';

const formatISO = (iso: string): string => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

const SunIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
);

const MoonIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
);

export const DashboardPage = () => {
  const [dark, setDark] = useState(() =>
    localStorage.theme === 'dark' || (!localStorage.theme && window.matchMedia('(prefers-color-scheme: dark)').matches)
  );

  const toggle = useCallback(() => {
    setDark((prev) => {
      const next = !prev;
      localStorage.theme = next ? 'dark' : 'light';
      document.documentElement.classList.toggle('dark', next);
      return next;
    });
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      if (!localStorage.theme) {
        setDark(e.matches);
        document.documentElement.classList.toggle('dark', e.matches);
      }
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const { data: indexers, isLoading } = useIndexers();

  if (isLoading) {
    return <div className="p-8">Loading...</div>;
  }

  const lastChecked = indexers?.[0]?.lastChecked;

  return (
    <div className="p-8 space-y-8 flex flex-col min-h-screen">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Indexer Status Dashboard</h1>
        <button onClick={toggle} className="p-2 rounded-md hover:bg-muted transition-colors" aria-label="Toggle theme">
          {dark ? <SunIcon /> : <MoonIcon />}
        </button>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 flex-1">
        <div className="bg-card p-6 rounded-lg shadow-md">
          <h2 className="text-xl font-semibold mb-4">Current Status</h2>
          {indexers && <IndexerTable indexers={indexers} />}
        </div>
        <div className="bg-card p-6 rounded-lg shadow-md overflow-visible">
          <h2 className="text-xl font-semibold mb-4">Overview</h2>
          {indexers && <StatusGrid indexers={indexers} />}
        </div>
      </div>
      {lastChecked && (
        <div className="text-sm text-muted-foreground text-center mt-auto pt-4 border-t border-border">
          Last checked: {formatISO(lastChecked)}
        </div>
      )}
    </div>
  );
};