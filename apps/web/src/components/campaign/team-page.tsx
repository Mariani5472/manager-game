'use client';
import { useQuery } from '@tanstack/react-query';
import { gameApi } from '@/lib/api';
import { TeamSection } from './team-section';
import { PageError, PageLoading } from './page-state';
export function TeamPage({ saveId }: { saveId: string }) {
  const query = useQuery({ queryKey: ['campaign', saveId, 'team'], queryFn: () => gameApi.campaignTeam(saveId) });
  if (query.isLoading) return <PageLoading label="Loading club…" />;
  if (query.isError || !query.data) return <PageError message={query.error?.message ?? 'Unable to load club.'} />;
  return <TeamSection data={query.data} />;
}
