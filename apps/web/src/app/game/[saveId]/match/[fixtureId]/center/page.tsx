import { notFound } from 'next/navigation';
import { MatchCenterPage } from '@/components/campaign/match-center-page';
export default async function MatchCenterRoute({ params }: { params: Promise<{ saveId: string; fixtureId: string }> }) {
  const { saveId, fixtureId } = await params;
  const id = Number(fixtureId);
  if (!Number.isSafeInteger(id) || id <= 0) notFound();
  return <MatchCenterPage saveId={saveId} fixtureId={id} />;
}
