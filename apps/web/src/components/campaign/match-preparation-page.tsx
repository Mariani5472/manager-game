'use client';
import { useRouter } from 'next/navigation';
import { MatchPreparation } from './match-preparation';
export function MatchPreparationPage({ saveId, fixtureId }: { saveId: string; fixtureId: number }) {
  const router = useRouter();
  return <MatchPreparation saveId={saveId} fixtureId={fixtureId} onBack={() => router.push(`/game/${saveId}/calendar`)} onKickOff={() => router.push(`/game/${saveId}/match/${fixtureId}/center`)} />;
}
