'use client';
import {useMemo,useState} from 'react';
import type {CampaignCalendarResponse} from '@shared/index';
import {CalendarDays} from 'lucide-react';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Card,CardContent,CardDescription,CardHeader,CardTitle} from '@/components/ui/card';
import {formatDate} from '@/lib/formatters/date';
import {getVisibleFixtures,getFixtureCounts,getFixtureStatusVariant,type FixtureFilter} from '@/lib/campaign/fixtures';
import {PageHeading} from './section-ui';
import styles from './campaign-sections.module.css';
export function CalendarSection({data,onPrepareMatch}:{data:CampaignCalendarResponse;onPrepareMatch:(fixtureId:number)=>void}) {
 const [filter,setFilter]=useState<FixtureFilter>('all');
 const fixtures=useMemo(()=>getVisibleFixtures(data.fixtures,filter),[data.fixtures,filter]);
 const {upcoming:upcomingCount,results:resultCount}=getFixtureCounts(data.fixtures);
 return (
export function CalendarSection({ data, onPrepareMatch }: { data: CampaignCalendarResponse; onPrepareMatch: (fixtureId: number) => void }) {
  const [filter, setFilter] = useState<'all' | 'upcoming' | 'results'>('all');
  const fixtures = useMemo(() => {
    const filtered = data.fixtures.filter(
      (item) =>
        filter === 'all' ||
        (filter === 'results'
          ? item.status === 'COMPLETED'
          : ['SCHEDULED', 'IN_PROGRESS', 'POSTPONED'].includes(item.status)),
    );
    return [...filtered].sort((a, b) => {
      const aTime = a.scheduledAt ? new Date(a.scheduledAt).getTime() : Number.MAX_SAFE_INTEGER;
      const bTime = b.scheduledAt ? new Date(b.scheduledAt).getTime() : Number.MAX_SAFE_INTEGER;
      return filter === 'results' ? bTime - aTime : aTime - bTime;
    });
  }, [data.fixtures, filter]);
  const upcomingCount = data.fixtures.filter((item) =>
    ['SCHEDULED', 'IN_PROGRESS', 'POSTPONED'].includes(item.status),
  ).length;
  const resultCount = data.fixtures.length - upcomingCount;
  return (
    <div className={styles.sectionStack}>
      <PageHeading
        eyebrow="FIXTURES & RESULTS"
        title="Calendar"
        description="A clear view of your club's matches, past and upcoming."
      />
      <Card>
        <CardHeader className={styles.calendarHeader}>
          <div>
            <CardTitle>Match schedule</CardTitle>
            <CardDescription>{data.fixtures.length} fixtures involving your club</CardDescription>
          </div>
          <div className={styles.filterGroup} role="group" aria-label="Filter fixtures">
            <Button
              size="sm"
              variant={filter === 'all' ? 'secondary' : 'ghost'}
              aria-pressed={filter === 'all'}
              onClick={() => setFilter('all')}
            >
              All <span>{data.fixtures.length}</span>
            </Button>
            <Button
              size="sm"
              variant={filter === 'upcoming' ? 'secondary' : 'ghost'}
              aria-pressed={filter === 'upcoming'}
              onClick={() => setFilter('upcoming')}
            >
              Upcoming <span>{upcomingCount}</span>
            </Button>
            <Button
              size="sm"
              variant={filter === 'results' ? 'secondary' : 'ghost'}
              aria-pressed={filter === 'results'}
              onClick={() => setFilter('results')}
            >
              Results <span>{resultCount}</span>
            </Button>
          </div>
        </CardHeader>
        <CardContent className={styles.calendarContent}>
          {fixtures.map((item) => (
            <article className={styles.fixtureRow} key={item.id}>
              <div className={styles.fixtureDate}>
                <strong>{formatDate(item.scheduledAt)}</strong>
                <span>{item.round}</span>
              </div>
              <div className={styles.fixtureMatch}>
                <div className={styles.fixtureTeams}>
                  <strong>{item.homeClub}</strong>
                  <span>{item.score ?? 'vs'}</span>
                  <strong>{item.awayClub}</strong>
                </div>
                <span className={styles.fixtureCompetition}>
                  {item.competition} · {item.stage}
                </span>
              </div>
              <div className={styles.fixtureActions}>
                <Badge variant={getFixtureStatusVariant(item.status)}>
                  {item.status.replaceAll('_', ' ')}
                </Badge>
                {['SCHEDULED', 'IN_PROGRESS'].includes(item.status) && (
                  <Button size="sm" variant="secondary" onClick={() => onPrepareMatch(item.id)}>
                    {item.status === 'IN_PROGRESS' ? 'Resume' : 'Prepare'}
                  </Button>
                )}
              </div>
            </article>
          ))}
          {!fixtures.length && (
            <div className={styles.emptyState}>
              <CalendarDays size={22} />
              <strong>No matches in this view</strong>
              <span>
                {filter === 'results'
                  ? 'Completed results will appear here.'
                  : 'There are no upcoming fixtures at the moment.'}
              </span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
