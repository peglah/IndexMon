import { cn } from '@/utils/cn';
import { useCallback, useState } from 'react';

const slugKey = (title: string) =>
  'section-' + title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const ChevronIcon = ({ collapsed }: { collapsed: boolean }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={cn('transition-transform duration-200', collapsed && '-rotate-90')}
  >
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const loadCollapsed = (key: string, defaultCollapsed: boolean): boolean => {
  const val = localStorage.getItem(key);
  if (val === null) return defaultCollapsed;
  return val === 'true';
};

export const CollapsibleSection = ({
  title,
  children,
  defaultCollapsed = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultCollapsed?: boolean;
}) => {
  const storageKey = slugKey(title);
  const [collapsed, setCollapsed] = useState(() => loadCollapsed(storageKey, defaultCollapsed));

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(storageKey, String(next));
      return next;
    });
  }, [storageKey]);

  return (
    <div className="bg-card p-6 rounded-lg shadow-md">
      <button
        onClick={toggle}
        className="flex items-center gap-2 w-full text-left mb-4"
        aria-expanded={!collapsed}
      >
        <ChevronIcon collapsed={collapsed} />
        <h2 className="text-xl font-semibold m-0">{title}</h2>
      </button>
      <div
        className={cn(
          'grid transition-[grid-template-rows] duration-200',
          collapsed ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]',
        )}
      >
        <div className={cn(collapsed && 'overflow-hidden')}>{children}</div>
      </div>
    </div>
  );
};
