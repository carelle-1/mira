import { AppShell } from '@/components/app-shell';
import { DashboardView } from '@/components/views/dashboard';
export default function HomePage() {
  return <AppShell section="dashboard"><DashboardView /></AppShell>;
}
