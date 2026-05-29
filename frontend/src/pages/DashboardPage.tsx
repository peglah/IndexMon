import { CollapsibleSection } from '../components/CollapsibleSection';
import { IndexerTable } from '../components/IndexerTable';
import { StatusGrid } from '../components/StatusGrid';
import { useIndexers } from '../hooks/useIndexers';
import api from '../utils/axios';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

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

const BellIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
);

const LogoutIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
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

  const { data, isLoading, isError, error } = useIndexers();
  const [testStatus, setTestStatus] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const testTimer = useRef<ReturnType<typeof setTimeout>>();
  const { logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = useCallback(async () => {
    await logout();
    navigate('/login');
  }, [logout, navigate]);

  const sendTestNotification = useCallback(async () => {
    clearTimeout(testTimer.current);
    setTestStatus(null);
    try {
      await api.post('/api/apprise/test');
      setTestStatus({ type: 'success', text: 'Test notification sent!' });
    } catch (err) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        (err as Error)?.message ||
        'Failed to send test notification';
      setTestStatus({ type: 'error', text: msg });
    }
    testTimer.current = setTimeout(() => setTestStatus(null), 4000);
  }, []);

  if (isLoading) {
    return <div className="p-8">Loading...</div>;
  }

  if (isError) {
    const detail = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail || (error as Error)?.message || '';
    return (
      <div className="p-8 text-destructive">
        Failed to load indexer data.
        {detail && <span className="block text-sm mt-1 opacity-70">{detail}</span>}
      </div>
    );
  }

  const indexers = data?.indexers;
  const services = data?.services;
  const lastChecked = indexers?.[0]?.lastChecked;

  return (
    <div className="p-8 space-y-8 flex flex-col min-h-screen">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Indexer Status Dashboard</h1>
        <div className="flex items-center gap-2">
          <button onClick={sendTestNotification} className="p-2 rounded-md hover:bg-muted transition-colors" aria-label="Test notifications" title="Send a test Apprise notification">
            <BellIcon />
          </button>
          <button onClick={toggle} className="p-2 rounded-md hover:bg-muted transition-colors" aria-label="Toggle theme">
            {dark ? <SunIcon /> : <MoonIcon />}
          </button>
          <button onClick={handleLogout} className="p-2 rounded-md hover:bg-muted transition-colors" aria-label="Logout" title="Logout">
            <LogoutIcon />
          </button>
        </div>
      </div>
      {testStatus && (
        <div className={`text-sm text-center ${testStatus.type === 'success' ? 'text-green-500' : 'text-destructive'}`}>
          {testStatus.text}
        </div>
      )}
      <div className="space-y-8">
        <CollapsibleSection title="Overview">
          {indexers && <StatusGrid indexers={indexers} />}
        </CollapsibleSection>
        <CollapsibleSection title="Current Status">
          {indexers && <IndexerTable indexers={indexers} services={services} />}
        </CollapsibleSection>
      </div>
      {lastChecked && (
        <div className="text-sm text-muted-foreground text-center mt-auto pt-4 border-t border-border">
          Last checked: {formatISO(lastChecked)}
        </div>
      )}
    </div>
  );
};