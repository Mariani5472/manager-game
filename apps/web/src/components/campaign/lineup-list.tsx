'use client';
import type { MatchLineupPlayerDto } from '@shared/index';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import styles from './match-section.module.css';
export function LineupList({
  title,
  players,
  managed,
  selectedIds,
  onReplace,
}: {
  title: string;
  players: MatchLineupPlayerDto[];
  managed: boolean;
  selectedIds: number[];
  onReplace?: (slot: number, playerId: number) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className={styles.lineupList}>
        {players
          .filter((player) => player.isStarting)
          .map((player, index) => {
            const selectedId = selectedIds[index] ?? player.playerId;
            const selectedPlayer =
              players.find((option) => option.playerId === selectedId) ?? player;
            return (
              <div className={styles.lineupRow} key={player.slot}>
                <span className={styles.slot}>{player.position}</span>
                <span className={styles.playerName}>{selectedPlayer.name}</span>
                <span className={styles.playerCondition}>
                  {Math.round(selectedPlayer.energy)}% energy
                </span>
                {managed && onReplace ? (
                  <select
                    aria-label={`Replace ${player.name}`}
                    value={selectedId}
                    onChange={(event) => onReplace(index, Number(event.target.value))}
                  >
                    {players.map((option) => (
                      <option key={option.playerId} value={option.playerId}>
                        {option.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Badge variant="default">{player.position}</Badge>
                )}
              </div>
            );
          })}
        <div className={styles.benchLabel}>SUBSTITUTES</div>
        {players
          .filter((player) =>
            managed ? !selectedIds.includes(player.playerId) : !player.isStarting,
          )
          .map((player) => (
            <div className={styles.benchRow} key={player.playerId}>
              <span>{player.name}</span>
              <span>
                {player.position} · {Math.round(player.energy)}%
              </span>
            </div>
          ))}
      </CardContent>
    </Card>
  );
}
