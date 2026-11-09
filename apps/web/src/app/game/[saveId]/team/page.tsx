import { TeamPage } from '@/components/campaign/team-page';
export default async function TeamRoute({ params }: { params: Promise<{ saveId: string }> }) {
  const { saveId } = await params;
  return <TeamPage saveId={saveId} />;
}
