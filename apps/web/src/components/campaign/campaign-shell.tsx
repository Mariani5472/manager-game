'use client';
import type { ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { LoaderCircle } from 'lucide-react';
import { gameApi } from '@/lib/api';
import { CampaignLayout } from './campaign-layout';
import styles from './campaign-shell.module.css';
export function CampaignShell({ saveId, children }: { saveId: string; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const overview = useQuery({
    queryKey: ['campaign', saveId, 'overview'],
    queryFn: () => gameApi.campaignOverview(saveId),
  });
  const segment = pathname.split('/')[3] || 'overview';
  const activeSection =
    segment === 'calendar' || segment === 'match'
      ? 'calendar'
      : segment === 'squad'
        ? 'squad'
        : segment === 'team'
          ? 'team'
          : 'overview';
  return (
    <CampaignLayout
      activeSection={activeSection}
      saveId={saveId}
      clubName={overview.data?.club.name}
      saveName={overview.data?.save.name}
      season={overview.data?.competitions[0]?.seasonYear}
      competition={overview.data?.competitions[0]?.competition}
      onExit={() => router.push('/')}
    >
      <div className={styles.contentHeading}>
        <span>{activeSection.toUpperCase()}</span>
        <small>CAREER SAVE · {saveId}</small>
      </div>
      {overview.isLoading ? (
        <p className={styles.state}>
          <LoaderCircle className={styles.spinner} size={17} /> Opening campaign data…
        </p>
      ) : overview.isError ? (
        <p className={styles.error}>{overview.error.message}</p>
      ) : (
        children
      )}
    </CampaignLayout>
  );
}
