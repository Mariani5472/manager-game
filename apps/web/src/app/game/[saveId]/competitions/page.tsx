import { CompetitionPage } from '@/components/campaign/competition-page';
export default async function CompetitionRoute({ params }: { params: Promise<{ saveId: string }> }) {
  const { saveId } = await params;
  return <CompetitionPage saveId={saveId} />;
}
