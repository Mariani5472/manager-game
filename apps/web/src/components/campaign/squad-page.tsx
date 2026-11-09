'use client';
import { useQuery } from '@tanstack/react-query';
import { gameApi } from '@/lib/api';
import { SquadSection } from './squad-section';
import { PageError, PageLoading } from './page-state';
export function SquadPage({ saveId }: { saveId: string }) {
  const query = useQuery({
    queryKey: ['campaign', saveId, 'squad'],
    queryFn: () => gameApi.campaignSquad(saveId),
  });
  if (query.isLoading) return <PageLoading label="Loading squad…" />;
  if (query.isError || !query.data)
    return <PageError message={query.error?.message ?? 'Unable to load squad.'} />;
  return <SquadSection data={query.data} />;
}
