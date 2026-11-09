import { SquadPage } from '@/components/campaign/squad-page';
export default async function SquadRoute({ params }: { params: Promise<{ saveId: string }> }) {
  const { saveId } = await params;
  return <SquadPage saveId={saveId} />;
}
