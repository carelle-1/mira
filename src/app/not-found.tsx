import Link from 'next/link';
export default function NotFound() { return <main className="error-screen"><div className="error-code">404</div><h1>Cette page est introuvable.</h1><p>Votre espace de réputation vous attend sur le tableau de bord.</p><Link className="button button-primary" href="/">Retour au tableau de bord</Link></main>; }
