import { CalendarPage } from '@/components/campaign/calendar-page';
export default async function CalendarRoute({ params }: { params: Promise<{ saveId: string }> }) {
  const { saveId } = await params;
  return <CalendarPage saveId={saveId} />;
}
