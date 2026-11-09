'use client';
import { useQuery } from '@tanstack/react-query';
import { gameApi } from '@/lib/api';
import { CalendarSection } from './calendar-section';
import { PageError, PageLoading } from './page-state';
export function CalendarPage({ saveId }: { saveId: string }) {
  const query = useQuery({
    queryKey: ['campaign', saveId, 'calendar'],
    queryFn: () => gameApi.campaignCalendar(saveId),
  });
  if (query.isLoading) return <PageLoading label="Loading calendar…" />;
  if (query.isError || !query.data)
    return <PageError message={query.error?.message ?? 'Unable to load calendar.'} />;
  return (
    <CalendarSection
      data={query.data}
    />
  );
}
