'use client';
import { useState, type ReactNode } from 'react';
import { demoData, platformNames } from '@/lib/demo-data';
import { formatNumber } from '@/lib/types';
import { compactNumber } from '@/lib/sources/metrics';
import { scoreLevelLabels, scoreLevelOf } from '@/lib/score/scoring.config';
import { useWorkspace } from '../workspace-context';
import { Avatar, Badge, Button, EmptyState, Icon, IconButton, Panel, PlatformIcon, Select, TextLink } from '../ui';
import { ChartPanel, Donut, ScoreBreakdown, SentimentPanel } from '../charts';

export function StatCard({ title, value, icon, tone = 'green', change, subtitle, children, className = '' }: { title: string; value: ReactNode; icon: string; tone?: string; change?: ReactNode; subtitle?: string; children?: ReactNode; className?: string }) {
  return <div className={`stat-card stat-${tone} ${className}`}><span className={`stat-icon ${tone}`}><Icon name={icon} size={27} /></span><div className="stat-copy"><span className="stat-title">{title}</span><strong className="stat-value">{value}</strong>{change && <b className={`stat-change text-${tone === 'blue' ? 'blue' : tone === 'red' ? 'red' : 'green'}`}>{change}</b>}{subtitle && <small>{subtitle}</small>}</div>{children}</div>;
}
export function MentionMetrics({ last = 'score', compact = false }: { last?: 'score' | 'engagement' | 'risk'; compact?: boolean }) {
  const { data } = useWorkspace();
  const total = 2487 + data.mentions.length - demoData.mentions.length;
  const positive = 1742 + data.mentions.filter(m => m.sentiment === 'positive').length - demoData.mentions.filter(m => m.sentiment === 'positive').length;
  const neutral = 512 + data.mentions.filter(m => m.sentiment === 'neutral').length - demoData.mentions.filter(m => m.sentiment === 'neutral').length;
  const negative = 233 + data.mentions.filter(m => m.sentiment === 'negative').length - demoData.mentions.filter(m => m.sentiment === 'negative').length;

  // Totaux d'engagement : seules les mentions disposant de métriques sont comptées.
  const withViews = data.mentions.filter(m => typeof m.metrics?.views === 'number');
  const withComments = data.mentions.filter(m => typeof m.metrics?.comments === 'number');
  const totalViews = withViews.reduce((sum, m) => sum + (m.metrics?.views ?? 0), 0);
  const totalComments = withComments.reduce((sum, m) => sum + (m.metrics?.comments ?? 0), 0);
  return <div className={`metric-grid ${compact ? 'metrics-compact' : ''}`}><StatCard title="Mentions totales" value={formatNumber(total)} icon="message" tone="blue" change={<><Icon name="up" size={13} />18,5%</>} subtitle="vs. semaine précédente" /><StatCard title="Mentions positives" value={formatNumber(positive)} icon="smile" change={`${(positive / Math.max(1,total) * 100).toFixed(1).replace('.',',')}%`} /><StatCard title="Mentions neutres" value={formatNumber(neutral)} icon="neutral" tone="blue" change={`${(neutral / Math.max(1,total) * 100).toFixed(1).replace('.',',')}%`} /><StatCard title="Mentions négatives" value={formatNumber(negative)} icon="frown" tone="red" change={`${(negative / Math.max(1,total) * 100).toFixed(1).replace('.',',')}%`} />{last === 'score' ? <StatCard title="Score global" value={<><span>78</span><em>/100</em><b className="inline-trend"><Icon name="up" size={12} />6,3%</b></>} icon="trend" subtitle="vs. mois précédent" /> : last === 'engagement' ? <StatCard title="Vues cumulées" value={formatNumber(totalViews)} icon="eye" tone="blue" subtitle={`${formatNumber(totalComments)} commentaires · ${formatNumber(withViews.length)} mention(s) mesurée(s)`} /> : <StatCard title="Niveau de risque" value={<span className="text-green risk-low">FAIBLE</span>} icon="shield"><div className="risk-meter"><i /></div></StatCard>}</div>;
}
/** Résumé des scores de réputation : moyenne et répartitions. */
export function ScoreSummary() {
  const { data } = useWorkspace();

  const scored = data.mentions.filter(m => typeof m.score === 'number');
  const average = scored.length
    ? Math.round(scored.reduce((sum, m) => sum + (m.score ?? 0), 0) / scored.length)
    : 0;

  const byLevel = (['eleve', 'moyen', 'faible'] as const).map(level => ({
    level,
    label: scoreLevelLabels[level],
    count: scored.filter(m => m.scoreLevel === level).length,
  }));

  const bySentiment = (['negatif', 'neutre', 'positif'] as const).map(sentiment => ({
    sentiment,
    count: data.mentions.filter(m => (m.sentimentAnalyse ?? m.sentiment) === sentiment).length,
  }));

  const averageLevel = scoreLevelOf(average);

  return (
    <Panel title="Score de réputation" icon="trend">
      <div className="score-summary">
        <div className="score-summary-average">
          <strong>{average}</strong>
          <span>/ 100</span>
          <Badge status={averageLevel.level === 'eleve' ? 'negative' : averageLevel.level === 'moyen' ? 'neutral' : 'positive'}>
            {averageLevel.label}
          </Badge>
          <small>{scored.length} mention(s) analysée(s)</small>
        </div>
        <div className="score-summary-rows">
          {byLevel.map(entry => (
            <div key={entry.level} className="score-summary-row">
              <span>{entry.label}</span>
              <div className="score-summary-bar"><i style={{ width: `${scored.length ? (entry.count / scored.length) * 100 : 0}%` }} /></div>
              <strong>{entry.count}</strong>
            </div>
          ))}
          {bySentiment.map(entry => (
            <div key={entry.sentiment} className="score-summary-row">
              <span>{entry.sentiment}</span>
              <div className="score-summary-bar"><i style={{ width: `${data.mentions.length ? (entry.count / data.mentions.length) * 100 : 0}%` }} /></div>
              <strong>{entry.count}</strong>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}

export function MiniMentions({ limit = 5, className = '' }: { limit?: number; className?: string }) {  const { data, detail, edit, navigate } = useWorkspace();
  return <Panel title="Dernières mentions" icon="success" action={<TextLink onClick={() => navigate('mentions')} />} className={`mini-mentions ${className}`}><div className="mini-mention-list">{data.mentions.length ? data.mentions.slice(0, limit).map(mention => <div className="mini-mention-row" key={mention.id} role="button" tabIndex={0} onClick={() => detail(mention)} onKeyDown={e => { if (e.key === 'Enter') detail(mention); }}><div className="mini-source"><PlatformIcon platform={mention.platform} size="small" /><span><strong>{platformNames[mention.platform || 'web']}</strong><small>{mention.author}</small></span></div><p>{mention.name}</p><Badge status={mention.sentiment} /><div className="mini-mention-time"><span>{mention.time}</span><small><Icon name="eye" size={11} />{compactNumber(mention.metrics?.views)}</small></div><IconButton name="more" label="Modifier la mention" onClick={e => { e.stopPropagation(); edit('mentions', mention); }} /></div>) : <EmptyState title="Aucune mention" message="Les nouvelles mentions apparaîtront ici." icon="message" />}</div></Panel>;
}
export function DashboardView() {
  const { data, navigate, detail, save, notify } = useWorkspace();
  const [period, setPeriod] = useState('7');
  const profile = data.profile[0];
  const monitoring = profile?.active !== false;
  const alerts = [data.alerts[5], data.alerts[2], data.alerts[6], data.alerts[3], data.alerts[7]].filter(Boolean);
  return <div className="dashboard-layout">
    <section className="dashboard-hero"><div className="hero-identity"><Avatar size="hero" /><div><h1>{profile?.name && profile.name !== 'Arnaud TIOTSOP KENNE' ? profile.name : 'Arnaud KENNE'} <span className="verified"><Icon name="check" size={11} /></span></h1><p>Entrepreneur | Formateur | Expert en IT</p><div className="social-links">{['facebook','instagram','x','linkedin','youtube','tiktok','web'].map(platform => <button key={platform} title={`Voir les mentions ${platformNames[platform]}`} onClick={() => navigate(`mentions?source=${platform}`)}><PlatformIcon platform={platform} size="small" /></button>)}</div></div></div><div className="dashboard-period"><Icon name="calendar" size={20} /><Select value={period} onChange={e => setPeriod(e.target.value)} aria-label="Période du tableau de bord"><option value="7">Période : 7 derniers jours</option><option value="30">Période : 30 derniers jours</option><option value="90">Période : 90 derniers jours</option></Select></div><button className={`monitoring-status ${!monitoring ? 'paused' : ''}`} onClick={async () => { if (!profile) return; const updated = await save('profile',{ active: !monitoring },profile.id); if(updated) notify(monitoring ? 'La surveillance a été mise en pause.' : 'La surveillance est activée.'); }}><span><i className={`dot ${monitoring ? 'green' : 'yellow'}`} /><strong>{monitoring ? 'Surveillance active' : 'Surveillance en pause'}</strong><Badge status={monitoring ? 'connected' : 'partial'} subtle>{monitoring ? 'En ligne' : 'En pause'}</Badge></span><small>Dernière analyse : 12 sept. 2026 – 14:32</small></button></section>
    <MentionMetrics />
    <div className="dashboard-chart-row"><ChartPanel key={period} /><SentimentPanel /><ScoreBreakdown /></div>
    <div className="dashboard-detail-row"><MiniMentions /><Panel title={<>Alertes récentes <span className="heading-count">7</span></>} icon="alert" action={<TextLink onClick={() => navigate('alertes')} />} className="recent-alerts"><div className="recent-alert-list">{alerts.length ? alerts.map(alert => <button className={`recent-alert-row severity-${alert.severity}`} key={alert.id} onClick={() => detail(alert)}><span className="alert-orb"><Icon name={alert.severity === 'critical' ? 'alert' : alert.severity === 'low' ? 'check' : alert.severity === 'info' ? 'lock' : 'warning'} size={19} /></span><span className="recent-alert-copy"><strong>{alert.name}</strong><small>{alert.description}</small></span><time>{alert.time}</time><Badge status={alert.severity} /></button>) : <EmptyState title="Aucune alerte" message="Votre réputation est sous contrôle." icon="shield" />}</div></Panel><Panel title="Reputation Score" icon="lock" className="reputation-panel"><Donut score={78} /><Button variant="primary" onClick={() => navigate('rapports')}>Voir le rapport détaillé <Icon name="arrow" size={15} /></Button></Panel></div>
    <div className="quick-tiles">{[
      { icon:'eye',title:'Monitoring 24/7',text:'Surveillance continue de toutes vos sources.',tone:'green',target:'sources' },
      { icon:'cpu',title:'Analyse IA',text:'Analyse sémantique et détection de risques.',tone:'blue',target:'analyse' },
      { icon:'warning',title:'Gestion de crise',text:'Réagissez rapidement aux situations critiques.',tone:'yellow',target:'crise' },
      { icon:'users',title:'Relations médias',text:'Développez votre visibilité avec des médias fiables.',tone:'purple',target:'medias' },
      { icon:'bars',title:'Rapports',text:'Tableaux de bord et rapports personnalisés.',tone:'teal',target:'rapports' },
    ].map(tile => <button className={`quick-tile tile-${tile.tone}`} key={tile.title} onClick={() => navigate(tile.target)}><Icon name={tile.icon} size={34} /><span><strong>{tile.title}</strong><small>{tile.text}</small></span><span className="tile-arrow"><Icon name="arrow" size={14} /></span></button>)}</div>
  </div>;
}
