'use client';
import { Button, Icon } from '@/components/ui';
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="error-screen"><Icon name="shield" size={55} /><h1>Votre espace sera bientôt de retour.</h1><p>Une erreur a interrompu le chargement. Vos données sont conservées en toute sécurité.</p><Button variant="primary" icon="refresh" onClick={reset}>Réessayer</Button><a href="/">Retour au tableau de bord</a></main>;
}
