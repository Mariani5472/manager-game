import type { ReactNode } from 'react';
import { CampaignShell } from '@/components/campaign-shell';
export default async function SaveLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ saveId: string }>;
}) {
  const { saveId } = await params;
  return <CampaignShell saveId={saveId}>{children}</CampaignShell>;
}
