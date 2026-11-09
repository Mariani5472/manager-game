import { redirect } from 'next/navigation';
export default async function GamePage({ params }: { params: Promise<{ saveId: string }> }) {
  const { saveId } = await params;
  redirect(`/game/${saveId}/overview`);
}
