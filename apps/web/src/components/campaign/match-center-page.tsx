'use client';
import { useRouter } from 'next/navigation';
import { MatchCenter } from './match-center';
export function MatchCenterPage({ saveId, fixtureId }: { saveId: string; fixtureId: number }) {
  const router = useRouter();
  return (
    <MatchCenter
      saveId={saveId}
      fixtureId={fixtureId}
      onBack={() => router.push(`/game/${saveId}/calendar`)}
    />
  );
}
