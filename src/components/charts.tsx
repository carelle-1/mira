'use client';
import { useEffect, useId, useState } from 'react';
import { Icon, Panel, Select } from './ui';
import type { Entity } from '@/lib/types';

export const reputationValues = [33, 41, 39, 59, 56, 62, 73, 78];
function smoothPath(points: number[][]) {
  if (!points.length) return '';
  let d = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length; i++) {
    const p0 = points[Math.max(0, i - 2)], p1 = points[i - 1], p2 = points[i], p3 = points[Math.min(points.length - 1, i + 1)];
    d += ` C ${p1[0] + (p2[0] - p0[0]) / 6} ${p1[1] + (p2[1] - p0[1]) / 6}, ${p2[0] - (p3[0] - p1[0]) / 6} ${p2[1] - (p3[1] - p1[1]) / 6}, ${p2[0]} ${p2[1]}`;
  }
  return d;
}
export function LineChart({ values = reputationValues, labels = ['06/09', '07/09', '08/09', '09/09', '10/09', '11/09', '12/09', ''], color = '#00eb87', max = 100, multi = false, compact = false, tooltip = true }: { values?: number[]; labels?: string[]; color?: string; max?: number; multi?: boolean; compact?: boolean; tooltip?: boolean }) {
  const id = useId().replace(/:/g, '');
  const [hover, setHover] = useState<number | null>(null);
  const left = compact ? 0 : 30, right = 12, top = 10, bottom = compact ? 2 : 27;
  const width = 540, height = 184, innerW = width - left - right, innerH = height - top - bottom;
  const points = values.map((v, i) => [left + i * innerW / Math.max(1, values.length - 1), top + innerH * (1 - v / max)]);
  const path = smoothPath(points);
  const active = hover ?? values.length - 1;
  const activePoint = points[active];
  return <div className={`line-chart ${compact ? 'chart-compact' : ''}`} onMouseLeave={() => setHover(null)} onMouseMove={e => { if (!compact) { const rect = e.currentTarget.getBoundingClientRect(); setHover(Math.max(0, Math.min(values.length - 1, Math.round(((e.clientX - rect.left) / rect.width * width - left) / innerW * (values.length - 1))))); } }}>
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={`Évolution : ${values.join(', ')}`}>
      <defs><linearGradient id={`fill-${id}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity=".35" /><stop offset="100%" stopColor={color} stopOpacity=".015" /></linearGradient><filter id={`glow-${id}`} x="-150%" y="-150%" width="400%" height="400%"><feGaussianBlur stdDeviation="3" /></filter></defs>
      {!compact && <g className="chart-grid">{[0, 20, 40, 60, 80, 100].map(p => <g key={p}><line x1={left} x2={width - right} y1={top + innerH * p / 100} y2={top + innerH * p / 100} /><text x={left - 9} y={top + innerH * p / 100 + 3} textAnchor="end">{Math.round(max * (1 - p / 100))}</text></g>)}{points.map((point, i) => <g key={i}><line x1={point[0]} x2={point[0]} y1={top} y2={height - bottom} /><text x={point[0]} y={height - 7} textAnchor="middle">{labels[i] || ''}</text></g>)}</g>}
      <path d={`${path} L ${points[points.length - 1][0]} ${height - bottom} L ${left} ${height - bottom} Z`} fill={`url(#fill-${id})`} />
      <path d={path} fill="none" stroke={color} strokeWidth={compact ? 2 : 2.6} vectorEffect="non-scaling-stroke" />
      {multi && [0.46, 0.14].map((factor, j) => { const pts = values.map((v, i) => [points[i][0], top + innerH * (1 - (v * factor + ((i % 3) - 1) * max * .03) / max)]); return <g key={j}><path d={smoothPath(pts)} fill="none" stroke={j === 0 ? '#119bf7' : '#fb4b5e'} strokeWidth="2" vectorEffect="non-scaling-stroke" />{pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="3.2" fill={j === 0 ? '#119bf7' : '#fb4b5e'} />)}</g>; })}
      {!compact && points.map((point, i) => <circle key={i} cx={point[0]} cy={point[1]} r="3.1" fill={color} />)}
      {!compact && <g><circle cx={activePoint[0]} cy={activePoint[1]} r="7" fill={color} filter={`url(#glow-${id})`} /><circle cx={activePoint[0]} cy={activePoint[1]} r="3.7" fill="#c8ffe5" /></g>}
      {!compact && hover !== null && <line x1={activePoint[0]} x2={activePoint[0]} y1={top} y2={height - bottom} stroke="#79a296" strokeDasharray="3 3" />}
    </svg>
    {tooltip && !compact && <div className="chart-tooltip" style={{ left: `${Math.min(80, Math.max(15, activePoint[0] / width * 100 - 19))}%`, top: `${Math.max(0, activePoint[1] / height * 100 - 28)}%` }}><span>{labels[active] || '12 sept. 2026'}</span><strong>Score : {values[active]}/100</strong></div>}
  </div>;
}
export function ChartPanel({ title = 'Évolution de la réputation', icon = 'lock', multi = false, className = '' }: { title?: string; icon?: string; multi?: boolean; className?: string }) {
  const [period, setPeriod] = useState('7');
  const values = period === '7' ? reputationValues : period === '30' ? [34, 47, 43, 61, 55, 64, 72, 78] : [29, 39, 46, 51, 59, 66, 73, 78];
  return <Panel title={title} icon={icon} className={`evolution-panel ${className}`} action={<Select aria-label="Période du graphique" value={period} onChange={e => setPeriod(e.target.value)}><option value="7">7 jours</option><option value="30">30 jours</option><option value="90">90 jours</option></Select>}>{multi && <div className="chart-legend"><span><i className="dot green" />Score global</span><span><i className="dot blue" />Sentiment positif</span><span><i className="dot red" />Sentiment négatif</span></div>}<LineChart values={values} multi={multi} labels={period === '7' ? undefined : ['Jan.', 'Fév.', 'Mars', 'Avr.', 'Mai', 'Juin', 'Juil.', 'Sept.']} /></Panel>;
}
export function Donut({ score, total = '2 487', label = 'mentions', small = false, source = false }: { score?: number; total?: string; label?: string; small?: boolean; source?: boolean }) {
  const r = 49, circumference = 2 * Math.PI * r;
  const segments = source ? [{ value: 62, color: '#0dbce7' }, { value: 18, color: '#aa62d4' }, { value: 10, color: '#efc719' }, { value: 6, color: '#8369e3' }, { value: 4, color: '#6f849a' }] : [{ value: 70.1, color: '#00ed84' }, { value: 20.6, color: '#078dfd' }, { value: 9.4, color: '#ff4358' }];
  let offset = 0;
  return <div className={`donut ${score !== undefined ? 'score-donut' : ''} ${small ? 'donut-small' : ''}`}><svg viewBox="0 0 120 120" role="img" aria-label={score !== undefined ? `Score de réputation : ${score} sur 100` : 'Répartition des sentiments'}><circle cx="60" cy="60" r={r} fill="none" stroke="#005f49" strokeWidth="11" />{score !== undefined ? <circle cx="60" cy="60" r={r} fill="none" stroke="#00f385" strokeWidth="11" strokeDasharray={`${circumference * score / 100} ${circumference}`} strokeLinecap="round" transform="rotate(-90 60 60)" /> : segments.map((s, i) => { const current = offset; offset += s.value; return <circle key={i} cx="60" cy="60" r={r} fill="none" stroke={s.color} strokeWidth="15" strokeDasharray={`${circumference * s.value / 100} ${circumference}`} strokeDashoffset={-circumference * current / 100} transform="rotate(-90 60 60)" />; })}</svg><div className="donut-center"><strong>{score ?? total}</strong><span>{score !== undefined ? '/100' : label}</span>{score !== undefined && <b><Icon name="up" size={12} />6,3%</b>}</div></div>;
}
export function SentimentPanel({ className = '', total = '2 487', title = 'Répartition des sentiments' }: { className?: string; total?: string; title?: string }) {
  return <Panel title={title} className={`sentiment-panel ${className}`}><Donut total={total} /><div className="sentiment-legend"><div><span><i className="dot green" />Positives</span><b>1 742</b><em className="text-green">70,1%</em></div><div><span><i className="dot blue" />Neutres</span><b>512</b><em className="text-blue">20,6%</em></div><div><span><i className="dot red" />Négatives</span><b>233</b><em className="text-red">9,4%</em></div></div></Panel>;
}
export const scoreParts = [['Visibilité',84],['Crédibilité',81],['Autorité',72],['Cohérence',88],['Présence média',79],['Risque',31]] as const;
export function ScoreBreakdown({ className = '' }: { className?: string }) {
  return <Panel title="Score détaillé" icon="globe" className={`score-breakdown ${className}`}><div className="score-bars">{scoreParts.map(([name, value], i) => <div key={name}><span>{name}</span><small>{value}<em>/100</em></small><div className="progress-track"><i style={{ width: `${value}%`, background: i === 5 ? 'var(--red)' : i === 2 ? 'var(--blue)' : 'var(--green)' }} /></div></div>)}</div></Panel>;
}
export function TopicBars({ numbered = false }: { numbered?: boolean }) {
  return <div className={`topic-bars ${numbered ? 'numbered' : ''}`}>{[['Innovation technologique','32,4',84,'green'],['Formation / Éducation','24,8',67,'blue'],['Cybersécurité','18,2',44,'purple'],['Business / Entrepreneuriat','14,3',32,'yellow'],['Autres sujets','10,1',23,'muted']].map(([label, value, width, color], i) => <div className="topic" key={label}>{numbered && <b className={`topic-number ${color}`}>{i + 1}</b>}<div><span>{label}</span><div className="progress-track"><i className={String(color)} style={{ width: `${width}%` }} /></div></div><strong>{value}%</strong></div>)}</div>;
}
const defaultCloudTerms = ['entrepreneuriat', 'formation', 'développement', 'digital', 'Ghostroar', 'cybersécurité', 'innovation', 'expert', 'technologie', 'Afrique', 'projet', 'réussite', 'leadership'];
const cloudColors = ['wc-green', 'wc-blue', 'wc-purple', 'wc-yellow', 'wc-red'];

export function WordCloud({ keywords = [] }: { keywords?: Entity[] }) {
  const [focusedIndex, setFocusedIndex] = useState(0);
  const savedTerms = keywords.map(keyword => keyword.term?.trim() || keyword.name.trim()).filter(Boolean);
  const terms = savedTerms.length ? savedTerms : defaultCloudTerms;

  useEffect(() => {
    if (terms.length < 2 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const interval = window.setInterval(() => {
      setFocusedIndex(index => (index + 1) % terms.length);
    }, 2400);
    return () => window.clearInterval(interval);
  }, [terms.length]);

  return <div className="word-cloud" role="img" aria-label={`Nuage de mots-clés : ${terms.join(', ')}`}>
    {terms.map((term, index) => <span
      key={`${term}-${index}`}
      className={`wc-term ${cloudColors[index % cloudColors.length]} ${index === focusedIndex % terms.length ? 'is-focused' : ''}`}
      data-size={Math.max(1, 5 - Math.floor(index / 3))}
      aria-hidden="true"
    >{term}</span>)}
  </div>;
}
