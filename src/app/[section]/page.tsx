import { notFound } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { SourcesView } from '@/components/views/sources';
import { MentionsView } from '@/components/views/mentions';
import { AnalysisView, ProfileView } from '@/components/views/profile-analysis';
import { AlertsView, CrisisView } from '@/components/views/alerts-crisis';
import { MediaView, PublishingView } from '@/components/views/publishing-media';
import { ReportsView } from '@/components/views/reports';
import { ProtectionView } from '@/components/views/protection';
import { SettingsView } from '@/components/views/settings';
import { PremiumView } from '@/components/views/premium';

const views = { profil: ProfileView, sources: SourcesView, mentions: MentionsView, analyse: AnalysisView, alertes: AlertsView, crise: CrisisView, contenus: PublishingView, medias: MediaView, rapports: ReportsView, protection: ProtectionView, parametres: SettingsView, premium: PremiumView };
export default async function SectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const View = views[section as keyof typeof views];
  if (!View) notFound();
  return <AppShell section={section}><View /></AppShell>;
}
