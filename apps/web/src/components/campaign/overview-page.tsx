'use client';
import { useQuery } from '@tanstack/react-query';
import { gameApi } from '@/lib/api';
import { OverviewSection } from './overview-section';
import { PageError, PageLoading } from './page-state';
export function OverviewPage({ saveId }: { saveId: string }) {
  const query = useQuery({ queryKey: ['campaign', saveId, 'overview'], queryFn: () => gameApi.campaignOverview(saveId) });
  if (query.isLoading) return <PageLoading label="Loading overview…" />;
  if (query.isError || !query.data) return <PageError message={query.error?.message ?? 'Unable to load overview.'} />;
  return <OverviewSection data={query.data} />;
}
