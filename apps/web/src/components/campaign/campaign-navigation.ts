import { CalendarDays, CircleGauge, Shield, Users, RadioTower } from 'lucide-react';
export const campaignNavigation = [
  { id: 'overview', label: 'Overview', icon: CircleGauge },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'squad', label: 'Squad', icon: Users },
  { id: 'team', label: 'Club', icon: Shield },
  { id: 'match', label: 'Match centre', icon: RadioTower },
] as const;
export type CampaignSectionId = (typeof campaignNavigation)[number]['id'];
