import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { WorkspaceProvider } from '@/components/workspace-context';
import { GlobalDialogs } from '@/components/dialogs';
import './globals.css';
import './sections.css';
import './account.css';
import './refinements.css';

export const metadata: Metadata = {
  title: 'GHOSTROAR REPUTATION — Votre réputation, sous contrôle',
  description: 'Surveillez, analysez et protégez votre réputation numérique. Votre plateforme de veille, d’analyse des mentions et de gestion de crise.',
  icons: { icon: '/images/logo-5.png' },
};
export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="fr"><body><WorkspaceProvider>{children}<GlobalDialogs /></WorkspaceProvider></body></html>;
}
