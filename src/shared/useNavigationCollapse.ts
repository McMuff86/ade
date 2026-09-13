import { useState } from 'react';

/** Optional device-local display state. Stored data never grants access to a category. */
export function useNavigationCollapse(storageKey: string) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try {
      const raw: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '{}');
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
      return Object.fromEntries(Object.entries(raw).slice(0, 1000).filter(([key, value]) => key.length <= 200 && value === true));
    } catch { return {}; }
  });
  const toggle = (key: string) => setCollapsed((before) => {
    const after = { ...before }; if (after[key]) delete after[key]; else after[key] = true;
    try { localStorage.setItem(storageKey, JSON.stringify(after)); } catch { /* navigation remains usable */ }
    return after;
  });
  return { collapsed, toggle };
}
