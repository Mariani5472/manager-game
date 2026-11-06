'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { LoaderCircle } from 'lucide-react';
import { gameApi } from '@/lib/api';
import { CampaignLayout } from './campaign-layout';
import { campaignNavigation, type CampaignSectionId } from './campaign-navigation';
import { OverviewSection, CalendarSection, SquadSection, TeamSection } from './campaign-sections';
import styles from './campaign-shell.module.css';
export function CampaignShell({ saveId }: { saveId: string }) {
  const router = useRouter();
  const [activeSection, setActiveSection] = useState<CampaignSectionId>('overview');
  const overview = useQuery({
    queryKey: ['campaign', saveId, 'overview'],
    queryFn: () => gameApi.campaignOverview(saveId),
  });
  const calendar = useQuery({
    queryKey: ['campaign', saveId, 'calendar'],
    queryFn: () => gameApi.campaignCalendar(saveId),
    enabled: activeSection === 'calendar',
  });
  const squad = useQuery({
    queryKey: ['campaign', saveId, 'squad'],
    queryFn: () => gameApi.campaignSquad(saveId),
    enabled: activeSection === 'squad',
  });
  const team = useQuery({
    queryKey: ['campaign', saveId, 'team'],
    queryFn: () => gameApi.campaignTeam(saveId),
    enabled: activeSection === 'team',
  });
  const activeQuery =
    activeSection === 'calendar'
      ? calendar
      : activeSection === 'squad'
        ? squad
        : activeSection === 'team'
          ? team
          : overview;
  const renderContent = () => {
    if (overview.isLoading)
      return (
        <p className={styles.state}>
          <LoaderCircle className={styles.spinner} size={17} />
          Opening campaign data…
        </p>
      );
    if (overview.isError) return <p className={styles.error}>{overview.error.message}</p>;
    if (activeQuery.isLoading)
      return (
        <p className={styles.state}>
          <LoaderCircle className={styles.spinner} size={17} />
          Loading {activeSection}…
        </p>
      );
    if (activeQuery.isError) return <p className={styles.error}>{activeQuery.error.message}</p>;
    switch (activeSection) {
      case 'overview':
        return overview.data ? <OverviewSection data={overview.data} /> : null;
      case 'calendar':
        return calendar.data ? <CalendarSection data={calendar.data} /> : null;
      case 'squad':
        return squad.data ? <SquadSection data={squad.data} /> : null;
      case 'team':
        return team.data ? <TeamSection data={team.data} /> : null;
    }
  };
  return (
    <CampaignLayout
      activeSection={activeSection}
      onNavigate={setActiveSection}
      clubName={overview.data?.club.name}
      saveName={overview.data?.save.name}
      season={overview.data?.competitions[0]?.seasonYear}
      competition={overview.data?.competitions[0]?.competition}
      onExit={() => router.push('/')}
    >
      <div className={styles.contentHeading}>
        <span>
          {campaignNavigation.find((item) => item.id === activeSection)?.label ?? 'Campaign'}
        </span>
        <small>CAREER SAVE · {saveId}</small>
      </div>
      {renderContent()}
    </CampaignLayout>
  );
}
