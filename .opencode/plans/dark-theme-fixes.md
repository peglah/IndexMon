# Dark Theme Fixes

## 1. `frontend/src/index.css` — elevation + border contrast

Change `.dark` block:

- `--card:` from `222.2 84% 4.9%` → `222.2 47.4% 11.2%`
- `--popover:` from `222.2 84% 4.9%` → `222.2 47.4% 11.2%`
- `--border:` from `217.2 32.6% 17.5%` → `215 25% 27%`
- `--input:` from `217.2 32.6% 17.5%` → `215 25% 27%`

## 2. `frontend/src/components/IndexerTable.tsx` — dark: variants

| Line | Change |
|---|---|
| 47 | `text-green-600` → `text-green-600 dark:text-green-400` |
| 51 | `bg-red-100 text-red-800` → `bg-red-100 dark:bg-red-900/60 text-red-800 dark:text-red-200` |
| 56 | `text-yellow-600` → `text-yellow-600 dark:text-yellow-400` |
| 98 | `text-gray-400` → `text-gray-400 dark:text-gray-500` |

## 3. `frontend/src/components/StatusGrid.tsx` — dark: variant

| Line | Change |
|---|---|
| 11 | `bg-gray-400` → `bg-gray-400 dark:bg-gray-500` |
