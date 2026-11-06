'use client';
import { useState, type ReactNode } from 'react';
import styles from './tabs.module.css';

export interface TabItem {
  id: string;
  label: string;
  content: ReactNode;
}
export function Tabs({
  items,
  defaultValue,
  ariaLabel = 'Section tabs',
}: {
  items: TabItem[];
  defaultValue?: string;
  ariaLabel?: string;
}) {
  const [activeId, setActiveId] = useState(defaultValue ?? items[0]?.id ?? '');
  const active = items.find((item) => item.id === activeId) ?? items[0];
  return (
    <div>
      <div className={styles.list} role="tablist" aria-label={ariaLabel}>
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active?.id === item.id}
            className={styles.tab}
            onClick={() => setActiveId(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {active && (
        <div role="tabpanel" className={styles.panel}>
          {active.content}
        </div>
      )}
    </div>
  );
}
