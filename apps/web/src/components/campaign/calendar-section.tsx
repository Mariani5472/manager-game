'use client';
import { useMemo, useState } from 'react';
import type { CampaignCalendarResponse } from '@shared/index';
import { CalendarDays } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDate } from '@/lib/formatters/date';
import {
  getVisibleFixtures,
  getFixtureCounts,
  getFixtureStatusVariant,
} from '@/lib/campaign/fixtures';
import type { FixtureFilter } from '@/lib/campaign/fixtures';
import { PageHeading } from './section-ui';
import styles from './campaign-sections.module.css';
import { Button } from '@/components/ui/button';
export function CalendarSection({
  data,
}: {
  data: CampaignCalendarResponse;
}) {
  const [filter, setFilter] = useState<FixtureFilter>('all');
  const fixtures = useMemo(
    () => getVisibleFixtures(data.fixtures, filter),
    [data.fixtures, filter],
  );
  const { upcoming: upcomingCount, results: resultCount } = getFixtureCounts(data.fixtures);
  return (
    <div className={styles.page}>
      <PageHeading
        eyebrow="FIXTURES & RESULTS"
        title="Calendar"
        description="Track upcoming matches and review completed results. Start your next match from the campaign header."
      />
      <div className={styles.fixtureSummary}>
        <Card>
          <CardContent>
            <span>Completed results <strong>{resultCount}</strong></span>
            <br />
            <span>Upcoming fixtures <strong>{upcomingCount}</strong></span>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Match schedule</CardTitle>
            <CardDescription>All fixtures registered for this campaign.</CardDescription>
          </div>
          <div className={styles.fixtureFilters}>
            {(['all', 'upcoming', 'results'] as const).map((value) => (
              <Button
                key={value}
                size="sm"
                variant={filter === value ? 'default' : 'outline'}
                onClick={() => setFilter(value)}
              >
                {value === 'all' ? 'All' : value === 'upcoming' ? 'Upcoming' : 'Results'}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {fixtures.length ? (
            <div className={styles.fixtureList}>
              {fixtures.map((item) => (
                <div className={styles.fixtureRow} key={item.id}>
                  <div className={styles.fixtureDate}>
                    <strong>{formatDate(item.scheduledAt)}</strong>
                    <span>{item.round}</span>
                  </div>
                  <div className={styles.fixtureTeams}>
                    <span>{item.homeClub}</span>
                    <strong>{item.status === 'COMPLETED' ? `${item.score}` : 'vs'}</strong>
                    <span>{item.awayClub}</span>
                  </div>
                  <Badge variant={getFixtureStatusVariant(item.status)}>
                    {item.status.replaceAll('_', ' ')}
                  </Badge>
                </div>
              ))}
            </div>
          ) : (
            <div className={styles.fixtureEmpty}>
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
