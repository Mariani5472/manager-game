'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Play, RotateCcw, Shield } from 'lucide-react';
import { gameApi } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatKickoff } from '@/lib/formatters/date';
import { LineupList } from './lineup-list';
import styles from './match-section.module.css';
export function MatchPreparation({
  saveId,
  fixtureId,
  onBack,
  onKickOff,
}: {
  saveId: string;
  fixtureId: number;
  onBack: () => void;
  onKickOff: () => void;
}) {
  const queryClient = useQueryClient();
  const queryKey = ['match-preparation', saveId, fixtureId];
  const preparation = useQuery({
    queryKey,
    queryFn: () => gameApi.matchPreparation(saveId, fixtureId),
  });
  const [starterIds, setStarterIds] = useState<number[]>([]);
  const [benchIds, setBenchIds] = useState<number[]>([]);
  useEffect(() => {
    if (!preparation.data) return;
    const managed = preparation.data.managedClubIsHome
      ? preparation.data.homeLineup
      : preparation.data.awayLineup;
    setStarterIds(managed.filter((player) => player.isStarting).map((player) => player.playerId));
    setBenchIds(managed.filter((player) => !player.isStarting).map((player) => player.playerId));
  }, [preparation.data]);
  const saveLineup = useMutation({
    mutationFn: () => gameApi.saveMatchLineup(saveId, fixtureId, { starterIds, benchIds }),
    onSuccess: (data) => queryClient.setQueryData(queryKey, data),
  });
  if (preparation.isLoading) return <p className={styles.loading}>Loading match preparation…</p>;
  if (preparation.isError || !preparation.data)
    return (
      <p className={styles.error}>
        {preparation.error?.message ?? 'Unable to load match preparation.'}
      </p>
    );
  const data = preparation.data;
  const managedPlayers = data.managedClubIsHome ? data.homeLineup : data.awayLineup;
  const opponentPlayers = data.managedClubIsHome ? data.awayLineup : data.homeLineup;
  const managedTeam = data.managedClubIsHome ? data.fixture.home : data.fixture.away;
  const opponentTeam = data.managedClubIsHome ? data.fixture.away : data.fixture.home;
  const swapStarter = (slot: number, playerId: number) => {
    const previous = starterIds[slot];
    if (previous === playerId) return;
    saveLineup.reset();
    const replacementIndex = starterIds.indexOf(playerId);
    const next = [...starterIds];
    next[slot] = playerId;
    if (replacementIndex >= 0) next[replacementIndex] = previous!;
    setStarterIds(next);
    if (replacementIndex < 0) {
      setBenchIds((current) => {
        const nextBench = current.filter((id) => id !== playerId);
        if (previous !== undefined) nextBench.push(previous);
        return nextBench.slice(0, 7);
      });
    }
  };
  return (
    <div className={styles.stack}>
      <div className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>MATCH DAY</span>
          <h1>Match preparation</h1>
          <p>Build your starting XI and choose up to seven substitutes before kick-off.</p>
        </div>
        <Button variant="ghost" onClick={onBack}>
          <RotateCcw size={15} /> Back to calendar
        </Button>
      </div>
      <Card className={styles.fixtureBanner}>
        <div>
          <span>
            {data.fixture.competition} · {data.fixture.stage}
          </span>
          <h2>
            {data.fixture.home.name} <b>vs</b> {data.fixture.away.name}
          </h2>
          <p>
            {formatKickoff(data.fixture.scheduledAt)} · {data.fixture.round}
          </p>
        </div>
        <Badge variant="info">{data.fixture.status.replaceAll('_', ' ')}</Badge>
      </Card>
      <div className={styles.prepGrid}>
        <div className={styles.stack}>
          <div className={styles.sectionTitle}>
            <Shield size={16} /> YOUR SQUAD · {managedTeam.name}
          </div>
          <LineupList
            title={`Starting XI · ${starterIds.length}/11`}
            players={managedPlayers}
            managed
            selectedIds={starterIds}
            onReplace={swapStarter}
            disabled={saveLineup.isPending}
          />
          <Card>
            <CardHeader>
              <CardTitle>Selection notes</CardTitle>
            </CardHeader>
            <CardContent className={styles.notes}>
              Select a player for each formation slot. Choosing a substitute moves the replaced
              starter to the bench; choosing another starter swaps their slots. The server remains
              responsible for eligibility and goalkeeper validation.
            </CardContent>
          </Card>
        </div>
        <div className={styles.stack}>
          <div className={styles.sectionTitle}>
            <Shield size={16} /> OPPONENT · {opponentTeam.name}
          </div>
          <LineupList
            title="Predicted starting XI"
            players={opponentPlayers}
            managed={false}
            selectedIds={[]}
          />
          <Card>
            <CardHeader>
              <CardTitle>Match conditions</CardTitle>
            </CardHeader>
            <CardContent className={styles.notes}>
              Weather, pitch condition, travel and rest are resolved from the saved fixture context
              when the match starts. Opponent selection is shown for information only.
            </CardContent>
          </Card>
        </div>
      </div>
      <div className={styles.actionBar}>
        <div className={styles.lineupSaveStatus}>
          <span>{starterIds.length}/11 starters</span>
          <span>{benchIds.length}/7 substitutes</span>
          {saveLineup.isSuccess && <Badge variant="success">Lineup saved</Badge>}
        </div>
        {saveLineup.isError && <p className={styles.error}>{saveLineup.error.message}</p>}
        <Button
          variant="secondary"
          disabled={saveLineup.isPending || starterIds.length !== 11 || benchIds.length > 7}
          onClick={() => saveLineup.mutate()}
        >
          {saveLineup.isPending ? 'Saving…' : 'Save lineup'}
        </Button>
        <Button
          disabled={starterIds.length !== 11 || benchIds.length > 7 || saveLineup.isPending}
          onClick={async () => {
            try {
              await saveLineup.mutateAsync();
              onKickOff();
            } catch {
              /* mutation error is rendered above */
            }
          }}
        >
          Continue to match centre <Play size={15} />
        </Button>
      </div>
    </div>
  );
}
