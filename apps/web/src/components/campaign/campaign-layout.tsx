import type { ReactNode } from 'react';
import { CampaignHeader } from './campaign-header';
import { CampaignSidebar } from './campaign-sidebar';
import { CampaignMobileNav } from './campaign-mobile-nav';
import type { CampaignSectionId } from './campaign-navigation';
import styles from './campaign-layout.module.css';
export function CampaignLayout({
  activeSection,
  saveId,
  clubName,
  saveName,
  season,
  competition,
  nextFixture,
  onNextMatch,
  onExit,
  children,
}: {
  activeSection: CampaignSectionId;
  saveId: string;
  clubName?: string;
  saveName?: string;
  season?: number;
  competition?: string;
  nextFixture?: { id: number; status: string } | null;
  onNextMatch?: () => void;
  onExit: () => void;
  children: ReactNode;
}) {
  const basePath = `/game/${saveId}`;
  return (
    <div className={styles.app}>
      <CampaignHeader
        clubName={clubName}
        saveName={saveName}
        season={season}
        competition={competition}
        nextFixture={nextFixture}
        onNextMatch={onNextMatch}
        onExit={onExit}
      />
      <div className={styles.body}>
        <CampaignSidebar activeSection={activeSection} basePath={basePath} />
        <main className={styles.main}>{children}</main>
      </div>
      <CampaignMobileNav activeSection={activeSection} basePath={basePath} />
    </div>
  );
}
