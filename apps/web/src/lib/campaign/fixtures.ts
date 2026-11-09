import type { CampaignCalendarResponse } from '@shared/index';

export type FixtureFilter = 'all' | 'upcoming' | 'results';
const UPCOMING_STATUSES = new Set(['SCHEDULED', 'IN_PROGRESS', 'POSTPONED']);

export function getFixtureStatusVariant(status: string): 'default' | 'success' | 'warning' | 'danger' | 'info' {
  if (status === 'COMPLETED') return 'success';
  if (status === 'IN_PROGRESS') return 'info';
  if (status === 'POSTPONED') return 'warning';
  if (status === 'CANCELLED') return 'danger';
  return 'default';
}

export function getVisibleFixtures(fixtures: CampaignCalendarResponse['fixtures'], filter: FixtureFilter) {
  const filtered = fixtures.filter(item => filter === 'all' || (filter === 'results' ? item.status === 'COMPLETED' : UPCOMING_STATUSES.has(item.status)));
  return [...filtered].sort((a, b) => {
    const aTime = a.scheduledAt ? new Date(a.scheduledAt).getTime() : Number.MAX_SAFE_INTEGER;
    const bTime = b.scheduledAt ? new Date(b.scheduledAt).getTime() : Number.MAX_SAFE_INTEGER;
    return filter === 'results' ? bTime - aTime : aTime - bTime;
  });
}

export function getFixtureCounts(fixtures: CampaignCalendarResponse['fixtures']) {
  const upcoming = fixtures.filter(item => UPCOMING_STATUSES.has(item.status)).length;
  return { upcoming, results: fixtures.length - upcoming };
}
