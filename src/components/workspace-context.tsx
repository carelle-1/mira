'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { demoData } from '@/lib/demo-data';
import type { AppUser, Entity, ResourceType, WorkspaceData } from '@/lib/types';

export interface ModalState { kind: 'editor' | 'detail' | 'delete' | 'support' | 'plans' | 'recommendations' | 'calendar' | 'password' | 'history' | 'communication' | 'team'; entity?: Entity; resource?: ResourceType; defaults?: Partial<Entity>; title?: string; }
interface WorkspaceContextValue {
  data: WorkspaceData; user: AppUser; loading: boolean; syncing: boolean; analyzing: boolean; modal: ModalState | null;
  notice: { message: string; error: boolean } | null;
  refresh: () => Promise<void>; notify: (message: string, error?: boolean) => void; clearNotice: () => void;
  save: (type: ResourceType, values: Partial<Entity>, id?: string) => Promise<Entity | null>;
  remove: (entity: Entity) => Promise<boolean>;
  openModal: (state: ModalState) => void; closeModal: () => void;
  edit: (type: ResourceType, entity?: Entity, defaults?: Partial<Entity>) => void;
  detail: (entity: Entity) => void; navigate: (section: string) => void;
  analyze: () => Promise<void>; generateReport: (name?: string) => Promise<void>;
  exportData: (type: ResourceType) => Promise<void>; downloadReport: (entity: Entity) => void;
}
const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const isAuth = pathname === '/connexion';
  const [data, setData] = useState<WorkspaceData>(demoData);
  const [user, setUser] = useState<AppUser>({ id: '', name: 'Arnaud Kenne', email: 'demo@ghostroar.app', demo: true });
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [modal, setModal] = useState<ModalState | null>(null);
  const [notice, setNotice] = useState<{ message: string; error: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ready = useRef<Promise<void> | null>(null);
  const notify = useCallback((message: string, error = false) => {
    setNotice({ message, error });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setNotice(null), 5000);
  }, []);
  const refresh = useCallback(async () => {
    setSyncing(true);
    try {
      const response = await fetch('/api/workspace', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setData(result.data); setUser(result.user);
    } catch (error) { notify(error instanceof Error ? error.message : 'Impossible de charger les données.', true); }
    finally { setLoading(false); setSyncing(false); }
  }, [notify]);
  useEffect(() => {
    if (isAuth) return;
    ready.current = (async () => {
      try {
        const response = await fetch('/api/auth/demo', { method: 'POST' });
        if (!response.ok) throw new Error('La connexion au serveur a échoué.');
        await refresh();
      } catch (error) { setLoading(false); notify(error instanceof Error ? error.message : 'Connexion indisponible.', true); }
    })();
  }, [isAuth, refresh, notify]);
  const closeModal = useCallback(() => setModal(null), []);
  const navigate = useCallback((section: string) => { setModal(null); router.push(section === 'dashboard' ? '/' : `/${section}`); }, [router]);
  async function save(type: ResourceType, values: Partial<Entity>, id?: string): Promise<Entity | null> {
    await ready.current;
    const isNew = !id || id === 'new';
    const previous = data[type];
    const tempId = isNew ? `pending-${crypto.randomUUID()}` : id;
    const optimistic = { ...previous.find(item => item.id === id), ...values, id: tempId, type, name: values.name || values.term || previous.find(item => item.id === id)?.name || '' } as Entity;
    setData(current => ({ ...current, [type]: isNew ? [...current[type], optimistic] : current[type].map(item => item.id === id ? optimistic : item) }));
    try {
      const response = await fetch(`/api/resources/${type}${isNew ? '' : `/${id}`}`, { method: isNew ? 'POST' : 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
      const entity = await response.json();
      if (!response.ok) throw new Error(entity.error);
      setData(current => ({ ...current, [type]: current[type].map(item => item.id === tempId ? entity : item) }));
      return entity;
} catch (error) {
      setData(current => ({ ...current, [type]: isNew ? current[type].filter(item => item.id !== tempId) : current[type].map(item => item.id === id ? previous.find(old => old.id === id) || item : item) }));
      notify(error instanceof Error ? error.message : "L'enregistrement a echoue.", true);
      return null;
    }
  }
  async function remove(entity: Entity) {
    const previous = data[entity.type];
    setData(current => ({ ...current, [entity.type]: current[entity.type].filter(item => item.id !== entity.id) }));
    try {
      const response = await fetch(`/api/resources/${entity.type}/${entity.id}`, { method: 'DELETE' });
      if (!response.ok) { const result = await response.json(); throw new Error(result.error); }
      notify('L’élément a été supprimé.');
      return true;
    } catch (error) {
      setData(current => ({ ...current, [entity.type]: previous }));
      notify(error instanceof Error ? error.message : 'La suppression a échoué.', true);
      return false;
    }
  }
  async function analyze() {
    if (analyzing) return;
    setAnalyzing(true);
    await ready.current;
    try {
      const response = await fetch('/api/actions/analyze', { method: 'POST' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setData(current => ({ ...current, reports: [...current.reports, result.report] }));
      setModal({ kind: 'detail', entity: result.report });
      notify('Analyse terminée. Votre rapport a été enregistré.');
    } catch (error) { notify(error instanceof Error ? error.message : 'L’analyse a échoué.', true); }
    finally { setAnalyzing(false); }
  }
  async function generateReport(name = 'Rapport global de réputation') {
    const report = await save('reports', { name: `${name} – ${new Date().toLocaleDateString('fr-FR')}`, category: 'Réputation', status: 'ready', date: new Date().toISOString(), score: 78, description: `SYNTHÈSE DE RÉPUTATION\n\nPersonnalité : ${data.profile[0]?.name || user.name}\nScore global : 78/100 (+6,3 %)\nMentions totales : ${2487 + data.mentions.length - demoData.mentions.length}\nSentiment positif : 70,1 %\nSources actives : ${data.sources.filter(s => s.active).length}\nAlertes à traiter : ${data.alerts.filter(a => a.status !== 'resolved' && a.status !== 'archived').length}\n\nPOINTS CLÉS\nLa visibilité et la crédibilité progressent. L’innovation technologique et la formation sont les principaux moteurs de la perception positive.\n\nRECOMMANDATIONS\n• Valoriser les témoignages clients.\n• Répondre aux alertes critiques.\n• Renforcer la présence sur les réseaux éducatifs.\n\nRapport généré à partir des données de votre espace GHOSTROAR.` });
    if (report) { setModal({ kind: 'detail', entity: report }); notify('Votre rapport est prêt.'); }
  }
  async function exportData(type: ResourceType) {
    await ready.current;
    try {
      const response = await fetch(`/api/export?type=${type}`);
      if (!response.ok) throw new Error('Impossible d’exporter les données.');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `ghostroar-${type}.csv`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify('L’export CSV a été téléchargé.');
    } catch (error) { notify(error instanceof Error ? error.message : 'L’export a échoué.', true); }
  }
  function downloadReport(entity: Entity) {
    const blob = new Blob([`GHOSTROAR REPUTATION\n${entity.name}\n${'═'.repeat(46)}\n\n${entity.description || ''}\n\nDate : ${new Date(entity.date || Date.now()).toLocaleDateString('fr-FR')}\nDocument confidentiel — GHOSTROAR REPUTATION`], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `ghostroar-rapport-${entity.id.slice(0, 8)}.txt`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify('Le rapport a été téléchargé.');
  }
  return <WorkspaceContext.Provider value={{ data, user, loading, syncing, analyzing, modal, notice, refresh, notify, clearNotice: () => setNotice(null), save, remove, openModal: setModal, closeModal, edit: (resource, entity, defaults) => setModal({ kind: 'editor', resource, entity, defaults }), detail: entity => setModal({ kind: 'detail', entity }), navigate, analyze, generateReport, exportData, downloadReport }}>{children}</WorkspaceContext.Provider>;
}
export function useWorkspace() { const context = useContext(WorkspaceContext); if (!context) throw new Error('WorkspaceProvider is required'); return context; }
