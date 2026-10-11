'use client';
import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { sectionLabels } from '@/lib/types';
import { useWorkspace } from './workspace-context';
import { Avatar, Badge, Button, Icon, IconButton, Logo, PlatformIcon } from './ui';

export const navigation = [
  ['dashboard','home'],['profil','user'],['sources','radar'],['mentions','mentions'],['analyse','brain'],['alertes','bell'],['crise','crisis'],['contenus','content'],['medias','users'],['rapports','bars'],['protection','shield'],['parametres','settings'],
];
const promos: Record<string, { icon: string; title: string; text: string; button: string; target: string }> = {
  sources: { icon: 'shield', title: 'Une surveillance multi-sources pour une réputation toujours sous contrôle !', text: 'Connectez, surveillez, analysez, anticipez.', button: 'Ajouter une source', target: 'source' },
  analyse: { icon: 'brain', title: 'L’IA au service de votre réputation !', text: 'Des analyses avancées, des prédictions précises et des recommandations intelligentes.', button: 'Lancer une analyse IA', target: 'analyse' },
  mentions: { icon: 'target', title: 'Anticipez les risques, contrôlez votre image !', text: 'Analysez, comprenez, agissez avant qu’il ne soit trop tard.', button: 'Lancer une analyse IA', target: 'analyse' },
  profil: { icon: 'chart', title: 'Une meilleure réputation, c’est plus d’opportunités !', text: 'Surveillez, analysez et améliorez votre image en ligne avec Ghostroar.', button: 'Découvrir nos offres', target: 'plans' },
};
export function AppShell({ section, children }: { section: string; children: ReactNode }) {
  const { data, user, loading, syncing, detail, navigate, edit, analyze, openModal, notify } = useWorkspace();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menu, setMenu] = useState('');
  const [query, setQuery] = useState('');
  const [comfort, setComfort] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handle = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key === 'k') { event.preventDefault(); searchRef.current?.focus(); } if (event.key === 'Escape') { setQuery(''); setMenu(''); setMobileOpen(false); } };
    const click = (event: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenu(''); };
    window.addEventListener('keydown', handle); document.addEventListener('mousedown', click);
    const preferencesChanged = () => setComfort(localStorage.getItem('ghostroar-comfort') === 'true');
    preferencesChanged(); window.addEventListener('ghostroar-preferences', preferencesChanged);
    return () => { window.removeEventListener('keydown', handle); document.removeEventListener('mousedown', click); window.removeEventListener('ghostroar-preferences', preferencesChanged); };
  }, []);
  const promo = promos[section];
  const softSection = ['alertes','crise','contenus','medias','rapports','protection','parametres'].includes(section);
  const premium = section === 'premium';
  const searchResults = section !== 'parametres' && section !== 'premium' && query.trim().length >= 2 ? Object.values(data).flat().filter(item => `${item.name} ${item.description || ''} ${item.author || ''} ${item.platform || ''}`.toLowerCase().includes(query.toLowerCase())).slice(0, 7) : [];
  const normalizedQuery = query.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const settingsMatches = section === 'parametres' || section === 'premium' ? [
    { key: 'account', title: 'Compte', description: 'Nom, email, téléphone et informations personnelles', icon: 'user' },
    { key: 'notifications', title: 'Notifications', description: 'Alertes, emails, notifications push et rapports', icon: 'bell' },
    { key: 'security', title: 'Sécurité', description: 'Mot de passe, authentification à deux facteurs (2FA), sessions', icon: 'shield' },
    { key: 'integrations', title: 'Intégrations', description: 'Connexions aux réseaux sociaux, sources et services', icon: 'puzzle' },
    { key: 'subscription', title: 'Abonnement', description: 'Plan Starter, Pro, Premium et facturation', icon: 'crown' },
    { key: 'preferences', title: 'Préférences', description: 'Langue, fuseau horaire, dates et apparence', icon: 'sliders' },
  ].filter(option => `${option.title} ${option.description}`.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(normalizedQuery)) : [];
  function openSetting(key: string) {
    setQuery(''); setMenu('');
    if (section === 'parametres') window.dispatchEvent(new CustomEvent('ghostroar-settings-tab', { detail: key }));
    else navigate(`parametres?tab=${key}`);
  }
  async function logout() {
    const response = await fetch('/api/auth/logout', { method: 'POST' });
    if (response.ok) router.push('/connexion'); else notify('Impossible de se déconnecter.', true);
  }
  function promoAction() { if (promo?.target === 'source') edit('sources'); else if (promo?.target === 'analyse') void analyze(); else navigate('premium'); }
  return <div className={`app-shell section-${section} ${softSection ? 'soft-shell' : ''} ${premium ? 'premium-shell' : ''} ${mobileOpen ? 'nav-toggled' : ''} ${comfort ? 'comfort-mode' : ''} ${section === 'dashboard' ? 'is-dashboard' : ''}`}>
    {mobileOpen && <button className="sidebar-backdrop" aria-label="Fermer le menu" onClick={() => setMobileOpen(false)} />}
    <aside className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`}><Link href="/" className="brand-link" aria-label="Ghostroar — Tableau de bord">{premium ? <div className="premium-brand"><span><Icon name="shield" size={21} /></span><div><strong>GHOSTROAR</strong><small>REPUTATION</small></div></div> : <Logo />}</Link><nav aria-label="Navigation principale">{navigation.map(([key, icon]) => <Link href={key === 'dashboard' ? '/' : `/${key}`} key={key} aria-label={sectionLabels[key]} className={`nav-item ${section === key || premium && key === 'parametres' ? 'active' : ''} ${key === 'crise' && section === key ? 'nav-crisis' : ''}`} onClick={() => setMobileOpen(false)} aria-current={section === key || premium && key === 'parametres' ? 'page' : undefined}><Icon name={icon} /><span>{sectionLabels[key]}</span>{key === 'analyse' && <span className="nav-badge ai">IA</span>}{key === 'alertes' && <span className="nav-badge red">{section === 'dashboard' ? 7 : data.alerts.filter(a => a.status === 'unread' && a.severity !== 'info').length}</span>}{key === 'mentions' && section !== 'dashboard' && <span className="nav-badge">24</span>}</Link>)}</nav>
      <div className={`sidebar-promo ${promo ? 'with-icon' : ''} ${section === 'protection' || section === 'parametres' || premium ? 'hidden-promo' : ''}`} >{promo ? <><Icon name={promo.icon} size={39} /><h3>{promo.title}</h3><p>{promo.text}</p></> : <><h3>Boostez votre image !</h3><p>Une bonne réputation est un atout inestimable. Laissez-nous la gérer pour vous.</p></>}<Button variant="primary" icon={promo?.target === 'source' ? 'plus' : undefined} onClick={promoAction}>{promo?.button || 'Découvrir nos offres'}<Icon name="arrow" size={16} /></Button></div>
      <button className={`sidebar-support ${section === 'protection' || section === 'parametres' || premium ? 'hidden-promo' : ''}`}  onClick={() => openModal({ kind: 'support' })}><Icon name="support" size={29} /><span><strong>Support 24/7</strong><span>+237 651 395 504</span><small>support@ghostroar.com</small></span></button>
      {section === 'protection' && <div className="reference-sidebar-bottom"><button onClick={() => navigate('premium')}><Icon name="shield" size={31} /><span><strong>Protection renforcée</strong><small>Votre identité est protégée 24/7</small></span></button><button className="scan-sidebar-card" onClick={() => navigate('protection')}><Icon name="clock" size={29} /><span><strong>Scan quotidien</strong><small>Prochain scan dans 02:14:35</small></span><div className="progress-track"><i style={{width:'62%'}} /></div></button></div>}
      {section === 'parametres' && <div className="reference-sidebar-bottom settings-sidebar-bottom"><button onClick={() => navigate('premium')}><Icon name="shield" size={34} /><span><strong>Protection Premium</strong><small>Sécurisez votre réputation<br />et votre identité en ligne.</small><em>Découvrir <Icon name="arrow" size={15} /></em></span></button><button className="sidebar-ai-card" onClick={() => navigate('analyse')}><Icon name="brain" size={35} /><span><strong>Analyse IA Avancée</strong><small>Détection prédictive et<br />insights en temps réel.</small><em>En savoir plus <Icon name="arrow" size={15} /></em></span></button></div>}
      <div className="sidebar-ambient" />
    </aside>
    <header className="topbar" ref={menuRef}>
      <IconButton className="mobile-menu" name="menu" label="Ouvrir la navigation" onClick={() => setMobileOpen(!mobileOpen)} />
      {section === 'dashboard' ? <span className="brand-tagline">Surveiller. Analyser. Protéger. Valoriser.</span> : <IconButton className="desktop-menu" name="menu" label="Afficher la navigation" onClick={() => setMobileOpen(!mobileOpen)} />}
      <div className="global-search"><Icon name="search" size={17} /><input ref={searchRef} aria-label="Rechercher dans Ghostroar" placeholder={section === 'parametres' || premium ? 'Rechercher dans les paramètres...' : section === 'dashboard' ? 'Rechercher une mention, un mot-clé, une source...' : 'Rechercher une personnalité, une source, une mention...'} value={query} onChange={e => setQuery(e.target.value)} /><kbd>Ctrl + K</kbd>{query && <IconButton name="close" label="Effacer la recherche" onClick={() => setQuery('')} />}{query.length >= 2 && <div className="search-popover"><div className="popover-heading">Résultats de recherche <span>{searchResults.length + settingsMatches.length}</span></div>{searchResults.length || settingsMatches.length ? <>{settingsMatches.map(option => <button key={option.key} onClick={() => openSetting(option.key)}><span className="search-setting-icon"><Icon name={option.icon} size={20} /></span><span><strong>{option.title}</strong><small>{option.description}</small></span><Icon name="right" size={15} /></button>)}{searchResults.map(item => <button key={item.id} onClick={() => { setQuery(''); detail(item); }}><PlatformIcon platform={item.platform || 'web'} size="small" /><span><strong>{item.name}</strong><small>{item.author || item.description || item.type}</small></span><Icon name="right" size={15} /></button>)}</> : <div className="search-no-results"><Icon name="search" /><p>Aucun résultat pour « {query} »</p><small>Essayez un nom, une source ou un mot-clé.</small></div>}</div>}</div>
      <div className="topbar-tools"><div className="topbar-dropdown"><button className="icon-button notification-button" aria-label="Voir les notifications" onClick={() => setMenu(menu === 'notifications' ? '' : 'notifications')}><Icon name="bell" size={21} /><span>{data.alerts.filter(a => a.status === 'unread').length + 3}</span></button>{menu === 'notifications' && <div className="header-popover notifications-popover"><div className="popover-heading">Notifications récentes<Badge status="active">{data.alerts.filter(a => a.status === 'unread').length} non lues</Badge></div>{data.alerts.filter(a => a.status !== 'archived').slice(0, 4).map(alert => <button key={alert.id} onClick={() => { setMenu(''); detail(alert); }}><span className={`notification-icon ${alert.severity}`}><Icon name="bell" size={17} /></span><span><strong>{alert.name}</strong><small>{alert.time}</small></span></button>)}<button className="popover-footer" onClick={() => navigate('alertes')}>Voir toutes les alertes <Icon name="arrow" size={14} /></button></div>}</div>
        {section === 'dashboard' && <IconButton name="layers" label="Sources de surveillance" onClick={() => navigate('sources')} />}
        <IconButton name={comfort ? 'moon' : 'sun'} label="Activer ou désactiver le confort visuel" onClick={() => { const next = !comfort; setComfort(next); localStorage.setItem('ghostroar-comfort', String(next)); notify(next ? 'Confort visuel activé.' : 'Luminosité standard activée.'); }} />
        {section !== 'dashboard' && <button className="language-button" onClick={() => openSetting('preferences')} title="Préférences de langue">FR <Icon name="down" size={13} /></button>}
      </div>
      <div className="account-container"><button className="account-button" onClick={() => setMenu(menu === 'account' ? '' : 'account')} aria-expanded={menu === 'account'}><Avatar size="small" /><span><strong>{user.name}</strong><small>Administrateur</small></span><Icon name="down" size={14} /></button>{menu === 'account' && <div className="header-popover account-popover"><div className="popover-heading"><span>{user.demo ? 'Espace de démonstration' : 'Mon espace sécurisé'}</span><small>{user.email}</small></div><button onClick={() => navigate('profil')}><Icon name="user" />Mon profil</button><button onClick={() => navigate('parametres')}><Icon name="settings" />Paramètres du compte</button>{user.demo && <Link href="/connexion"><Icon name="plus" />Créer mon compte</Link>}<button onClick={logout} className="text-red"><Icon name="logout" />Se déconnecter</button></div>}</div>
    </header>
    {(loading || syncing) && <div className="global-loading" role="progressbar" aria-label="Synchronisation des données" />}
    <main className={`main-content page-${section}`}>{children}</main>
  </div>;
}
export function PageHeading({ title, subtitle, icon, children, active = false }: { title: string; subtitle?: string; icon?: string; children?: ReactNode; active?: boolean }) {
  return <><div className="breadcrumb"><Link href="/">Accueil</Link><Icon name="right" size={13} /><span>{title}</span></div><div className="page-heading"><div className="page-heading-text">{icon && <div className="heading-icon"><Icon name={icon} size={30} /></div>}<div><h1>{title}{active && <Badge status="active" subtle>Actif</Badge>}</h1>{subtitle && <p>{subtitle}</p>}</div></div>{children && <div className="page-heading-actions">{children}</div>}</div></>;
}
