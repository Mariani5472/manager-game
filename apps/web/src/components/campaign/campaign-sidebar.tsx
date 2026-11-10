'use client';
import Link from 'next/link';
import { useState } from 'react';
import { ChevronDown, ChevronRight, PanelLeftClose, PanelLeftOpen, Trophy } from 'lucide-react';
import { campaignNavigation } from './campaign-navigation';
import type { CampaignSectionId } from './campaign-navigation';
import styles from './campaign-layout.module.css';
export function CampaignSidebar({
  activeSection,
  basePath,
}: {
  activeSection: CampaignSectionId;
  basePath: string;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [groupOpen, setGroupOpen] = useState(true);
  return (
    <aside className={[styles.sidebar, collapsed ? styles.sidebarCollapsed : ''].join(' ')}>
      <div className={styles.sidebarTop}>
        {!collapsed && <span className={styles.sidebarLabel}>WORKSPACE</span>}
        <button
          className={styles.collapseButton}
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
        </button>
      </div>
      <button
        className={styles.groupButton}
        type="button"
        onClick={() => setGroupOpen((v) => !v)}
        aria-expanded={groupOpen}
        title="Club management"
      >
        <Trophy size={16} />
        {!collapsed && (
          <>
            <span>Club management</span>
            {groupOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </>
        )}
      </button>
      {(groupOpen || collapsed) && (
        <nav className={styles.navigation} aria-label="Campaign sections">
          {campaignNavigation.map(({ id, label, icon: Icon }) => (
            <Link
              key={id}
              href={`${basePath}/${id}`}
              title={collapsed ? label : undefined}
              aria-current={activeSection === id ? 'page' : undefined}
              className={[styles.navItem, activeSection === id ? styles.navItemActive : ''].join(
                ' ',
              )}
            >
              <Icon size={17} />
              {!collapsed && <span>{label}</span>}
            </Link>
          ))}
        </nav>
      )}
      {!collapsed && (
        <div className={styles.sidebarFooter}>
          More management areas will appear here as they become available.
        </div>
      )}
    </aside>
  );
}
