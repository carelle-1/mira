'use client';
import { useEffect, useRef, type ReactNode, type ButtonHTMLAttributes, type SelectHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import * as L from 'lucide-react';
import { useWorkspace } from './workspace-context';

const iconMap: Record<string, L.LucideIcon> = {
  home:L.House, user:L.UserRound, radar:L.Radar, mentions:L.MessagesSquare, brain:L.BrainCircuit, bell:L.Bell, crisis:L.ShieldAlert, content:L.FilePenLine, users:L.UsersRound, chart:L.ChartNoAxesCombined, shield:L.ShieldCheck, settings:L.Settings, search:L.Search, menu:L.Menu, down:L.ChevronDown, left:L.ChevronLeft, right:L.ChevronRight, arrow:L.ArrowRight, up:L.ArrowUpRight, back:L.ArrowLeft, plus:L.Plus, close:L.X, check:L.Check, success:L.CircleCheck, alert:L.CircleAlert, warning:L.TriangleAlert, support:L.Headphones, sun:L.Sun, moon:L.Moon, layers:L.Layers, calendar:L.CalendarDays, download:L.Download, edit:L.Pencil, delete:L.Trash2, eye:L.Eye, link:L.Link, external:L.ExternalLink, refresh:L.RefreshCw, loading:L.LoaderCircle, sliders:L.SlidersHorizontal, more:L.EllipsisVertical, smile:L.Smile, frown:L.Frown, neutral:L.Meh, message:L.MessageCircle, globe:L.Globe, mail:L.Mail, phone:L.Phone, pin:L.MapPin, work:L.BriefcaseBusiness, building:L.Building2, languages:L.Languages, target:L.Target, bulb:L.Lightbulb, cpu:L.Cpu, trend:L.TrendingUp, decrease:L.TrendingDown, bars:L.ChartNoAxesColumnIncreasing, lock:L.LockKeyhole, logout:L.LogOut, copy:L.Copy, send:L.Send, clock:L.Clock3, fire:L.Flame, star:L.Star, file:L.FileText, radio:L.Radio, tv:L.Tv, mic:L.Mic, instagram:L.Camera, facebook:L.UserRound, linkedin:L.BriefcaseBusiness, youtube:L.Play, camera:L.Camera, heart:L.Heart, tag:L.Tag, filter:L.ListFilter, magic:L.WandSparkles, sound:L.Volume2, help:L.CircleHelp, bolt:L.Zap, megaphone:L.Megaphone, bookmark:L.Bookmark, info:L.Info, key:L.KeyRound, upload:L.Upload, activity:L.Activity, thumbs:L.ThumbsUp, crown:L.Crown, mask:L.VenetianMask, puzzle:L.Puzzle, save:L.Save, smartphone:L.Smartphone, monitor:L.Monitor, infinity:L.Infinity,
};
export function Icon({ name, size = 18, className = '', ...props }: { name: string; size?: number; className?: string; style?: React.CSSProperties }) {
  const Component = iconMap[name] || L.Circle;
  return <Component size={size} strokeWidth={1.7} className={`icon ${className}`} aria-hidden="true" {...props} />;
}
export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={`brand ${compact ? 'compact' : ''}`}
      style={{ padding: '16px', display: 'flex', justifyContent: 'center' }}
    >
      <img
        src="/images/logo4.png"
        alt=""
        className="brand-lion"
        style={{ width: '100%', height: 'auto' }}
      />
    </div>
  );
}
export function Avatar({ size = 'normal', className = '' }: { size?: string; className?: string }) {
  const { data } = useWorkspace();
  const image = data.profile[0]?.image || '/images/arnaud-kenne.jpg';
  return <span className={`avatar avatar-${size} ${className}`}><img src={image} alt="Arnaud Kenne" /></span>;
}
export function PlatformIcon({ platform = 'web', size = 'normal' }: { platform?: string; size?: string }) {
  let content: ReactNode;
  if (platform === 'facebook') content = <b className="facebook-glyph">f</b>;
  else if (platform === 'linkedin') content = <b className="linkedin-glyph">in</b>;
  else if (platform === 'x') content = <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M18.9 2H22l-6.8 7.8L23.2 22h-6.3L12 14.6 5.5 22H2.3l8.2-9.4L.8 2h6.5l4.5 6.7L18.9 2Zm-1.1 18h1.7L6.3 3.9H4.5L17.8 20Z" /></svg>;
  else if (platform === 'youtube') content = <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="4" fill="white" /><path d="m10 9 6 3-6 3Z" fill="#ff1235" /></svg>;
  else if (platform === 'instagram') content = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4.2" /><circle cx="17.4" cy="6.7" r=".9" fill="currentColor" stroke="none" /></svg>;
  else if (platform === 'tiktok') content = <span className="tiktok-glyph">♪</span>;
  else if (platform === 'google') content = <b className="google-glyph">G</b>;
  else if (platform === 'whatsapp') content = <Icon name="phone" size={25} />;
  else if (platform === 'lemonde') content = <span className="media-glyph">lemonde</span>;
  else if (platform === 'bfm') content = <b className="media-glyph">BFM</b>;
  else if (platform === 'tech') content = <b className="media-glyph">TECH<br />& CO</b>;
  else if (platform === 'person') content = <Avatar />;
  else content = <Icon name={({ presse:'file', web:'globe', forum:'message', other:'settings', tv:'tv', radio:'mic' } as Record<string, string>)[platform] || 'globe'} size={25} />;
  return <span className={`platform-icon platform-${platform} platform-size-${size}`}>{content}</span>;
}
export function Button({ children, icon, variant = 'outline', className = '', busy, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { icon?: string; variant?: string; busy?: boolean }) {
  return <button className={`button button-${variant} ${className}`} {...props} disabled={props.disabled || busy}>{(busy || icon) && <Icon name={busy ? 'loading' : icon!} size={16} className={busy ? 'spin' : ''} />}{children}</button>;
}
export function IconButton({ name, label, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { name: string; label: string }) {
  return <button className={`icon-button ${className}`} aria-label={label} title={label} {...props}><Icon name={name} /></button>;
}
export function Panel({ title, icon, action, children, className = '', bodyClass = '' }: { title?: ReactNode; icon?: string; action?: ReactNode; children: ReactNode; className?: string; bodyClass?: string }) {
  return <section className={`panel ${className}`}>{title && <div className="panel-header"><h2>{icon && <Icon name={icon} size={15} />}{title}</h2>{action}</div>}<div className={`panel-body ${bodyClass}`}>{children}</div></section>;
}
export function TextLink({ children = 'Voir tout', onClick, className = '' }: { children?: ReactNode; onClick?: () => void; className?: string }) {
  return <button className={`text-link ${className}`} onClick={onClick}>{children}<Icon name="arrow" size={14} /></button>;
}
export const statusLabels: Record<string, string> = { positive:'Positive', negative:'Négative', neutral:'Neutre', unread:'Non lue', in_progress:'En cours', resolved:'Résolue', archived:'Archivée', published:'Publié', scheduled:'Programmé', draft:'Brouillon', connected:'Connectée', inactive:'Déconnectée', partial:'Partiellement', active:'Actif', ready:'Prêt', critical:'Critique', high:'Élevée', medium:'Moyen', low:'Basse', info:'Info', closed:'Clôturée' };
export function Badge({ status = 'active', children, subtle = false, className = '' }: { status?: string; children?: ReactNode; subtle?: boolean; className?: string }) {
  return <span className={`badge badge-${status} ${subtle ? 'badge-subtle' : ''} ${className}`}>{children || statusLabels[status] || status}</span>;
}
export function Toggle({ checked, onChange, label, disabled = false }: { checked: boolean; onChange: () => void; label: string; disabled?: boolean }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`toggle ${checked ? 'on' : ''}`} onClick={onChange} disabled={disabled}><span /></button>;
}
export function Select({ children, className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <span className={`select-wrap ${className}`}><select {...props}>{children}</select><Icon name="down" size={13} /></span>;
}
export function EmptyState({ title = 'Aucun résultat', message = 'Essayez de modifier vos filtres ou ajoutez un nouvel élément.', icon = 'search', action }: { title?: string; message?: string; icon?: string; action?: ReactNode }) {
  return <div className="empty-state"><div><Icon name={icon} size={30} /></div><h3>{title}</h3><p>{message}</p>{action}</div>;
}
export function Pagination({ page, total, perPage, onChange, onPerPage }: { page: number; total: number; perPage: number; onChange: (n: number) => void; onPerPage?: (n: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / perPage));
  return <div className="pagination"><span>Affichage de {total ? (page - 1) * perPage + 1 : 0} à {Math.min(page * perPage, total)} sur {total} éléments</span><div><IconButton name="left" label="Page précédente" disabled={page <= 1} onClick={() => onChange(page - 1)} />{Array.from({ length: Math.min(pages, 5) }, (_, i) => i + 1).map(p => <button key={p} className={page === p ? 'selected' : ''} onClick={() => onChange(p)}>{p}</button>)}{pages > 5 && <><span>…</span><button onClick={() => onChange(pages)} className={page === pages ? 'selected' : ''}>{pages}</button></>}<IconButton name="right" label="Page suivante" disabled={page >= pages} onClick={() => onChange(page + 1)} /></div>{onPerPage && <label>Éléments par page : <Select value={perPage} onChange={e => onPerPage(Number(e.target.value))}><option>5</option><option>10</option><option>20</option></Select></label>}</div>;
}
export function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const el = ref.current;
    const first = el?.querySelector<HTMLElement>('input,select,textarea,button');
    first?.focus();
    const listener = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab' && el) {
        const controls = el.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]');
        const firstControl = controls[0], lastControl = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === firstControl) { event.preventDefault(); lastControl?.focus(); }
        if (!event.shiftKey && document.activeElement === lastControl) { event.preventDefault(); firstControl?.focus(); }
      }
    };
    document.addEventListener('keydown', listener);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', listener); previous?.focus(); };
  }, [onClose, title]);
  return createPortal(<div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><div ref={ref} className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}><div className="modal-header"><div className="modal-mark"><Icon name="shield" size={20} /></div><h2>{title}</h2><IconButton name="close" label="Fermer la fenêtre" onClick={onClose} /></div><div className="modal-body">{children}</div></div></div>, document.body);
}