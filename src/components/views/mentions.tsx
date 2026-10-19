'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { platformNames } from '@/lib/demo-data';
import { compactNumber, NO_METRICS_TOOLTIP } from '@/lib/sources/metrics';
import { scoreLevelLabels } from '@/lib/score/scoring.config';
import type { Entity } from '@/lib/types';
import { useWorkspace } from '../workspace-context';
import { PageHeading } from '../app-shell';
import { Badge, Button, EmptyState, Icon, IconButton, Modal, Panel, Pagination, PlatformIcon, Select, TextLink } from '../ui';
import { ChartPanel, SentimentPanel, TopicBars, WordCloud } from '../charts';
import { MentionMetrics, ScoreSummary } from './dashboard';

export function QuickAnalysis({ detailed = false }: { detailed?: boolean }) {
  const { analyze, analyzing } = useWorkspace();
  return <Panel title="Analyse rapide par IA" icon="brain" className="quick-analysis" action={detailed ? <TextLink onClick={()=>void analyze()}>Rapport complet</TextLink> : undefined}><div>{[['chart','Image globale','Très positive','78/100 ↑','green'],['trend','Tendance','En hausse','+12,5% ↑','green'],['shield','Risque actuel','Faible','12/100 ↑','green'],['warning','Sujets sensibles','Aucun','—','red']].map(([icon,label,value,stat,color])=><button onClick={()=>void analyze()} disabled={analyzing} key={label}><Icon name={icon} className={`text-${color}`} size={19} /><span>{label}</span><Badge status={label==='Sujets sensibles'?'neutral':'positive'}>{value}</Badge><strong className={color==='green'?'text-green':''}>{stat}</strong></button>)}</div></Panel>;
}
interface VeilleScanResult {
  added?: number;
  checked?: number;
  keywords?: number;
  reason?: string;
  error?: string;
  warnings?: string[];
  pendingScores?: number;
  sources?: { label: string; added: number }[];
}

/** Badge de score : nombre coloré selon le niveau, ou état d'analyse. */
function ScoreBadge({ mention, keywordInactive = false }: { mention: Entity; keywordInactive?: boolean }) {
  const status = mention.scoreStatus ?? 'en_attente';
  const level = mention.scoreLevel ?? 'faible';
  const score = typeof mention.score === 'number' ? mention.score : undefined;
  const hasScore = score !== undefined && (status === 'final' || status === 'provisoire');

  // Une mention déjà scorée garde son score, même si son mot-clé est inactif.
  // « Hors veille » ne s'applique qu'aux mentions jamais analysées avec succès.
  if (keywordInactive && !hasScore && status !== 'echec') {
    return (
      <span className="score-badge score-badge-inactive" title={`Mot-clé « ${String(mention.category ?? 'inconnu')} » désactivé : analyse non lancée. Utilisez « Tout recalculer » pour la scorer.`}>
        Hors veille
      </span>
    );
  }
  if (status === 'en_attente' || score === undefined) {
    return <span className="score-badge score-badge-pending" title="Analyse sémantique en attente">Analyse…</span>;
  }
  if (status === 'echec') {
    return <span className="score-badge score-badge-failed" title={mention.scoreReason || 'Analyse indisponible.'}>–</span>;
  }
  if (status === 'provisoire') {
    return (
      <span className="score-badge score-badge-provisional" title="Score provisoire — calculé sans analyse sémantique (Ollama indisponible)">
        <span className="score-badge-approx">~</span>{score}
      </span>
    );
  }
  return (
    <span className={`score-badge score-badge-${level}`} title={`Score ${(mention.scoreLevel && scoreLevelLabels[mention.scoreLevel]) || ''} — cliquez pour le détail du calcul`}>
      {score}
    </span>
  );
}

/** Vrai si le mot-clé (catégorie) d'une mention n'est plus surveillé. */
function hasInactiveKeyword(mention: Entity, activeKeywords: string[]): boolean {
  const category = mention.category;
  if (typeof category !== 'string' || !category.trim()) return false;
  const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return !activeKeywords.some(keyword => normalize(keyword) === normalize(category));
}

/** Panneau détaillé du calcul du score d'une mention. */
function ScoreDetailModal({ mention, keywordInactive = false, onClose }: { mention: Entity; keywordInactive?: boolean; onClose: () => void }) {
  const breakdown = mention.scoreBreakdown;
  const analysisFailed = mention.scoreStatus === 'echec';

  return (
    <Modal title={`Score de réputation — ${mention.score ?? 0}/100`} onClose={onClose}>
      <div className="modal-body score-detail">
        <div className="score-detail-head">
          <ScoreBadge mention={mention} keywordInactive={keywordInactive} />
          <div>
            <strong>{(mention.scoreLevel && scoreLevelLabels[mention.scoreLevel]) || 'Niveau indéterminé'}</strong>
            <p style={{ margin: 0, color: 'var(--muted, #9aa9b5)' }}>
              {mention.scoreStatus === 'provisoire'
                ? 'Score provisoire (données mesurables seules, Ollama indisponible)'
                : mention.scoreStatus === 'en_attente'
                  ? 'Analyse en attente'
                  : mention.scoreStatus === 'echec'
                    ? `Analyse en échec : ${mention.scoreReason ?? 'raison inconnue'}`
                    : `Analyse ${mention.scoreModel ?? 'automatique'} du ${mention.scoredAt ? new Date(mention.scoredAt).toLocaleString('fr-FR') : '—'}`}
            </p>
          </div>
        </div>

        {!analysisFailed && (
          <>
            <div className="score-detail-grid">
              <div><span>Sentiment</span><strong>{mention.sentimentAnalyse ? String(mention.sentimentAnalyse) : '—'}{typeof mention.sentimentScore === 'number' ? ` (${mention.sentimentScore.toFixed(2)})` : ''}</strong></div>
              <div><span>Pertinence</span><strong>{typeof mention.pertinence === 'number' ? `${mention.pertinence}/100` : '—'}</strong></div>
              <div><span>Gravité</span><strong>{typeof mention.gravite === 'number' ? `${mention.gravite}/100` : '—'}</strong></div>
            </div>

            {Array.isArray(mention.themes) && mention.themes.length > 0 && (
              <p className="score-detail-themes">Thèmes : {mention.themes.join(' · ')}</p>
            )}

            {mention.scoreReason && <p className="score-detail-reason">« {mention.scoreReason} »</p>}

            {breakdown?.components?.length ? (
              <table className="data-table score-breakdown-table">
                <thead><tr><th>Composante</th><th>Valeur</th><th>Poids</th><th>Contribution</th></tr></thead>
                <tbody>
                  {breakdown.components.map(component => (
                    <tr key={component.key}>
                      <td>{component.label}{component.detail ? <small> — {component.detail}</small> : null}</td>
                      <td>{Math.round(component.value * 100)} %</td>
                      <td>{Math.round(component.weight * 100)} %</td>
                      <td>{component.contribution.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p>Aucun détail de calcul disponible.</p>}

            {breakdown?.capApplied && <p className="score-detail-cap">{breakdown.capApplied}</p>}
          </>
        )}
      </div>
      <div className="modal-footer">
        <Button onClick={onClose}>Fermer</Button>
      </div>
    </Modal>
  );
}

export function MentionsView() {
  const { data, edit, detail, refresh, syncing, exportData, analyze, notify, save } = useWorkspace();
  const searchParams = useSearchParams();
  const [sentiment,setSentiment] = useState('all'), [source,setSource] = useState(searchParams.get('source') || 'all'), [query,setQuery] = useState(''), [topic,setTopic] = useState('all'), [level,setLevel] = useState('all');
  const [page,setPage] = useState(1), [perPage,setPerPage] = useState(5), [selected,setSelected] = useState<string[]>([]), [period,setPeriod] = useState('30');
  const [sortBy,setSortBy] = useState('score');
  const [searching,setSearching] = useState(false);
  const [deleting,setDeleting] = useState(false);
  const [confirmDeleteAll,setConfirmDeleteAll] = useState(false);
  const [scoreDetail,setScoreDetail] = useState<Entity | null>(null);
  const [scoring,setScoring] = useState(false);
  /** Progression de l'analyse : { done, total, averageMs }. */
  const [scoreProgress,setScoreProgress] = useState<{ done: number; total: number; averageMs?: number } | null>(null);
  const scorePaused = useRef(false);
  const searchInFlight = useRef(false);
  const searchErrorShown = useRef(false);
  const scorePoll = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Suit l'analyse en arrière-plan et rafraîchit le tableau dès qu'elle finit. */
  const watchPendingScores = useCallback(() => {
    if (scorePoll.current) return;
    let attempts = 0;

    const tick = async () => {
      attempts += 1;
      try {
        const response = await fetch('/api/mentions/score', { cache: 'no-store' });
        if (response.ok) {
          const state = await response.json() as { pending?: number };
          if (!state.pending) {
            await refresh();
            notify('Analyse des nouvelles mentions terminée : les scores sont à jour.');
            scorePoll.current = null;
            return;
          }
        }
      } catch {
        // Ignoré : nouvelle tentative au prochain tick.
      }
      // Arrêt après ~45 minutes de suivi (modèles locaux lents).
      if (attempts >= 60) {
        scorePoll.current = null;
        return;
      }
      scorePoll.current = setTimeout(() => void tick(), 45_000);
    };

    scorePoll.current = setTimeout(() => void tick(), 45_000);
  }, [notify, refresh]);

  useEffect(() => () => {
    if (scorePoll.current) clearTimeout(scorePoll.current);
  }, []);
  // Mots-clés actifs : sert au badge « Hors veille » et au compteur exact.
  const activeKeywords = data.keywords
    .filter(keyword => keyword.active !== false)
    .map(keyword => String(keyword.term || keyword.name || ''))
    .filter(Boolean);
  const pendingScores = data.mentions.filter(m =>
    (m.scoreStatus ?? 'en_attente') !== 'final' && !hasInactiveKeyword(m, activeKeywords)
  ).length;
  const inactiveScores = data.mentions.filter(m =>
    (m.scoreStatus ?? 'en_attente') !== 'final' && hasInactiveKeyword(m, activeKeywords)
  ).length;
  /** Résumé lisible d'une session d'analyse. */
  function scoringSummary(analyzed: number, provisional: number, failed: number, remaining: number) {
    if (remaining > 0) return `Analyse en pause : ${remaining} mention(s) restante(s).`;
    const parts = [`${analyzed} mention(s) analysée(s)`];
    if (provisional) parts.push(`${provisional} score(s) provisoire(s) (Ollama indisponible)`);
    if (failed) parts.push(`${failed} échec(s)`);
    return `${parts.join(', ')}.`;
  }

  /**
   * Lance l'analyse sémantique des mentions en attente. Les lots sont
   * enchaînés jusqu'à épuisement de la file (arrêt possible par « Pause »).
   */
  const runScoring = useCallback(async (recalculerTout = false) => {
    setScoring(true);
    scorePaused.current = false;

    let done = 0;
    let total = 0;
    let averageMs: number | undefined;
    let analyzedTotal = 0;
    let provisionalTotal = 0;
    let failedTotal = 0;

    try {
      // Premier lot : `recalculerTout` ne s'applique qu'à lui.
      let first = true;

      while (!scorePaused.current) {
        const response = await fetch('/api/mentions/score', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ recalculerTout: first ? recalculerTout : false }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'L’analyse des mentions a échoué.');
        first = false;

        const analyzed = result.analyzed ?? 0;
        const provisional = result.provisional ?? 0;
        const pending = result.pending ?? 0;

        analyzedTotal += analyzed;
        provisionalTotal += provisional;
        failedTotal += result.failed ?? 0;
        done += analyzed + provisional;
        total = done + pending;
        averageMs = result.averageMs ?? averageMs;
        setScoreProgress({ done, total, averageMs });

        if (pending === 0 || (analyzed === 0 && provisional === 0)) break;
      }

      await refresh();
      if (scorePaused.current) {
        notify(`Analyse mise en pause : ${done} mention(s) traitée(s), ${Math.max(0, total - done)} restante(s).`);
      } else {
        notify(scoringSummary(analyzedTotal, provisionalTotal, failedTotal, total - done));
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : 'L’analyse des mentions a échoué.', true);
    } finally {
      setScoring(false);
    }
  }, [notify, refresh]);

  /** Supprime toutes les mentions, ou uniquement celles fournies. */
  const deleteMentions = useCallback(async (ids?: string[]) => {
    setDeleting(true);
    try {
      const response = await fetch('/api/actions/delete_mentions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ids?.length ? { ids } : {}),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'La suppression des mentions a échoué.');
      await refresh();
      setSelected([]);
      setConfirmDeleteAll(false);
      notify(`${result.deleted ?? 0} mention(s) supprimée(s).`);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'La suppression des mentions a échoué.', true);
    } finally {
      setDeleting(false);
    }
  }, [notify, refresh]);
  const runVeille = useCallback(async (quiet = false) => {
    if (searchInFlight.current) return;
    searchInFlight.current = true;
    setSearching(true);
    try {
      const response = await fetch('/api/mentions/scan', { method: 'POST' });
      const result = (await response.json()) as VeilleScanResult;
      if (!response.ok) throw new Error(result.error || 'La collecte de veille a échoué.');
      searchErrorShown.current = false;
      if (result.added && result.added > 0) {
        await refresh();
        if (!quiet) {
          const sources = (result.sources || []).filter(s => s.added > 0).map(s => s.label).join(', ');
          notify(`${result.added} nouvelle(s) mention(s) enregistrée(s) à partir de ${result.keywords} mot(s)-clé(s)${sources ? ` via ${sources}` : ''}.`);
        }
        // Le score des nouvelles mentions est calculé en arrière-plan par Ollama.
        if (result.pendingScores) {
          if (!quiet) notify(`${result.pendingScores} mention(s) en cours d’analyse par Ollama. Les scores apparaîtront automatiquement.`);
          watchPendingScores();
        }
      } else if (!quiet) {
        notify(result.reason === 'no_keywords'
          ? 'Ajoutez au moins un mot-clé actif dans Paramètres → Mots-clés pour lancer la collecte.'
          : result.warnings?.length
            ? `Aucune nouvelle mention. ${result.checked ?? 0} contenu(s) analysé(s). ${result.warnings[0]}`
            : `Aucune nouvelle mention. ${result.checked ?? 0} contenu(s) analysé(s) sur toutes les sources activées.`);
      }
    } catch (error) {
      if (!quiet || !searchErrorShown.current) {
        notify(error instanceof Error ? error.message : 'La collecte de veille a échoué.', true);
        searchErrorShown.current = true;
      }
    } finally {
      searchInFlight.current = false;
      setSearching(false);
    }
  }, [notify, refresh, watchPendingScores]);
  useEffect(() => {
    let mounted = true;
    let timer: ReturnType<typeof setTimeout>;
    const runSync = async () => {
      await runVeille(true);
      if (mounted) timer = setTimeout(runSync, 15 * 60 * 1000);
    };
    void runSync();
    return () => {
      mounted = false;
      clearTimeout(timer);
    };
  }, [runVeille]);
  // Tri par défaut sur le score (le plus prioritaire en tête), sinon par date.
  const filtered = data.mentions.filter(m=>(sentiment==='all'||m.sentiment===sentiment)&&(source==='all'||m.platform===source)&&(topic==='all'||m.category===topic)&&(level==='all'||m.scoreLevel===level)&&`${m.name} ${m.author}`.toLowerCase().includes(query.toLowerCase())).sort((a,b)=>{
    if (sortBy==='views') return (b.metrics?.views??-1)-(a.metrics?.views??-1);
    if (sortBy==='comments') return (b.metrics?.comments??-1)-(a.metrics?.comments??-1);
    if (sortBy==='score') return (b.score??-1)-(a.score??-1) || new Date(b.date||0).getTime()-new Date(a.date||0).getTime();
    return new Date(b.date||0).getTime()-new Date(a.date||0).getTime();
  });
  const pageCount = Math.max(1,Math.ceil(filtered.length/perPage));
  const actualPage = Math.min(page,pageCount);
  const visible=filtered.slice((actualPage-1)*perPage,actualPage*perPage);
  function resetFilter(set:(value:string)=>void,value:string){set(value);setPage(1);setSelected([]);}
  return <div className="section-page mentions-page"><PageHeading title="Mentions & Analyses" icon="message" 
    subtitle="">
      {/* Surveillez, analysez et comprenez toutes les mentions concernant cette personnalité sur le web et les réseaux sociaux. Les mots-clés définis dans Paramètres → Mots-clés sont recherchés sur toutes les sources activées (Page Facebook, Google News, flux RSS…), automatiquement toutes les 15 minutes, même sans cette page ouverte. */}
    <div className="period-control"><Icon name="calendar" size={18} /><Select value={period} onChange={e=>setPeriod(e.target.value)} aria-label="Période des mentions"><option value="30">Période : 01 sept. 2026 → 30 sept. 2026</option><option value="7">7 derniers jours</option><option value="90">90 derniers jours</option></Select></div><Button icon="radar" busy={searching} onClick={()=>void runVeille()}>Lancer la recherche multi-sources</Button><Button icon="refresh" busy={syncing} onClick={async()=>{await refresh();notify('Les mentions sont à jour.');}}>Actualiser</Button><Button variant="primary" icon="download" onClick={()=>void exportData('mentions')}>Exporter</Button></PageHeading>
    <MentionMetrics last="engagement" />
    <div className="mentions-chart-row"><ChartPanel key={period} title="Évolution des mentions" multi /><SentimentPanel /><QuickAnalysis /></div>
    <div className="mentions-lower"><div className="mention-table-area"><div className="mention-toolbar"><div className="filter-tabs">{[['all','Toutes','2 487'],['positive','Positives','1 742'],['neutral','Neutres','512'],['negative','Négatives','233']].map(([key,label,count])=><button key={key} className={`${sentiment===key?'selected':''} tab-${key}`} onClick={()=>resetFilter(setSentiment,key)}>{label} ({count})</button>)}</div><div className="table-filters"><Select aria-label="Filtrer par source" value={source} onChange={e=>resetFilter(setSource,e.target.value)}><option value="all">Toutes les sources</option>{Object.entries(platformNames).map(([key,label])=><option value={key} key={key}>{label}</option>)}</Select><Select aria-label="Filtrer par sujet" value={topic} onChange={e=>resetFilter(setTopic,e.target.value)}><option value="all">Tous les types</option>{[...new Set(data.mentions.map(m=>m.category))].filter(Boolean).map(t=><option key={t}>{t}</option>)}</Select><label className="table-search"><Icon name="search" size={14} /><input aria-label="Rechercher une mention" placeholder="Rechercher..." value={query} onChange={e=>resetFilter(setQuery,e.target.value)} /></label><Select aria-label="Trier les mentions" value={sortBy} onChange={e=>{setSortBy(e.target.value);setPage(1);}}><option value="score">Score (priorité)</option><option value="recent">Plus récentes</option><option value="views">Plus vues</option><option value="comments">Plus commentées</option></Select><Select aria-label="Filtrer par niveau de score" value={level} onChange={e=>resetFilter(setLevel,e.target.value)}><option value="all">Tous les niveaux</option><option value="eleve">Élevé / critique</option><option value="moyen">Moyen</option><option value="faible">Faible</option></Select><Button icon="brain" busy={scoring} onClick={()=>void runScoring()}>Analyser les mentions en attente ({pendingScores})</Button>{inactiveScores > 0 && <Button icon="radar" busy={scoring} onClick={()=>void runScoring(true)} title="Inclut les mentions dont le mot-clé n'est plus actif">Tout recalculer ({inactiveScores})</Button>}<IconButton name="plus" label="Ajouter une mention" className="bordered" onClick={()=>edit('mentions')} /><Button variant="danger-ghost" icon="delete" disabled={!data.mentions.length} onClick={()=>setConfirmDeleteAll(true)}>Tout supprimer</Button></div></div>
    {selected.length>0 && <div className="selection-toolbar"><span>{selected.length} mention(s) sélectionnée(s)</span><Button icon="check" onClick={async()=>{await Promise.all(selected.map(id=>save('mentions',{status:'reviewed'},id)));setSelected([]);notify('Les mentions sélectionnées sont marquées comme lues.');}}>Marquer comme lues</Button><Button variant="danger" icon="delete" busy={deleting} onClick={()=>void deleteMentions(selected)}>Supprimer la sélection</Button><Button onClick={()=>setSelected([])}>Annuler</Button></div>}
    {scoreProgress && scoreProgress.total > 0 && <div className="score-progress">
      <div className="score-progress-track"><i style={{ width: `${Math.round((scoreProgress.done / scoreProgress.total) * 100)}%` }} /></div>
      <span className="score-progress-label">
        Analyse : {scoreProgress.done} / {scoreProgress.total} mentions
        {scoreProgress.averageMs && scoreProgress.total > scoreProgress.done
          ? ` (≈ ${Math.max(1, Math.ceil(((scoreProgress.total - scoreProgress.done) * scoreProgress.averageMs) / 60000))} min restantes)`
          : ''}
      </span>
      {scoring
        ? <Button icon="close" onClick={() => { scorePaused.current = true; }}>Pause</Button>
        : <Button icon="brain" onClick={() => void runScoring()}>Reprendre l’analyse</Button>}
    </div>}
    <div className="data-table-wrap"><table className="data-table mention-table"><thead><tr><th><input type="checkbox" aria-label="Sélectionner toutes les mentions visibles" checked={visible.length>0&&visible.every(m=>selected.includes(m.id))} onChange={e=>setSelected(e.target.checked?visible.map(m=>m.id):[])} /></th><th>Source</th><th>Auteur / Canal</th><th>Contenu de la mention</th><th>Sentiment</th><th>Score</th><th>Engagement</th><th>Date</th><th>Actions</th></tr></thead><tbody>{visible.map(m=><tr key={m.id} className={selected.includes(m.id)?'row-selected':''}><td><input type="checkbox" aria-label={`Sélectionner la mention de ${m.author}`} checked={selected.includes(m.id)} onChange={e=>setSelected(prev=>e.target.checked?[...prev,m.id]:prev.filter(id=>id!==m.id))} /></td><td><div className="table-source"><PlatformIcon platform={m.platform} /><span>{platformNames[m.platform||'web']}<small>{m.platform==='youtube'?'Vidéos':m.platform==='web'?'Site web':m.platform==='x'?'Microblogging':'Réseau social'}</small></span></div></td><td><div className="table-author"><span className="tiny-avatar"><Icon name="user" size={17} /></span><span>{m.author}<small>{m.time}</small></span></div></td><td><button className="mention-content-button" onClick={()=>detail(m)}>“{m.name}”</button></td><td><Badge status={m.sentiment} /></td><td><button className="score-cell" onClick={()=>setScoreDetail(m)} title="Voir le détail du score"><ScoreBadge mention={m} keywordInactive={hasInactiveKeyword(m, activeKeywords)} /></button></td><td><div className="table-engagement" title={m.platform==='facebook'||m.platform==='youtube'?undefined:NO_METRICS_TOOLTIP}><span className="engagement-metric"><Icon name="eye" size={13} />{compactNumber(m.metrics?.views)}</span><span className="engagement-metric"><Icon name="message" size={13} />{compactNumber(m.metrics?.comments)}</span><span className="engagement-metric"><Icon name="thumbs" size={13} />{compactNumber(m.metrics?.likes)}</span></div></td><td><span className="table-date">{m.date?new Date(m.date).toLocaleDateString('fr-FR'):'12/09/2026'}<small>14:32</small></span></td><td><div className="table-actions"><IconButton name="eye" label="Voir la mention" onClick={()=>detail(m)} /><IconButton name="link" label="Ouvrir la source originale" onClick={()=>m.url?window.open(m.url,'_blank','noopener,noreferrer'):detail(m)} /><IconButton name="more" label="Modifier ou supprimer la mention" onClick={()=>edit('mentions',m)} /></div></td></tr>)}</tbody></table>{!visible.length&&<EmptyState title="Aucune mention ne correspond à vos filtres" message="Essayez un autre mot-clé ou réinitialisez vos filtres." action={<Button onClick={()=>{setQuery('');setSource('all');setSentiment('all');setTopic('all');}}>Réinitialiser les filtres</Button>} />}</div><Pagination page={actualPage} total={filtered.length} perPage={perPage} onChange={setPage} onPerPage={n=>{setPerPage(n);setPage(1);}} /></div>
    <aside className="mentions-aside"><Panel title="Principaux sujets" icon="bookmark" action={<TextLink onClick={()=>void analyze()} />}><TopicBars /></Panel><ScoreSummary /><Panel title="Nuage de mots-clés" icon="tag"><WordCloud keywords={data.keywords} /></Panel></aside></div>
    {confirmDeleteAll && <Modal title="Supprimer toutes les mentions ?" onClose={()=>setConfirmDeleteAll(false)}>
      <div className="modal-body">
        <p>Cette action est irréversible : les <strong>{data.mentions.length} mention(s)</strong> enregistrées dans votre espace seront définitivement supprimées.</p>
        <p className="form-hint">Vos mots-clés et vos sources restent configurés : la prochaine collecte (automatique toutes les 15 minutes, ou via « Lancer la recherche multi-sources ») les réalimentera.</p>
      </div>
      <div className="modal-footer">
        <Button onClick={()=>setConfirmDeleteAll(false)}>Annuler</Button>
        <span className="spacer" />
        <Button variant="danger" icon="delete" busy={deleting} onClick={()=>void deleteMentions()}>Tout supprimer</Button>
      </div>
    </Modal>}
    {scoreDetail && <ScoreDetailModal mention={scoreDetail} keywordInactive={hasInactiveKeyword(scoreDetail, activeKeywords)} onClose={()=>setScoreDetail(null)} />}
  </div>;
}
