'use client';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { gameApi } from '@/lib/api';
import { CalendarSection } from './calendar-section';
import { PageError, PageLoading } from './page-state';
export function CalendarPage({ saveId }: { saveId: string }) {
  const router = useRouter();
  const query = useQuery({ queryKey: ['campaign', saveId, 'calendar'], queryFn: () => gameApi.campaignCalendar(saveId) });
  if (query.isLoading) return <PageLoading label="Loading calendar…" />;
  if (query.isError || !query.data) return <PageError message={query.error?.message ?? 'Unable to load calendar.'} />;
  return <CalendarSection data={query.data} onPrepareMatch={fixtureId => {
    const fixture = query.data.fixtures.find(item => item.id === fixtureId);
    const route = fixture?.status === 'IN_PROGRESS' ? `/game/${saveId}/match/${fixtureId}/center` : `/game/${saveId}/match/${fixtureId}`;
    router.push(route);
  }} />;
}
