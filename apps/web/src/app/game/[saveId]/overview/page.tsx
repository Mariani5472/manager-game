import { OverviewPage } from '@/components/campaign/overview-page';
export default async function OverviewRoute({ params }: { params: Promise<{ saveId: string }> }) {
  const { saveId } = await params;
  return <OverviewPage saveId={saveId} />;
}
