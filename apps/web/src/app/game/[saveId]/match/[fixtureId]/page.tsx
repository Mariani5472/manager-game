import { notFound } from 'next/navigation';
import { MatchPreparationPage } from '@/components/campaign/match-preparation-page';
export default async function MatchPreparationRoute({
  params,
}: {
  params: Promise<{ saveId: string; fixtureId: string }>;
}) {
  const { saveId, fixtureId } = await params;
  const id = Number(fixtureId);
  if (!Number.isSafeInteger(id) || id <= 0) notFound();
  return <MatchPreparationPage saveId={saveId} fixtureId={id} />;
}
