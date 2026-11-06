import { CampaignShell } from "@/components/campaign-shell";
interface GamePageProps { params: Promise<{ saveId: string }> }
export default async function GamePage({ params }: GamePageProps) {
  const { saveId } = await params;
  return <CampaignShell saveId={saveId} />;
}
