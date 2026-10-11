'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { platformNames } from '@/lib/demo-data';
import { useWorkspace } from '../workspace-context';
import { PageHeading } from '../app-shell';
import { Badge, Button, EmptyState, Icon, IconButton, Panel, Pagination, PlatformIcon, Select, TextLink } from '../ui';
import { ChartPanel, SentimentPanel, TopicBars, WordCloud } from '../charts';
import { MentionMetrics } from './dashboard';

export function QuickAnalysis({ detailed = false }: { detailed?: boolean }) {
  const { analyze, analyzing } = useWorkspace();
  return <Panel title="Analyse rapide par IA" icon="brain" className="quick-analysis" action={detailed ? <TextLink onClick={()=>void analyze()}>Rapport complet</TextLink> : undefined}><div>{[['chart','Image globale','Très positive','78/100 ↑','green'],['trend','Tendance','En hausse','+12,5% ↑','green'],['shield','Risque actuel','Faible','12/100 ↑','green'],['warning','Sujets sensibles','Aucun','—','red']].map(([icon,label,value,stat,color])=><button onClick={()=>void analyze()} disabled={analyzing} key={label}><Icon name={icon} className={`text-${color}`} size={19} /><span>{label}</span><Badge status={label==='Sujets sensibles'?'neutral':'positive'}>{value}</Badge><strong className={color==='green'?'text-green':''}>{stat}</strong></button>)}</div></Panel>;
}
export function MentionsView() {
  const { data, edit, detail, refresh, syncing, exportData, analyze, notify, save } = useWorkspace();
  const searchParams = useSearchParams();
  const [sentiment,setSentiment] = useState('all'), [source,setSource] = useState(searchParams.get('source') || 'all'), [query,setQuery] = useState(''), [topic,setTopic] = useState('all');
  const [page,setPage] = useState(1), [perPage,setPerPage] = useState(5), [selected,setSelected] = useState<string[]>([]), [period,setPeriod] = useState('30');
  const [facebookSyncing,setFacebookSyncing] = useState(false);
  const facebookSyncInFlight = useRef(false);
  const facebookSyncErrorShown = useRef(false);
  const syncFacebookMentions = useCallback(async (quiet = false) => {
    if (facebookSyncInFlight.current) return;
    facebookSyncInFlight.current = true;
    setFacebookSyncing(true);
    try {
      const response = await fetch('/api/integrations/facebook/sync', { method: 'POST' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'La synchronisation Facebook a échoué.');
      facebookSyncErrorShown.current = false;
      if (result.added > 0) {
        await refresh();
        if (!quiet) notify(`${result.added} nouvelle(s) mention(s) Facebook enregistrée(s).`);
      } else if (!quiet) {
        notify(result.connected
          ? result.reason === 'no_keywords' ? 'Ajoutez au moins un mot-clé actif pour lancer la collecte Facebook.' : 'Aucune nouvelle mention Facebook ne correspond aux mots-clés.'
          : 'Connectez une Page Facebook dans Paramètres → Intégrations avant de lancer la collecte.', !result.connected);
      }
    } catch (error) {
      if (!quiet || !facebookSyncErrorShown.current) {
        notify(error instanceof Error ? error.message : 'La synchronisation Facebook a échoué.', true);
        facebookSyncErrorShown.current = true;
      }
    } finally {
      facebookSyncInFlight.current = false;
      setFacebookSyncing(false);
    }
  }, [notify, refresh]);
  useEffect(() => {
    let mounted = true;
    let timer: ReturnType<typeof setTimeout>;
    const runSync = async () => {
      await syncFacebookMentions(true);
      if (mounted) timer = setTimeout(runSync, 15 * 60 * 1000);
    };
    void runSync();
    return () => {
      mounted = false;
      clearTimeout(timer);
    };
  }, [syncFacebookMentions]);
  const filtered = data.mentions.filter(m=>(sentiment==='all'||m.sentiment===sentiment)&&(source==='all'||m.platform===source)&&(topic==='all'||m.category===topic)&&`${m.name} ${m.author}`.toLowerCase().includes(query.toLowerCase()));
  const pageCount = Math.max(1,Math.ceil(filtered.length/perPage));
  const actualPage = Math.min(page,pageCount);
  const visible=filtered.slice((actualPage-1)*perPage,actualPage*perPage);
  function resetFilter(set:(value:string)=>void,value:string){set(value);setPage(1);setSelected([]);}
  return <div className="section-page mentions-page"><PageHeading title="Mentions & Analyses" icon="message" subtitle="Surveillez, analysez et comprenez toutes les mentions concernant cette personnalité sur le web et les réseaux sociaux. La collecte Facebook se relance automatiquement toutes les 15 minutes tant que cette page reste ouverte."><div className="period-control"><Icon name="calendar" size={18} /><Select value={period} onChange={e=>setPeriod(e.target.value)} aria-label="Période des mentions"><option value="30">Période : 01 sept. 2026 → 30 sept. 2026</option><option value="7">7 derniers jours</option><option value="90">90 derniers jours</option></Select></div><Button icon="facebook" busy={facebookSyncing} onClick={()=>void syncFacebookMentions()}>Synchroniser Facebook</Button><Button icon="refresh" busy={syncing} onClick={async()=>{await refresh();notify('Les mentions sont à jour.');}}>Actualiser</Button><Button variant="primary" icon="download" onClick={()=>void exportData('mentions')}>Exporter</Button></PageHeading>
    <MentionMetrics last="engagement" />
    <div className="mentions-chart-row"><ChartPanel key={period} title="Évolution des mentions" multi /><SentimentPanel /><QuickAnalysis /></div>
    <div className="mentions-lower"><div className="mention-table-area"><div className="mention-toolbar"><div className="filter-tabs">{[['all','Toutes','2 487'],['positive','Positives','1 742'],['neutral','Neutres','512'],['negative','Négatives','233']].map(([key,label,count])=><button key={key} className={`${sentiment===key?'selected':''} tab-${key}`} onClick={()=>resetFilter(setSentiment,key)}>{label} ({count})</button>)}</div><div className="table-filters"><Select aria-label="Filtrer par source" value={source} onChange={e=>resetFilter(setSource,e.target.value)}><option value="all">Toutes les sources</option>{Object.entries(platformNames).map(([key,label])=><option value={key} key={key}>{label}</option>)}</Select><Select aria-label="Filtrer par sujet" value={topic} onChange={e=>resetFilter(setTopic,e.target.value)}><option value="all">Tous les types</option>{[...new Set(data.mentions.map(m=>m.category))].filter(Boolean).map(t=><option key={t}>{t}</option>)}</Select><label className="table-search"><Icon name="search" size={14} /><input aria-label="Rechercher une mention" placeholder="Rechercher..." value={query} onChange={e=>resetFilter(setQuery,e.target.value)} /></label><IconButton name="plus" label="Ajouter une mention" className="bordered" onClick={()=>edit('mentions')} /></div></div>
    {selected.length>0 && <div className="selection-toolbar"><span>{selected.length} mention(s) sélectionnée(s)</span><Button icon="check" onClick={async()=>{await Promise.all(selected.map(id=>save('mentions',{status:'reviewed'},id)));setSelected([]);notify('Les mentions sélectionnées sont marquées comme lues.');}}>Marquer comme lues</Button><Button onClick={()=>setSelected([])}>Annuler</Button></div>}
    <div className="data-table-wrap"><table className="data-table mention-table"><thead><tr><th><input type="checkbox" aria-label="Sélectionner toutes les mentions visibles" checked={visible.length>0&&visible.every(m=>selected.includes(m.id))} onChange={e=>setSelected(e.target.checked?visible.map(m=>m.id):[])} /></th><th>Source</th><th>Auteur / Canal</th><th>Contenu de la mention</th><th>Sentiment</th><th>Score</th><th>Date</th><th>Actions</th></tr></thead><tbody>{visible.map(m=><tr key={m.id} className={selected.includes(m.id)?'row-selected':''}><td><input type="checkbox" aria-label={`Sélectionner la mention de ${m.author}`} checked={selected.includes(m.id)} onChange={e=>setSelected(prev=>e.target.checked?[...prev,m.id]:prev.filter(id=>id!==m.id))} /></td><td><div className="table-source"><PlatformIcon platform={m.platform} /><span>{platformNames[m.platform||'web']}<small>{m.platform==='youtube'?'Vidéos':m.platform==='web'?'Site web':m.platform==='x'?'Microblogging':'Réseau social'}</small></span></div></td><td><div className="table-author"><span className="tiny-avatar"><Icon name="user" size={17} /></span><span>{m.author}<small>{m.time}</small></span></div></td><td><button className="mention-content-button" onClick={()=>detail(m)}>“{m.name}”</button></td><td><Badge status={m.sentiment} /></td><td><span className={`score-tag score-${m.sentiment}`}>{m.score}/100</span></td><td><span className="table-date">{m.date?new Date(m.date).toLocaleDateString('fr-FR'):'12/09/2026'}<small>14:32</small></span></td><td><div className="table-actions"><IconButton name="eye" label="Voir la mention" onClick={()=>detail(m)} /><IconButton name="link" label="Ouvrir la source originale" onClick={()=>m.url?window.open(m.url,'_blank','noopener,noreferrer'):detail(m)} /><IconButton name="more" label="Modifier ou supprimer la mention" onClick={()=>edit('mentions',m)} /></div></td></tr>)}</tbody></table>{!visible.length&&<EmptyState title="Aucune mention ne correspond à vos filtres" message="Essayez un autre mot-clé ou réinitialisez vos filtres." action={<Button onClick={()=>{setQuery('');setSource('all');setSentiment('all');setTopic('all');}}>Réinitialiser les filtres</Button>} />}</div><Pagination page={actualPage} total={filtered.length} perPage={perPage} onChange={setPage} onPerPage={n=>{setPerPage(n);setPage(1);}} /></div>
    <aside className="mentions-aside"><Panel title="Principaux sujets" icon="bookmark" action={<TextLink onClick={()=>void analyze()} />}><TopicBars /></Panel><Panel title="Nuage de mots-clés" icon="tag"><WordCloud keywords={data.keywords} /></Panel></aside></div></div>;
}
