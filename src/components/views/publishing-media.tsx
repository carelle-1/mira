'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Entity } from '@/lib/types';
import { demoData, platformNames } from '@/lib/demo-data';
import { selectedPlatforms } from '@/lib/publishing/types';

/** Vrai si l'URL du média pointe vers une vidéo. */
function isVideoMedia(value: string) {
  return /\.(mp4|webm|mov)(\?|#|$)/i.test(value) || value.startsWith('data:video/');
}
import { useWorkspace } from '../workspace-context';
import { PageHeading } from '../app-shell';
import { Badge, Button, EmptyState, Icon, IconButton, Modal, Panel, Pagination, PlatformIcon, Select, TextLink } from '../ui';
import { LineChart } from '../charts';
import { StatCard } from './dashboard';

interface NetworkOption {
  platform: string;
  label: string;
  /** Vrai si la publication est autorisée sur ce réseau. */
  canPublish?: boolean;
  /** Explication quand la publication n'est pas possible. */
  reason?: string;
}

/** Horodatage de repli, capté une fois au chargement du module. */
const RENDER_NOW = new Date();

/** Modale de publication immédiate : choix du réseau puis confirmation. */
function PublishModal({ post, networks, busy, onClose, onConfirm }: { post: Entity; networks: NetworkOption[]; busy: boolean; onClose: () => void; onConfirm: (platforms: string[]) => void }) {
  const [selected, setSelected] = useState<string[]>(() => {
    const initial = selectedPlatforms(post).filter(p => networks.some(n => n.platform === p));
    return initial.length ? initial : networks.map(n => n.platform);
  });

  const toggle = (platform: string) => setSelected(prev => prev.includes(platform) ? prev.filter(p => p !== platform) : [...prev, platform]);

  return (
    <Modal title="Publier ce contenu" onClose={onClose}>
      <div className="modal-body">
        <p><strong>{post.name}</strong></p>
        <p style={{ color: 'var(--muted, #9aa9b5)' }}>{post.description}</p>
        {post.url ? <p style={{ fontSize: '.85rem' }}>Lien joint : {post.url}</p> : null}
        <p className="form-hint">Sélectionnez les réseaux sur lesquels publier :</p>
        {networks.map(network => (
          <label key={network.platform} className="publish-network-choice">
            <input type="checkbox" checked={selected.includes(network.platform)} disabled={network.canPublish === false} onChange={() => toggle(network.platform)} />
            <PlatformIcon platform={network.platform} size="small" />
            <span>{network.label}{network.canPublish === false && network.reason ? <small style={{ display: 'block', color: 'var(--muted, #9aa9b5)' }}>{network.reason}</small> : null}</span>
          </label>
        ))}
        {!networks.some(network => network.canPublish !== false) && <p className="form-hint">Aucun réseau ne peut publier pour le moment. Reconnectez Facebook dans Paramètres → Intégrations pour autoriser la publication.</p>}
      </div>
      <div className="modal-footer">
        <Button onClick={onClose}>Annuler</Button>
        <span className="spacer" />
        <Button variant="primary" icon="send" busy={busy} disabled={!selected.length} onClick={() => onConfirm(selected)}>Publier</Button>
      </div>
    </Modal>
  );
}

/** Modale de programmation : réseau + date et heure. */
function ScheduleModal({ post, networks, busy, onClose, onConfirm }: { post: Entity; networks: NetworkOption[]; busy: boolean; onClose: () => void; onConfirm: (platforms: string[], date: string) => void }) {
  const [selected, setSelected] = useState<string[]>(() => {
    const initial = selectedPlatforms(post).filter(p => networks.some(n => n.platform === p));
    return initial.length ? initial : networks.map(n => n.platform);
  });
  const [date, setDate] = useState(() => {
    const base = post.date && !Number.isNaN(Date.parse(post.date)) ? new Date(post.date) : new Date(RENDER_NOW.getTime() + 3600_000);
    const local = new Date(base.getTime() - base.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  });

  const toggle = (platform: string) => setSelected(prev => prev.includes(platform) ? prev.filter(p => p !== platform) : [...prev, platform]);

  return (
    <Modal title="Programmer ce contenu" onClose={onClose}>
      <div className="modal-body">
        <p><strong>{post.name}</strong></p>
        <p className="form-hint">Date et heure de publication :</p>
        <input type="datetime-local" className="publish-datetime" value={date} onChange={event => setDate(event.target.value)} aria-label="Date de publication" />
        <p className="form-hint">Réseaux de diffusion :</p>
        {networks.map(network => (
          <label key={network.platform} className="publish-network-choice">
            <input type="checkbox" checked={selected.includes(network.platform)} disabled={network.canPublish === false} onChange={() => toggle(network.platform)} />
            <PlatformIcon platform={network.platform} size="small" />
            <span>{network.label}{network.canPublish === false && network.reason ? <small style={{ display: 'block', color: 'var(--muted, #9aa9b5)' }}>{network.reason}</small> : null}</span>
          </label>
        ))}
        {!networks.some(network => network.canPublish !== false) && <p className="form-hint">Aucun réseau ne peut publier pour le moment. Reconnectez Facebook dans Paramètres → Intégrations pour autoriser la publication.</p>}
      </div>
      <div className="modal-footer">
        <Button onClick={onClose}>Annuler</Button>
        <span className="spacer" />
        <Button variant="primary" icon="calendar" busy={busy} disabled={!selected.length || !date} onClick={() => onConfirm(selected, date)}>Programmer</Button>
      </div>
    </Modal>
  );
}

/** Modale de confirmation de suppression. */
function DeletePublicationModal({ post, busy, onClose, onConfirm }: { post: Entity; busy: boolean; onClose: () => void; onConfirm: () => void }) {
  const remote = post.status === 'published' && typeof post.externalId === 'string' && post.externalId;
  return (
    <Modal title="Supprimer cette publication ?" onClose={onClose}>
      <div className="modal-body">
        <p><strong>{post.name}</strong></p>
        <p>{remote
          ? 'La publication sera supprimée de votre espace ET des réseaux sociaux où elle a été publiée. Cette action est irréversible.'
          : 'Cette publication sera définitivement supprimée de votre espace. Cette action est irréversible.'}</p>
      </div>
      <div className="modal-footer">
        <Button onClick={onClose}>Annuler</Button>
        <span className="spacer" />
        <Button variant="danger" icon="delete" busy={busy} onClick={onConfirm}>Supprimer</Button>
      </div>
    </Modal>
  );
}

export function EditorialCalendar() {
  const { edit, openModal }=useWorkspace();
  const [month,setMonth]=useState(new Date(2026,8,1));
  const count=new Date(month.getFullYear(),month.getMonth()+1,0).getDate();
  const first=(month.getDay()+6)%7;
  const previousCount=new Date(month.getFullYear(),month.getMonth(),0).getDate();
  return <Panel title="Calendrier éditorial" icon="calendar" action={<TextLink onClick={()=>openModal({kind:'calendar'})}>Voir tout</TextLink>} className="editorial-calendar"><div className="calendar-month"><strong>{month.toLocaleDateString('fr-FR',{month:'long',year:'numeric'})}</strong><IconButton name="left" label="Mois précédent" onClick={()=>setMonth(new Date(month.getFullYear(),month.getMonth()-1,1))} /><IconButton name="right" label="Mois suivant" onClick={()=>setMonth(new Date(month.getFullYear(),month.getMonth()+1,1))} /></div><div className="calendar-grid">{['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'].map(d=><span className="calendar-weekday" key={d}>{d}</span>)}{Array.from({length:35},(_,i)=>{const day=i-first+1;const current=day>0&&day<=count;const display=day<=0?previousCount+day:day>count?day-count:day;return <button key={i} className={`${!current?'outside':''} ${current&&day===12?'calendar-today':''} ${current&&[17,20,23].includes(day)?'calendar-has-event':''}`} aria-label={`Programmer un contenu le ${display} ${month.toLocaleDateString('fr-FR',{month:'long'})}`} onClick={()=>{const selected=new Date(month.getFullYear(),month.getMonth(),day,10);const date=`${selected.getFullYear()}-${String(selected.getMonth()+1).padStart(2,'0')}-${String(selected.getDate()).padStart(2,'0')}T10:00`;edit('publications',undefined,{status:'scheduled',date});}}>{display}</button>;})}</div></Panel>;
}
export function SystemFooter({ media = false }: { media?: boolean }) {
  const { refresh, syncing }=useWorkspace();
  return <footer className="system-footer"><span>{media?'Plateforme sécurisée  ·  Connexion chiffrée  ·  Confidentialité garantie':'Plateformes connectées : LinkedIn, X, Instagram, YouTube, Blog, Presse'}</span>{media?<span>© 2026 GHOSTROAR REPUTATION · Tous droits réservés. <Icon name="shield" size={22} /></span>:<><span>Tous systèmes opérationnels <Icon name="success" size={18} /></span><span>Données mises à jour : 12 sept. 2026, 14:32 <IconButton name="refresh" label="Actualiser les données" className={syncing?'spin':''} onClick={()=>void refresh()} /></span></>}</footer>;
}
export function PublishingView() {
  const { data, edit, save, detail, notify, generateReport, navigate, refresh, remove }=useWorkspace();
  const [status,setStatus]=useState('all'),[source,setSource]=useState('all'),[query,setQuery]=useState(''),[type,setType]=useState('all'),[period,setPeriod]=useState('all'),[page,setPage]=useState(1);
  const [networks,setNetworks]=useState<NetworkOption[]>([]);
  const [publishTarget,setPublishTarget]=useState<Entity|null>(null);
  const [scheduleTarget,setScheduleTarget]=useState<Entity|null>(null);
  const [deleteTarget,setDeleteTarget]=useState<Entity|null>(null);
  const [actionBusy,setActionBusy]=useState(false);
  const reloadNetworks = useRef(false);

  const filtered=data.publications.filter(p=>(status==='all'||p.status===status)&&(source==='all'||p.platform===source)&&(type==='all'||(type==='video'?p.platform==='youtube'||p.platform==='tiktok':p.platform!=='youtube'&&p.platform!=='tiktok'))&&(period==='all'||p.status==='scheduled')&&`${p.name} ${p.description}`.toLowerCase().includes(query.toLowerCase()));
  const actualPage=Math.min(page,Math.max(1,Math.ceil(filtered.length/4)));

  /** Réseaux sociaux connectés, pour limiter les choix de publication. */
  const loadNetworks = useCallback(async () => {
    try {
      const response = await fetch('/api/publications/publish', { cache: 'no-store' });
      if (!response.ok) return;
      const result = await response.json();
      setNetworks((result.networks ?? []) as NetworkOption[]);
    } catch {
      setNetworks([]);
    }
  }, []);

  /** Réseaux sur lesquels la publication est réellement autorisée. */
  const publishableNetworks = networks.filter(network => network.canPublish !== false);

  useEffect(() => {
    if (reloadNetworks.current) return;
    reloadNetworks.current = true;
    void loadNetworks();
  }, [loadNetworks]);

  /** Publie immédiatement sur les réseaux choisis. */
  async function publishNow(post: Entity, platforms: string[]) {
    setActionBusy(true);
    try {
      const response = await fetch('/api/publications/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: post.id, platforms }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'La publication a échoué.');
      await refresh();
      notify(result.message || 'Contenu publié.');
      setPublishTarget(null);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'La publication a échoué.', true);
    } finally {
      setActionBusy(false);
    }
  }

  /** Programme la publication pour une date future. */
  async function schedulePost(post: Entity, platforms: string[], date: string) {
    setActionBusy(true);
    try {
      const response = await fetch(`/api/publications/${post.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: post.id, platforms, date: new Date(date).toISOString() }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'La programmation a échoué.');
      await refresh();
      notify(result.message || 'Contenu programmé.');
      setScheduleTarget(null);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'La programmation a échoué.', true);
    } finally {
      setActionBusy(false);
    }
  }

  /** Supprime la publication (réseaux + espace). */
  async function deletePost(post: Entity) {
    setActionBusy(true);
    try {
      const response = await fetch(`/api/publications/${post.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: post.id }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'La suppression a échoué.');
      await refresh();
      notify(result.message || 'Publication supprimée.');
      setDeleteTarget(null);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'La suppression a échoué.', true);
    } finally {
      setActionBusy(false);
    }
  }
  async function duplicate(post:Entity){const {id:_id,type:_type,...values}=post;const created=await save('publications',{...values,name:`${post.name} (copie)`,status:'draft',views:'—',likes:0,comments:0,score:0});if(created){setStatus('draft');setPage(1);notify('Le contenu a été dupliqué dans vos brouillons.');}}
  async function performance(post:Entity){const report=await save('reports',{name:`Performance – ${post.name}`,category:'Performance',status:'ready',date:new Date().toISOString(),score:post.score||0,description:`PLATEFORME : ${platformNames[post.platform||'web']}\n\nVues : ${post.views||'—'}\nRéactions : ${post.likes||0}\nCommentaires : ${post.comments||0}\nSentiment positif : ${post.score||0}%\nStatut : ${post.status==='published'?'Publié':'Non publié'}\n\n${post.status==='published'?'Recommandation : poursuivre les prises de parole sur ce sujet et répondre aux commentaires pour renforcer l’engagement.':'Les performances seront disponibles après publication. Les métriques affichées sont celles enregistrées dans votre espace.'}`});if(report)detail(report);}
  const connectedPlatforms = data.sources.filter(source => source.active && source.status !== 'inactive').map(source => source.name);
  const canPublish = connectedPlatforms.length > 0;
  /** Réseaux connectés mais sans permission de publication. */
  const blockedNetworks = networks.filter(network => network.canPublish === false);
  /** Statistiques réelles, calculées à partir des publications enregistrées. */
  const totalPublications = data.publications.length;
  const publishedCount = data.publications.filter(p => p.status === 'published').length;
  const scheduledCount = data.publications.filter(p => p.status === 'scheduled').length;
  const draftCount = data.publications.filter(p => p.status === 'draft').length;
  const failedCount = data.publications.filter(p => p.status === 'failed').length;
  const scoredPublications = data.publications.filter(p => typeof p.score === 'number' && p.score > 0);
  const averageScore = scoredPublications.length
    ? Math.round(scoredPublications.reduce((sum, p) => sum + (p.score ?? 0), 0) / scoredPublications.length)
    : 0;
  const lastUpdate = data.publications.reduce<string | undefined>((latest, p) => {
    if (!p.date) return latest;
    return !latest || Date.parse(p.date) > Date.parse(latest) ? p.date : latest;
  }, undefined);

  /** Publications regroupées par semaine sur les 30 derniers jours (données réelles). */
  const publicationsByWeek = (() => {
    const now = RENDER_NOW.getTime();
    const buckets = new Array(6).fill(0);
    for (const publication of data.publications) {
      if (!publication.date) continue;
      const ageDays = (now - Date.parse(publication.date)) / 86_400_000;
      if (Number.isNaN(ageDays) || ageDays < 0 || ageDays > 30) continue;
      const week = Math.min(5, Math.floor((30 - ageDays) / 5));
      buckets[week] += 1;
    }
    return buckets;
  })();
  const publicationWeekLabels = ['-30j', '-25j', '-20j', '-15j', '-10j', '-5j'];
  return <div className="section-page publishing-page"><div className="classic-two-column"><div className="classic-main"><PageHeading title="Contenus & publications" active subtitle={lastUpdate ? `◷  Dernière mise à jour : ${new Date(lastUpdate).toLocaleString('fr-FR')}` : '◷  Aucune publication enregistrée'} />{!canPublish && <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:'1rem', padding:'1rem 1.25rem', border:'1px solid rgba(118, 217, 145, 0.35)', borderRadius:'12px', background:'rgba(12, 21, 26, 0.8)', marginBottom:'1rem' }}><div style={{ display:'flex', alignItems:'center', gap:'.8rem' }}><Icon name="link" size={18} className="text-green" /><div><strong>Connectez un compte pour publier</strong><p style={{ margin:0, color:'#b9c7d1', fontSize:'.92rem' }}>Activez un compte dans Paramètres → Intégrations pour pouvoir publier un article depuis cette page.</p></div></div><Button variant="primary" icon="link" onClick={()=>navigate('parametres?tab=integrations')}>Connecter un compte</Button></div>}{blockedNetworks.length>0&&<div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:'1rem', padding:'1rem 1.25rem', border:'1px solid rgba(245, 165, 36, 0.4)', borderRadius:'12px', background:'rgba(12, 21, 26, 0.8)', marginBottom:'1rem' }}><div style={{ display:'flex', alignItems:'center', gap:'.8rem' }}><Icon name="warning" size={18} className="text-yellow" /><div><strong>Publication impossible sur vos réseaux</strong><p style={{ margin:0, color:'#b9c7d1', fontSize:'.92rem' }}>{blockedNetworks[0].reason}</p></div></div><Button variant="primary" icon="link" onClick={()=>navigate('parametres?tab=integrations')}>Reconnecter</Button></div>}<div className="four-metrics"><StatCard title="Publications totales" value={totalPublications} icon="file" tone="blue" subtitle="Enregistrées dans votre base" /><StatCard title="Publiés" value={publishedCount} icon="success" tone="green" subtitle={failedCount ? `${failedCount} échec(s) de diffusion` : 'Diffusés sur vos réseaux'} /><StatCard title="Programmés" value={scheduledCount} icon="calendar" tone="yellow" subtitle="Prêts à être publiés" /><StatCard title="Brouillons" value={draftCount} icon="edit" tone="muted" subtitle="En cours de rédaction" /><StatCard title="Engagement moyen" value={averageScore ? `${averageScore}%` : '—'} icon="trend" subtitle={scoredPublications.length ? `Sur ${scoredPublications.length} contenu(s)` : 'Aucune donnée'} /></div><div className="classic-tabs">{[['all','Tous'],['draft','Brouillons'],['scheduled','Programmés'],['published','Publiés'],['failed','Échecs'],['archived','Archivés']].map(([key,label])=><button key={key} className={status===key?'selected':''} onClick={()=>{setStatus(key);setPage(1);}}>{label}</button>)}</div><div className="publication-filters"><Select value={source} aria-label="Plateforme" onChange={e=>{setSource(e.target.value);setPage(1);}}><option value="all">Plateforme</option>{Object.entries(platformNames).map(([key,name])=><option value={key} key={key}>{name}</option>)}</Select><Select value={type} aria-label="Type de contenu" onChange={e=>{setType(e.target.value);setPage(1);}}><option value="all">Type de contenu</option><option value="article">Articles & posts</option><option value="video">Vidéos & podcasts</option></Select><Select value={period} aria-label="Période" onChange={e=>{setPeriod(e.target.value);setPage(1);}}><option value="all">Période</option><option value="upcoming">À venir</option></Select><label className="table-search"><Icon name="search" size={15} /><input aria-label="Rechercher un contenu" placeholder="Rechercher un contenu..." value={query} onChange={e=>{setQuery(e.target.value);setPage(1);}} /></label><Button variant="primary" icon="plus" onClick={()=>edit('publications')}>Nouveau contenu</Button></div>
    <div className="publication-grid">{filtered.slice((actualPage-1)*4,actualPage*4).map(post=><article className="publication-card" key={post.id}><div className="publication-top"><button className={`publication-thumbnail ${post.image==='x'?'x-art':''}`} onClick={()=>detail(post)}>{post.image==='x'?<svg viewBox="0 0 24 24" aria-label="X"><path fill="currentColor" d="M18.9 2H22l-6.8 7.8L23.2 22h-6.3L12 14.6 5.5 22H2.3l8.2-9.4L.8 2h6.5l4.5 6.7L18.9 2Zm-1.1 18h1.7L6.3 3.9H4.5L17.8 20Z" /></svg>:isVideoMedia(String(post.image||''))?<video src={String(post.image)} controls preload="metadata" />:<img src={`${['speaker','notebook','podcast'].includes(post.image||'')?`/images/${post.image}.jpg`:post.image||'/images/speaker.jpg'}`} alt={post.name} onError={event=>{event.currentTarget.style.display='none';event.currentTarget.parentElement?.classList.add('publication-thumbnail-missing');}} />}<PlatformIcon platform={post.platform} size="small" /></button><div className="publication-intro"><button onClick={()=>detail(post)}><h3>{post.name}</h3></button><p>{post.description}</p><Badge status={post.status} subtle /></div></div><div className="publication-metrics">{[['Vues',post.views||'—'],['Likes',post.likes||'—'],['Commentaires',post.comments||'—'],['Sentiment',post.score?`${post.score}%`:'—']].map(([label,value])=><div key={String(label)}><span>{label==='Sentiment'&&<i className="dot green" />}{label}</span><strong>{value}</strong></div>)}</div><p className="publication-date">{post.status==='scheduled'?'Programmé le':post.status==='published'?'Publié le':post.status==='failed'?'Échec de publication le':'Modifié le'} {new Date(post.date||RENDER_NOW).toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric'})}, {new Date(post.date||RENDER_NOW).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}</p>{post.status==='failed'&&post.publishError?<p className="publication-error">Publication impossible : {post.publishError}</p>:null}{post.status==='published'&&!post.externalId&&publishableNetworks.length>0?<p className="publication-note">Non encore diffusé sur les réseaux — utilisez « Publier maintenant » ci-dessous.</p>:null}{selectedPlatforms(post).length>1&&<p className="publication-networks">Diffusion : {selectedPlatforms(post).map(p=>platformNames[p]||p).join(' · ')}</p>}<div className="publication-buttons"><Button icon="edit" className="button-sm" onClick={()=>edit('publications',post)}>Modifier</Button>{post.status==='published'&&post.externalId?<Button icon="chart" className="button-sm" onClick={()=>void performance(post)}>Analyser</Button>:<><Button icon="send" className="button-sm" disabled={!publishableNetworks.length} onClick={()=>setPublishTarget(post)}>{post.status==='scheduled'?'Publier maintenant':'Publier'}</Button><Button icon="calendar" className="button-sm" disabled={!publishableNetworks.length} onClick={()=>setScheduleTarget(post)}>Programmer</Button></>}<Button icon="copy" className="button-sm" onClick={()=>void duplicate(post)}>Dupliquer</Button><Button variant="danger-ghost" icon="delete" className="button-sm" onClick={()=>setDeleteTarget(post)}>Supprimer</Button></div></article>)}</div>{!filtered.length&&<EmptyState title="Aucun contenu pour le moment" message="Créez votre prochain contenu et construisez votre présence en ligne." icon="content" action={<Button variant="primary" icon="plus" onClick={()=>edit('publications')}>Créer un contenu</Button>} />}{filtered.length>4&&<Pagination page={actualPage} perPage={4} total={filtered.length} onChange={setPage} />}</div>
    <aside className="classic-aside"><EditorialCalendar /><Panel title="Actions rapides" className="quick-action-panel"><Button icon="calendar" onClick={()=>edit('publications')}>Créer un post</Button><Button icon="send" disabled={!publishableNetworks.length} onClick={()=>{const draft=data.publications.find(p=>p.status==='draft');if(draft)setPublishTarget(draft);else notify('Créez d’abord un brouillon à publier.',true);}}>Publier un brouillon</Button><Button icon="calendar" disabled={!publishableNetworks.length} onClick={()=>{const draft=data.publications.find(p=>p.status==='draft');if(draft)setScheduleTarget(draft);else notify('Créez d’abord un brouillon à programmer.',true);}}>Programmer</Button><Button icon="edit" onClick={()=>void generateReport('Performance des contenus')}>Analyser performance</Button></Panel><Panel title="Publications des 30 derniers jours" action={<TextLink onClick={()=>navigate('rapports')}>Voir le rapport</TextLink>} className="publication-performance"><LineChart values={publicationsByWeek} labels={publicationWeekLabels} max={Math.max(1, ...publicationsByWeek)} color="#61d571" tooltip={false} /></Panel><Panel title="Meilleurs contenus" action={<TextLink onClick={()=>{setStatus('published');setSource('all');setQuery('');}}>Voir le classement</TextLink>} className="best-content">{[...data.publications].filter(p=>p.status==='published').sort((a,b)=>(b.score||0)-(a.score||0)).slice(0,3).map((post,i)=><button key={post.id} onClick={()=>void performance(post)}><b>{i+1}</b><span><strong>{post.name}</strong><small>{post.score?`${post.score}% d’engagement`:'sans mesure'}</small></span><em className={i===2?'text-yellow':'text-green'}>{post.score||'—'}</em></button>)}</Panel></aside></div>
    {publishTarget && <PublishModal post={publishTarget} networks={networks} busy={actionBusy} onClose={()=>setPublishTarget(null)} onConfirm={platforms=>void publishNow(publishTarget,platforms)} />}
    {scheduleTarget && <ScheduleModal post={scheduleTarget} networks={networks} busy={actionBusy} onClose={()=>setScheduleTarget(null)} onConfirm={(platforms,date)=>void schedulePost(scheduleTarget,platforms,date)} />}
    {deleteTarget && <DeletePublicationModal post={deleteTarget} busy={actionBusy} onClose={()=>setDeleteTarget(null)} onConfirm={()=>void deletePost(deleteTarget)} />}
    <SystemFooter /></div>;
}

export function MediaView() {
  const { data, edit, detail, openModal, notify, navigate }=useWorkspace();
  const [tab,setTab]=useState('all'),[type,setType]=useState('all'),[country,setCountry]=useState('all'),[sentiment,setSentiment]=useState('all'),[status,setStatus]=useState('all'),[query,setQuery]=useState(''),[showSearch,setShowSearch]=useState(false),[page,setPage]=useState(1),[showCampaigns,setShowCampaigns]=useState(false),[showAppointments,setShowAppointments]=useState(false),[period,setPeriod]=useState('30');
  const contacts=data.contacts.filter(c=>(type==='all'||c.category===type)&&(country==='all'||c.country===country)&&(sentiment==='all'||c.sentiment===sentiment)&&(status==='all'||c.status===status)&&(tab==='all'||tab==='media'||(tab==='journalists'?(c.role||'').toLowerCase().includes('journaliste'):c.category==='Influenceur'))&&`${c.name} ${c.company} ${c.role}`.toLowerCase().includes(query.toLowerCase()));
  const actualPage=Math.min(page,Math.max(1,Math.ceil(contacts.length/6)));
  return <div className="section-page media-page"><div className="classic-two-column"><div className="classic-main"><PageHeading title="Relations médias" active subtitle="◷  Dernière mise à jour : 12 sept. 2026 à 14:32" /><div className="four-metrics"><StatCard title="Contacts médias" value={186+data.contacts.length-demoData.contacts.length} icon="users" tone="blue" subtitle="+12 ce mois" /><StatCard title="Couvertures ce mois" value="34" icon="file" subtitle="+8 vs mois dernier" /><StatCard title="Sentiment média" value={<>78<small>/100</small></>} icon="smile" subtitle="Positif" /><button className="stat-clickable" onClick={()=>setShowCampaigns(!showCampaigns)}><StatCard title="Campagnes actives" value={data.campaigns.filter(c=>c.status==='active').length} icon="megaphone" tone="yellow" subtitle="En cours" /></button></div>
    {showCampaigns?<Panel title="Vos campagnes médias" icon="megaphone" action={<TextLink onClick={()=>setShowCampaigns(false)}>Revenir aux contacts</TextLink>} className="campaign-list">{data.campaigns.map(campaign=><div className="campaign-row" key={campaign.id}><span className="campaign-icon"><Icon name="megaphone" size={23} /></span><div><button onClick={()=>detail(campaign)}><h3>{campaign.name}</h3></button><p>{campaign.description}</p><small>Responsable : {campaign.assignee||'Non assigné'}</small></div><Badge status={campaign.status} subtle /><IconButton name="edit" label="Modifier la campagne" onClick={()=>edit('campaigns',campaign)} /></div>)}<Button variant="primary" icon="plus" onClick={()=>edit('campaigns')}>Créer une campagne</Button></Panel>:<><div className="media-filters"><div className="media-tabs">{[['all','Tous'],['journalists','Journalistes'],['media','Médias'],['influencers','Influenceurs']].map(([key,label])=><button className={tab===key?'selected':''} onClick={()=>{setTab(key);setPage(1);}} key={key}>{label}</button>)}</div><Select aria-label="Type de média" value={type} onChange={e=>{setType(e.target.value);setPage(1);}}><option value="all">Type de média</option>{['Presse','TV','Radio','Web','Influenceur'].map(t=><option key={t}>{t}</option>)}</Select><Select aria-label="Pays" value={country} onChange={e=>{setCountry(e.target.value);setPage(1);}}><option value="all">Pays</option>{[...new Set(data.contacts.map(c=>c.country))].filter(Boolean).map(c=><option key={c}>{c}</option>)}</Select><Select aria-label="Sentiment" value={sentiment} onChange={e=>{setSentiment(e.target.value);setPage(1);}}><option value="all">Sentiment</option><option value="positive">Positif</option><option value="neutral">Neutre</option><option value="negative">Négatif</option></Select><Select aria-label="Statut" value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}><option value="all">Statut</option><option value="active">Actif</option><option value="inactive">Inactif</option></Select><IconButton name="search" label="Rechercher un contact" className="bordered" onClick={()=>setShowSearch(!showSearch)} /><Button variant="primary" icon="plus" onClick={()=>edit('contacts')}>Ajouter un contact</Button></div>{showSearch&&<label className="table-search expanded-media-search"><Icon name="search" size={17} /><input autoFocus placeholder="Rechercher un nom, un média ou une fonction..." aria-label="Rechercher un contact" value={query} onChange={e=>{setQuery(e.target.value);setPage(1);}} /><IconButton name="close" label="Effacer" onClick={()=>setQuery('')} /></label>}
    <div className="contact-list">{contacts.slice((actualPage-1)*6,actualPage*6).map((contact,i)=><div className="contact-row" key={contact.id}><button className="contact-identity" onClick={()=>detail(contact)}><PlatformIcon platform={contact.platform} size="large" /><span><strong>{contact.name} – {contact.company}</strong><small>{contact.role}</small></span></button><span className={`media-type type-${contact.category?.toLowerCase()}`}>{contact.category}</span><div className="contact-score"><small>{i%2===0?'Score relation':'Dernier contact'}</small><span>{i%2===0?`${contact.score}/100`:'12 sept. 2026'}</span></div><Badge status={contact.sentiment} subtle>{contact.sentiment==='positive'?'Positif':contact.sentiment==='negative'?'Négatif':'Neutre'}</Badge><div className="contact-actions"><Button className="button-sm" onClick={()=>openModal({kind:'communication',entity:contact})}>Contacter</Button><Button className="button-sm" onClick={()=>openModal({kind:'history',entity:contact})}>Voir historique</Button><Button className="button-sm" onClick={()=>edit('contacts',contact)}>Ajouter note</Button></div></div>)}{!contacts.length&&<EmptyState title="Aucun contact trouvé" message="Modifiez vos filtres ou ajoutez un contact à votre réseau." icon="users" action={<Button variant="primary" icon="plus" onClick={()=>edit('contacts')}>Ajouter un contact</Button>} />}<Pagination page={actualPage} total={contacts.length} perPage={6} onChange={setPage} /></div></>}
    {showAppointments&&<Panel title="Tous vos rendez-vous" icon="calendar" className="appointments-expanded" action={<TextLink onClick={()=>setShowAppointments(false)}>Réduire</TextLink>}>{data.appointments.map(appointment=><button className="calendar-event" key={appointment.id} onClick={()=>edit('appointments',appointment)}><Icon name="calendar" size={20} /><span>{appointment.name}</span><span>{appointment.date?new Date(appointment.date).toLocaleString('fr-FR'):''}</span><Badge status={appointment.status} subtle /></button>)}<Button icon="plus" variant="primary" onClick={()=>edit('appointments')}>Planifier un rendez-vous</Button></Panel>}</div>
    <aside className="classic-aside"><Panel title="Actions rapides" icon="bolt" className="quick-action-panel"><Button icon="send" onClick={()=>openModal({kind:'communication',title:'Envoyer un communiqué'})}>Envoyer un communiqué<Icon name="right" size={15} /></Button><Button icon="bolt" onClick={()=>edit('appointments',undefined,{name:'Interview – ',status:'scheduled'})}>Planifier une interview<Icon name="right" size={15} /></Button><Button icon="megaphone" onClick={()=>{setShowCampaigns(true);edit('campaigns');}}>Créer une campagne<Icon name="right" size={15} /></Button></Panel><Panel title="Prochains rendez-vous" icon="calendar" action={<TextLink onClick={()=>setShowAppointments(!showAppointments)}>Voir tout</TextLink>} className="upcoming-appointments">{data.appointments.filter(a=>a.status!=='archived'&&a.status!=='resolved').slice(0,3).map(appointment=><button key={appointment.id} onClick={()=>edit('appointments',appointment)}><strong>{appointment.name}</strong><span><small>Avec {appointment.author}</small><time>{new Date(appointment.date||RENDER_NOW.getTime()).toLocaleDateString('fr-FR',{day:'numeric',month:'short',year:'numeric'})} à {new Date(appointment.date||RENDER_NOW.getTime()).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}</time></span></button>)}</Panel><Panel title="Évolution couverture média" action={<Select aria-label="Période de couverture" value={period} onChange={e=>setPeriod(e.target.value)}><option value="30">30 derniers jours</option><option value="7">7 derniers jours</option><option value="90">90 derniers jours</option></Select>} className="media-coverage"><div className="coverage-chart"><LineChart values={period==='7'?[12,18,15,23,25,31,38]:[5,8,12,9,15,19,14,16,22,26,32,28,24,29,35,39]} labels={period==='7'?['06/09','07/09','08/09','09/09','10/09','11/09','12/09']:['25 août','','','','02 sept.','','','','09 sept.','','','','16 sept.','','','23 sept.']} max={40} color="#6ad278" tooltip={false} /></div><div className="top-media-heading"><h3>Top médias</h3><TextLink onClick={()=>{setType('all');setTab('media');setPage(1);notify('Tous vos médias sont affichés.');}} /></div>{[['Le Monde','124K',85,'green'],['France 24','98K',78,'blue'],['Le Quotidien','76K',82,'blue'],['Europe 1','64K',70,'purple'],['Tech & Co','52K',65,'yellow']].map(([name,count,score,color])=><button className="top-media-row" key={String(name)} onClick={()=>{const contact=data.contacts.find(c=>c.company===name);if(contact)detail(contact);else navigate('mentions');}}><i className={`dot ${color}`} /><span>{name}</span><b>{count}</b><small>Portée</small><em>{score}</em><span className="progress-track"><i style={{width:`${score}%`}} /></span></button>)}</Panel></aside></div><SystemFooter media /></div>;
}
