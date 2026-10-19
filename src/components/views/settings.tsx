'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { useWorkspace } from '../workspace-context';
import { Badge, Button, Icon, Panel, Select, Toggle } from '../ui';

type SettingsTab = 'account' | 'notifications' | 'security' | 'integrations' | 'keywords' | 'subscription' | 'preferences';

export interface LinkedInStatus {
  connected: boolean;
  platform?: 'linkedin';
  accountName?: string;
  accountId?: string;
  action?: 'connect' | 'reconnect' | 'disconnect';
}

interface FacebookPage {
  accountId: string;
  accountName: string;
  active: boolean;
  userToken?: boolean;
}

interface FacebookStatus {
  connected: boolean;
  action?: 'connect' | 'disconnect';
  accounts: FacebookPage[];
}

interface SecuritySession {
  id: string;
  current: boolean;
  name: string;
  expiresAt: string;
}

interface SecurityInfo {
  twoFactorEnabled: boolean;
  demo: boolean;
  sessions: SecuritySession[];
}

/** État d'Ollama renvoyé par l'API d'analyse. */
interface OllamaState {
  ollama?: { available: boolean; models: string[]; model?: string; error?: string };
  pending?: number;
  inactiveKeyword?: number;
}

/** Panneau de configuration de l'analyse sémantique (Ollama). */
function ScorePanel({ busy }: { busy: boolean }) {
  const { data, notify, save } = useWorkspace();
  const preferences = data.settings[0];
  const [state, setState] = useState<OllamaState | null>(null);
  const weights = (preferences?.scoreWeights ?? {}) as Record<string, number>;

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/mentions/score', { cache: 'no-store' });
      if (response.ok) setState((await response.json()) as OllamaState);
    } catch {
      setState(null);
    }
  }, []);

  useEffect(() => {
    // Chargement différé : la vérification d'Ollama ne doit pas bloquer le rendu.
    const timer = window.setTimeout(() => void load(), 150);
    return () => window.clearTimeout(timer);
  }, [load]);

  const updateWeight = async (key: string, value: number) => {
    const settingsRow = data.settings[0];
    try {
      await save('settings', { name: settingsRow?.name || 'Préférences du compte', scoreWeights: { ...weights, [key]: value } }, settingsRow?.id);
      notify(`Pondération « ${key} » réglée sur ${Math.round(value * 100)} %.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Impossible d’enregistrer la pondération.', true);
    }
  };

  const weightLabels: Record<string, string> = {
    sentiment: 'Sentiment',
    gravite: 'Gravité',
    pertinence: 'Pertinence',
    portee: 'Portée / engagement',
    autorite: 'Autorité de la source',
    fraicheur: 'Fraîcheur',
  };
  const defaults: Record<string, number> = { sentiment: 0.3, gravite: 0.2, pertinence: 0.15, portee: 0.2, autorite: 0.1, fraicheur: 0.05 };
  const totalWeight = Object.values(weightLabels).reduce((sum, label, index) => {
    const key = Object.keys(weightLabels)[index];
    return sum + (weights[key] ?? defaults[key]);
  }, 0);

  return (
    <Panel title="Analyse sémantique (Ollama)" icon="brain">
      <div style={rowStyle}>
        <div>
          <strong>État du service</strong>
          <p style={{ margin: '5px 0 0', color: 'var(--muted, #9aa9b5)' }}>
            {!state
              ? 'Vérification de la connexion à Ollama…'
              : state.ollama?.available
                ? `Connecté — modèle actif : ${state.ollama.model ?? 'aucun'}.`
                : `Ollama injoignable : ${state.ollama?.error ?? 'service hors ligne'}. Les mentions reçoivent un score provisoire.`}
          </p>
          <p style={{ margin: '5px 0 0', color: 'var(--muted, #9aa9b5)' }}>
            {typeof state?.pending === 'number'
              ? `${state.pending} mention(s) en attente d’analyse${state.inactiveKeyword ? ` · ${state.inactiveKeyword} hors veille (mot-clé désactivé, recalculables via « Tout recalculer »)` : ''}.`
              : 'Nombre de mentions en attente inconnu.'}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Badge status={state?.ollama?.available ? 'positive' : 'neutral'}>{state?.ollama?.available ? 'Connecté' : 'Hors ligne'}</Badge>
          <Button icon="refresh" busy={busy} onClick={() => void load()}>Vérifier</Button>
        </div>
      </div>
      {state?.ollama?.available && state.ollama.models.length > 0 && (
        <div style={rowStyle}>
          <div>
            <strong>Modèle utilisé</strong>
            <p style={{ margin: '5px 0 0', color: 'var(--muted, #9aa9b5)' }}>
              Modèles détectés sur votre machine : {state.ollama.models.join(', ')}.
            </p>
          </div>
          <Select
            aria-label="Modèle Ollama"
            value={state.ollama.model}
            onChange={async event => {
              try {
                await save('settings', { name: data.settings[0]?.name || 'Préférences du compte', ollamaModel: event.target.value }, data.settings[0]?.id);
                notify(`Modèle Ollama réglé sur ${event.target.value}. Il sera utilisé à la prochaine analyse.`);
                await load();
              } catch (error) {
                notify(error instanceof Error ? error.message : 'Impossible de changer de modèle.', true);
              }
            }}
          >
            {state.ollama.models.map(model => <option key={model} value={model}>{model}</option>)}
          </Select>
        </div>
      )}
      <div style={{ ...rowStyle, borderBottom: 'none', display: 'block' }}>
        <strong>Pondérations du score</strong>
        <p style={{ margin: '5px 0 15px', color: 'var(--muted, #9aa9b5)' }}>
          Total actuel : {Math.round(totalWeight * 100)} % — la somme devrait rester proche de 100 %. Le score mesure l’importance d’une mention pour votre réputation.
        </p>
        {Object.entries(weightLabels).map(([key, label]) => {
          const value = weights[key] ?? defaults[key];
          return (
            <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
              <span style={{ minWidth: '10rem' }}>{label}</span>
              <input
                type="range"
                min={0}
                max={50}
                step={1}
                value={Math.round(value * 100)}
                onChange={event => void updateWeight(key, Number(event.target.value) / 100)}
                aria-label={`Pondération ${label}`}
              />
              <strong style={{ minWidth: '3rem', textAlign: 'right' }}>{Math.round(value * 100)} %</strong>
            </label>
          );
        })}
      </div>
    </Panel>
  );
}

const tabs: { id: SettingsTab; label: string; icon: string }[] = [
  { id: 'account', label: 'Compte', icon: 'user' },
  { id: 'notifications', label: 'Notifications', icon: 'bell' },
  { id: 'security', label: 'Sécurité', icon: 'shield' },
  { id: 'integrations', label: 'Intégrations', icon: 'puzzle' },
  { id: 'keywords', label: 'Mots-clés', icon: 'tag' },
  { id: 'subscription', label: 'Abonnement', icon: 'crown' },
  { id: 'preferences', label: 'Préférences', icon: 'sliders' },
];

const sectionStyle: React.CSSProperties = { display: 'grid', gap: 18 };
const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '14px 0', borderBottom: '1px solid var(--border, #263340)' };
const fieldStyle: React.CSSProperties = { display: 'grid', gap: 7 };
const inputStyle: React.CSSProperties = { width: '100%', minHeight: 42, padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border, #344451)', background: 'var(--surface, #101a22)', color: 'inherit', font: 'inherit' };

export function SettingsView() {
  const { data, user, notify, refresh, navigate, edit, remove, save } = useWorkspace();
  const searchParams = useSearchParams();
  const initialTab = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState<SettingsTab>(tabs.some(tab => tab.id === initialTab) ? initialTab as SettingsTab : 'account');
  const [linkedinStatus, setLinkedinStatus] = useState<LinkedInStatus>({ connected: false, action: 'connect' });
  const [linkedinBusy, setLinkedinBusy] = useState(false);
  const [facebookStatus, setFacebookStatus] = useState<FacebookStatus>({ connected: false, action: 'connect', accounts: [] });
  const [facebookBusy, setFacebookBusy] = useState(false);
  const [security, setSecurity] = useState<SecurityInfo | null>(null);
  const [securityBusy, setSecurityBusy] = useState(false);
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [totpUri, setTotpUri] = useState('');
  const [accountBusy, setAccountBusy] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [searchBusy, setSearchBusy] = useState(false);
  const profile = data.profile[0];
  const preferences = data.settings[0];
  const subscription = data.subscriptions[0];
  const veilleEnabled = {
    facebook: preferences?.veilleFacebook !== false,
    'google-news': preferences?.veilleGoogleNews !== false,
    youtube: preferences?.veilleYoutube !== false,
    reddit: preferences?.veilleReddit !== false,
    rss: preferences?.veilleRss !== false,
  };
  const rssFeeds = data.sources.filter(source => source.platform === 'rss');
  const sourceStatusLine = (sourceId: string) => {
    const last = preferences?.[`veilleLastAt_${sourceId}`];
    const status = preferences?.[`veilleError_${sourceId}`];
    const label = typeof last === 'string' && last
      ? `Dernière collecte : ${new Date(last).toLocaleString('fr-FR')}`
      : 'Aucune collecte effectuée pour le moment.';
    if (typeof status === 'string' && status) {
      return last ? `${label} — ${status}` : status;
    }
    return label;
  };
  const [accountEdits, setAccountEdits] = useState<Partial<{ name: string; email: string; phone: string; city: string }>>({});
  const account = { name: accountEdits.name ?? profile?.name ?? user.name, email: accountEdits.email ?? profile?.email ?? user.email, phone: accountEdits.phone ?? profile?.phone ?? '', city: accountEdits.city ?? profile?.city ?? '' };

  const loadLinkedinStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/integrations/linkedin?action=status', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Impossible de vérifier la connexion LinkedIn.');
      setLinkedinStatus(result as LinkedInStatus);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Impossible de vérifier la connexion LinkedIn.', true);
    }
  }, [notify]);

  const loadFacebookStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/integrations/facebook?action=status', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Impossible de vérifier la connexion Facebook.');
      setFacebookStatus(result as FacebookStatus);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Impossible de vérifier la connexion Facebook.', true);
    }
  }, [notify]);

  const loadSecurity = useCallback(async () => {
    try {
      const response = await fetch('/api/security', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Impossible de charger les informations de sécurité.');
      setSecurity(result as SecurityInfo);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Impossible de charger les informations de sécurité.', true);
    }
  }, [notify]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadLinkedinStatus();
      void loadFacebookStatus();
      void loadSecurity();
      const success = searchParams.get('success');
      const error = searchParams.get('error');
      if (success === 'linkedin_connected') notify('Votre compte LinkedIn est connecté.');
      if (success === 'facebook_connected') notify('Votre Page Facebook est connectée.');
      if (error?.startsWith('facebook_')) {
        const message = error === 'facebook_no_pages'
          ? 'Aucune Page Facebook administrée n’a été trouvée pour ce compte.'
          : error === 'facebook_permission_missing'
            ? 'Meta n’a pas accordé pages_read_engagement : la Page n’a pas été connectée. Activez l’accès à cette permission dans Meta for Developers > App Review > Permissions and Features, puis recommencez.'
            : error === 'facebook_permissions_check_failed'
              ? 'Meta n’a pas permis de vérifier les autorisations. Réessayez la connexion Facebook.'
              : 'La connexion Facebook a échoué. Vérifiez la configuration de l’application Meta et réessayez.';
        notify(message, true);
      } else if (error) notify('La connexion LinkedIn a échoué. Veuillez réessayer.', true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadFacebookStatus, loadLinkedinStatus, loadSecurity, notify, searchParams]);

  async function linkedinConnect() {
    setLinkedinBusy(true);
    try {
      const response = await fetch('/api/integrations/linkedin?action=connect', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok || typeof result.authUrl !== 'string') throw new Error(result.error || 'Impossible de démarrer la connexion LinkedIn.');
      window.location.assign(result.authUrl);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Impossible de démarrer la connexion LinkedIn.', true);
      setLinkedinBusy(false);
    }
  }

  async function linkedinDisconnect() {
    setLinkedinBusy(true);
    try {
      const response = await fetch('/api/integrations/linkedin?action=disconnect', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Impossible de déconnecter LinkedIn.');
      setLinkedinStatus({ connected: false, action: 'connect' });
      notify(result.message || 'Compte LinkedIn déconnecté.');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Impossible de déconnecter LinkedIn.', true);
    } finally {
      setLinkedinBusy(false);
    }
  }

  async function facebookConnect() {
    setFacebookBusy(true);
    try {
      const response = await fetch('/api/integrations/facebook?action=connect', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok || typeof result.authUrl !== 'string') {
        throw new Error(result.error || 'Impossible de démarrer la connexion Facebook.');
      }
      window.location.assign(result.authUrl);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Impossible de démarrer la connexion Facebook.', true);
      setFacebookBusy(false);
    }
  }

  async function facebookDisconnect() {
    setFacebookBusy(true);
    try {
      const response = await fetch('/api/integrations/facebook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'disconnect' }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Impossible de déconnecter Facebook.');
      await loadFacebookStatus();
      notify(result.message || 'Compte Facebook déconnecté.');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Impossible de déconnecter Facebook.', true);
    } finally {
      setFacebookBusy(false);
    }
  }

  async function facebookSelectPage(pageId: string) {
    setFacebookBusy(true);
    try {
      const response = await fetch('/api/integrations/facebook?action=select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'select', pageId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Impossible de sélectionner cette Page Facebook.');
      await loadFacebookStatus();
      notify('La Page Facebook à utiliser a été mise à jour.');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Impossible de sélectionner cette Page Facebook.', true);
    } finally {
      setFacebookBusy(false);
    }
  }

  async function saveAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAccountBusy(true);
    try {
      const response = await fetch('/api/account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(account),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Impossible d’enregistrer le compte.');
      await refresh();
      notify('Les informations du compte ont été enregistrées.');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Impossible d’enregistrer le compte.', true);
    } finally {
      setAccountBusy(false);
    }
  }

  async function saveSettings(values: Record<string, string | boolean>, message = 'Vos préférences ont été enregistrées.') {
    setSettingsBusy(true);
    try {
      const response = await fetch('/api/account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Impossible d’enregistrer les préférences.');
      await refresh();
      notify(message);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Impossible d’enregistrer les préférences.', true);
    } finally {
      setSettingsBusy(false);
    }
  }

  async function toggleVeille(field: 'veilleFacebook' | 'veilleGoogleNews' | 'veilleYoutube' | 'veilleReddit' | 'veilleRss', label: string) {
    const nextValue = preferences?.[field] === false;
    const settingsRow = data.settings[0];
    setSearchBusy(true);
    try {
      // L'id force la branche PATCH (fusion) : sans id, handleResource créerait
      // une seconde ligne settings (rejetée par la validation name/term).
      await save('settings', { name: settingsRow?.name || 'Préférences du compte', [field]: nextValue }, settingsRow?.id);
      notify(`${label} ${nextValue ? 'activé(e)' : 'désactivé(e)'} : la collecte par mots-clés se relancera automatiquement toutes les 15 minutes.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Impossible de mettre à jour la source de veille.', true);
    } finally {
      setSearchBusy(false);
    }
  }

  async function saveVeilleOption(field: 'veilleNewsLang' | 'veilleNewsCountry', value: string) {
    const settingsRow = data.settings[0];
    try {
      await save('settings', { name: settingsRow?.name || 'Préférences du compte', [field]: value }, settingsRow?.id);
      notify('Réglage enregistré. La prochaine collecte utilisera cette valeur.');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Impossible d’enregistrer ce réglage.', true);
    }
  }

interface VeilleScanResult {
  added?: number;
  checked?: number;
  keywords?: number;
  reason?: string;
  error?: string;
  warnings?: string[];
  sources?: { label: string; added: number }[];
}

async function launchVeille() {
  setSearchBusy(true);
  try {
    const response = await fetch('/api/mentions/scan', { method: 'POST' });
    const result = (await response.json()) as VeilleScanResult;
    if (!response.ok) throw new Error(result.error || 'La recherche multi-sources a échoué.');
    await refresh();
    if (result.reason === 'no_keywords') {
      notify('Ajoutez au moins un mot-clé actif dans l’onglet Mots-clés pour lancer la collecte.', true);
    } else if (result.added && result.added > 0) {
      const sources = (result.sources || []).filter(s => s.added > 0).map(s => s.label).join(', ');
      notify(`${result.added} nouvelle(s) mention(s) enregistrée(s) à partir de ${result.keywords ?? 0} mot(s)-clé(s)${sources ? ` via ${sources}` : ''}.`);
    } else if (result.warnings?.length) {
      notify(`Aucune nouvelle mention. ${result.checked ?? 0} contenu(s) analysé(s). ${result.warnings[0]}`, true);
    } else {
      notify(`Aucune nouvelle mention. ${result.checked ?? 0} contenu(s) analysé(s) sur toutes les sources activées.`);
    }
  } catch (error) {
    notify(error instanceof Error ? error.message : 'La recherche multi-sources a échoué.', true);
  } finally {
    setSearchBusy(false);
  }
}

  async function securityAction(action: 'setup' | 'enable' | 'disable' | 'revoke', id?: string) {
    setSecurityBusy(true);
    try {
      const response = await fetch('/api/security', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, code: twoFactorCode, id }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Impossible de mettre à jour la sécurité.');
      if (action === 'setup') {
        setTotpUri(result.uri || '');
        setTwoFactorCode('');
      } else {
        setTotpUri('');
        setTwoFactorCode('');
        await loadSecurity();
        notify(action === 'revoke' ? 'La session a été révoquée.' : 'Les paramètres de sécurité ont été mis à jour.');
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Impossible de mettre à jour la sécurité.', true);
    } finally {
      setSecurityBusy(false);
    }
  }

  const linkedinCard = <Panel title="LinkedIn" icon="linkedin" className="settings-linkedin-card">
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
      <span className="platform-icon platform-linkedin platform-size-large"><b className="linkedin-glyph">in</b></span>
      <div style={{ flex: '1 1 220px' }}>
        <strong>Publiez sur votre profil LinkedIn</strong>
        <p style={{ margin: '6px 0 0', color: 'var(--muted, #9aa9b5)' }}>
          {linkedinStatus.connected
            ? `Compte connecté${linkedinStatus.accountName ? ` : ${linkedinStatus.accountName}` : ''}. Vous pouvez partager vos contenus.`
            : 'Connectez votre compte pour préparer et publier vos contenus.'}
        </p>
      </div>
      <Badge status={linkedinStatus.connected ? 'connected' : 'inactive'}>{linkedinStatus.connected ? 'Connecté' : 'Non connecté'}</Badge>
      {linkedinStatus.connected
        ? <Button onClick={() => void linkedinDisconnect()} busy={linkedinBusy}>Déconnecter</Button>
        : <Button variant="primary" icon="linkedin" onClick={() => void linkedinConnect()} busy={linkedinBusy}>{linkedinStatus.action === 'reconnect' ? 'Reconnecter' : 'Connecter LinkedIn'}</Button>}
    </div>
  </Panel>;

  const activeFacebookPage = facebookStatus.accounts.find(page => page.active);
  const facebookCard = <Panel title="Facebook" icon="facebook" className="settings-facebook-card">
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
      <span className="platform-icon platform-facebook platform-size-large"><b className="facebook-glyph">f</b></span>
      <div style={{ flex: '1 1 220px' }}>
        <strong>Connectez une Page Facebook</strong>
        <p style={{ margin: '6px 0 0', color: 'var(--muted, #9aa9b5)' }}>
          {activeFacebookPage
            ? `Page connectée : ${activeFacebookPage.accountName}.`
            : 'Autorisez l’accès à vos Pages Facebook pour les connecter à Ghostroar.'}
        </p>
      </div>
      <Badge status={facebookStatus.connected ? 'connected' : 'inactive'}>{facebookStatus.connected ? 'Connecté' : 'Non connecté'}</Badge>
      {facebookStatus.accounts.length > 1 && <Select
        aria-label="Page Facebook à utiliser"
        value={activeFacebookPage?.accountId || ''}
        disabled={facebookBusy}
        onChange={event => void facebookSelectPage(event.target.value)}
      >
        {facebookStatus.accounts.map(page => <option key={page.accountId} value={page.accountId}>{page.accountName}</option>)}
      </Select>}
      {facebookStatus.connected ? <Button onClick={() => void facebookDisconnect()} busy={facebookBusy}>Déconnecter</Button>
        : <Button variant="primary" icon="facebook" onClick={() => void facebookConnect()} busy={facebookBusy}>Connecter Facebook</Button>}
    </div>
    {facebookStatus.connected && <p style={{ margin: '12px 0 0', color: 'var(--muted, #9aa9b5)' }}>
      La recherche publique sur Facebook n’est pas disponible. Seules les publications, commentaires et mentions de votre Page sont analysés. Les autres sources web complètent la veille par mots-clés.
    </p>}
  </Panel>;

  const notificationItems = useMemo(() => [
    { key: 'emailAlerts', label: 'Alertes par email', description: 'Recevoir un email lorsqu’une mention importante est détectée.' },
    { key: 'pushAlerts', label: 'Notifications dans l’application', description: 'Afficher les alertes urgentes dans votre espace.' },
    { key: 'digest', label: 'Résumé quotidien', description: 'Recevoir une synthèse quotidienne de votre veille.' },
    { key: 'weeklyReport', label: 'Rapport hebdomadaire', description: 'Recevoir un récapitulatif chaque semaine.' },
    { key: 'criticalOnly', label: 'Alertes critiques uniquement', description: 'Limiter les notifications aux situations prioritaires.' },
  ] as const, []);

  function preferenceToggle(key: 'emailAlerts' | 'pushAlerts' | 'digest' | 'weeklyReport' | 'criticalOnly' | 'sensitiveData', label: string) {
    return <Toggle checked={Boolean(preferences?.[key])} label={label} disabled={settingsBusy} onChange={() => void saveSettings({ [key]: !preferences?.[key] })} />;
  }

  function labeledField(label: string, control: ReactNode) {
    return <label style={fieldStyle}><span>{label}</span>{control}</label>;
  }

  return <div className="settings-page">
    <div className="breadcrumb"><button onClick={() => navigate('dashboard')}>Accueil</button><Icon name="right" size={12} /><span>Paramètres</span></div>
    <h1>Paramètres</h1>
    <p className="settings-intro">Gérez votre compte, vos notifications et les services connectés.</p>
    <div className="settings-layout" style={{ display: 'grid', gridTemplateColumns: 'minmax(190px, 240px) minmax(0, 1fr)', gap: 24, alignItems: 'start' }}>
      <nav className="settings-tabs" aria-label="Sections des paramètres" style={{ display: 'grid', gap: 6 }}>
        {tabs.map(tab => <button key={tab.id} type="button" className={`settings-tab ${activeTab === tab.id ? 'active' : ''}`} aria-current={activeTab === tab.id ? 'page' : undefined} onClick={() => setActiveTab(tab.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', padding: '11px 13px', border: 0, borderRadius: 8, background: activeTab === tab.id ? 'var(--surface-raised, #1c2a33)' : 'transparent', color: 'inherit', cursor: 'pointer', font: 'inherit' }}><Icon name={tab.icon} size={17} />{tab.label}</button>)}
      </nav>

      <div className="settings-content" style={sectionStyle}>
        {activeTab === 'account' && <Panel title="Informations du compte" icon="user">
          <form onSubmit={event => void saveAccount(event)} style={sectionStyle}>
            <div className="settings-form-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
              {labeledField('Nom complet', <input autoComplete="name" style={inputStyle} value={account.name} onChange={event => setAccountEdits({ ...accountEdits, name: event.target.value })} required minLength={2} />)}
              {labeledField('Adresse email', <input type="email" autoComplete="email" style={inputStyle} value={account.email} onChange={event => setAccountEdits({ ...accountEdits, email: event.target.value })} required />)}
              {labeledField('Téléphone', <input type="tel" autoComplete="tel" style={inputStyle} value={account.phone} onChange={event => setAccountEdits({ ...accountEdits, phone: event.target.value })} />)}
              {labeledField('Ville', <input autoComplete="address-level2" style={inputStyle} value={account.city} onChange={event => setAccountEdits({ ...accountEdits, city: event.target.value })} />)}
            </div>
            <div><Button type="submit" variant="primary" icon="save" busy={accountBusy}>Enregistrer les modifications</Button></div>
          </form>
        </Panel>}

        {activeTab === 'notifications' && <Panel title="Préférences de notification" icon="bell">
          {notificationItems.map(item => <div key={item.key} style={rowStyle}><div><strong>{item.label}</strong><p style={{ margin: '5px 0 0', color: 'var(--muted, #9aa9b5)' }}>{item.description}</p></div>{preferenceToggle(item.key, item.label)}</div>)}
        </Panel>}

        {activeTab === 'security' && <div style={sectionStyle}>
          <Panel title="Authentification à deux facteurs" icon="shield">
            <div style={{ ...rowStyle, borderBottom: 'none' }}><div><strong>{security?.twoFactorEnabled ? 'La double authentification est active' : 'Renforcez la sécurité de votre compte'}</strong><p style={{ margin: '5px 0 0', color: 'var(--muted, #9aa9b5)' }}>Utilisez une application d’authentification pour protéger votre connexion.</p></div><Badge status={security?.twoFactorEnabled ? 'connected' : 'inactive'}>{security?.twoFactorEnabled ? 'Activée' : 'Désactivée'}</Badge></div>
            {totpUri && <div style={{ display: 'grid', gap: 12, paddingTop: 12 }}><p>Ajoutez cette adresse à votre application d’authentification, puis saisissez le code à six chiffres.</p><code style={{ overflowWrap: 'anywhere' }}>{totpUri}</code><div style={{ maxWidth: 280 }}>{labeledField('Code de vérification', <input inputMode="numeric" autoComplete="one-time-code" style={inputStyle} value={twoFactorCode} onChange={event => setTwoFactorCode(event.target.value)} maxLength={8} />)}</div><Button variant="primary" busy={securityBusy} onClick={() => void securityAction('enable')}>Activer la double authentification</Button></div>}
            {!totpUri && <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', paddingTop: 10 }}>{security?.twoFactorEnabled
              ? <><input aria-label="Code de vérification" inputMode="numeric" autoComplete="one-time-code" placeholder="Code à 6 chiffres" style={{ ...inputStyle, maxWidth: 220 }} value={twoFactorCode} onChange={event => setTwoFactorCode(event.target.value)} maxLength={8} /><Button onClick={() => void securityAction('disable')} busy={securityBusy}>Désactiver la 2FA</Button></>
              : <Button variant="primary" icon="lock" onClick={() => void securityAction('setup')} busy={securityBusy} disabled={!security}>Configurer la 2FA</Button>}</div>}
          </Panel>
          <Panel title="Sessions actives" icon="monitor">
            {security?.sessions.length ? security.sessions.map(session => <div key={session.id} style={rowStyle}><div><strong>{session.name}</strong>{session.current && <Badge status="active" subtle className="settings-current-session">Session actuelle</Badge>}<p style={{ margin: '5px 0 0', color: 'var(--muted, #9aa9b5)' }}>Expire le {new Date(session.expiresAt).toLocaleDateString('fr-FR')}</p></div>{!session.current && <Button onClick={() => void securityAction('revoke', session.id)} busy={securityBusy}>Révoquer</Button>}</div>) : <p>Aucune session active supplémentaire.</p>}
          </Panel>
        </div>}

        {activeTab === 'integrations' && <div style={sectionStyle}>{linkedinCard}{facebookCard}<Panel title="Autres intégrations" icon="puzzle"><p style={{ margin: 0, color: 'var(--muted, #9aa9b5)' }}>De nouvelles plateformes seront disponibles prochainement.</p></Panel></div>}
        {activeTab === 'keywords' && <div style={sectionStyle}>
          <Panel title="Sources de veille" icon="radar" action={<Button variant="primary" icon="play" busy={searchBusy} onClick={() => void launchVeille()}>Lancer la recherche maintenant</Button>}>
            <div style={rowStyle}>
              <div>
                <strong>Facebook — Page connectée</strong>
                <p style={{ margin: '5px 0 0', color: 'var(--muted, #9aa9b5)' }}>
                  Publications, commentaires et publications taguées de votre Page. La recherche publique sur les autres Pages Facebook n’est pas disponible (limite Meta) ; les autres sources complètent la veille.
                </p>
                <p style={{ margin: '5px 0 0', color: 'var(--muted, #9aa9b5)' }}>{sourceStatusLine('facebook')}</p>
              </div>
              <Toggle checked={veilleEnabled.facebook} label="Facebook" disabled={searchBusy} onChange={() => void toggleVeille('veilleFacebook', 'La source Facebook')} />
            </div>
            <div style={rowStyle}>
              <div style={{ flex: '1 1 260px' }}>
                <strong>Google News</strong>
                <p style={{ margin: '5px 0 0', color: 'var(--muted, #9aa9b5)' }}>
                  Articles de presse correspondant à vos mots-clés. Aucune clé API requise.
                </p>
                <p style={{ margin: '5px 0 0', color: 'var(--muted, #9aa9b5)' }}>{sourceStatusLine('google-news')}</p>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
                {labeledField('Langue', <Select value={String(preferences?.veilleNewsLang || 'fr')} onChange={event => void saveVeilleOption('veilleNewsLang', event.target.value)}><option value="fr">Français</option><option value="en">English</option></Select>)}
                {labeledField('Pays', <Select value={String(preferences?.veilleNewsCountry || 'CM')} onChange={event => void saveVeilleOption('veilleNewsCountry', event.target.value)}><option value="CM">Cameroun</option><option value="FR">France</option><option value="BE">Belgique</option><option value="CA">Canada</option><option value="SN">Sénégal</option><option value="CI">Côte d’Ivoire</option><option value="US">États-Unis</option></Select>)}
                <Toggle checked={veilleEnabled['google-news']} label="Google News" disabled={searchBusy} onChange={() => void toggleVeille('veilleGoogleNews', 'La source Google News')} />
              </div>
            </div>
            <div style={rowStyle}>
              <div>
                <strong>YouTube</strong>
                <p style={{ margin: '5px 0 0', color: 'var(--muted, #9aa9b5)' }}>
                  Vidéos correspondant à vos mots-clés (API YouTube : quota limité, une collecte par heure).
                </p>
                <p style={{ margin: '5px 0 0', color: 'var(--muted, #9aa9b5)' }}>{sourceStatusLine('youtube')}</p>
              </div>
              <Toggle checked={veilleEnabled.youtube} label="YouTube" disabled={searchBusy} onChange={() => void toggleVeille('veilleYoutube', 'La source YouTube')} />
            </div>
            <div style={rowStyle}>
              <div>
                <strong>Flux RSS personnalisés</strong>
                <p style={{ margin: '5px 0 0', color: 'var(--muted, #9aa9b5)' }}>
                  Sites de presse, blogs et concurrents que vous surveillez manuellement.
                </p>
                {rssFeeds.length
                  ? <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>{rssFeeds.map(feed => <div key={feed.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}><strong style={{ fontWeight: 500 }}>{feed.name}</strong><span style={{ color: 'var(--muted, #9aa9b5)', fontSize: 12 }}>{feed.url}</span><Button onClick={() => edit('sources', feed)}>Modifier</Button><Button onClick={() => void remove(feed)}>Supprimer</Button></div>)}</div>
                  : <p style={{ margin: '5px 0 0', color: 'var(--muted, #9aa9b5)' }}>Aucun flux enregistré.</p>}
                <p style={{ margin: '8px 0 0', color: 'var(--muted, #9aa9b5)' }}>{sourceStatusLine('rss')}</p>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
                <Button variant="primary" icon="plus" onClick={() => edit('sources', undefined, { name: 'Nouveau flux RSS', platform: 'rss', url: 'https://', category: 'web', status: 'connected', active: true })}>Ajouter un flux RSS</Button>
                <Toggle checked={veilleEnabled.rss} label="Flux RSS" disabled={searchBusy} onChange={() => void toggleVeille('veilleRss', 'Les flux RSS')} />
              </div>
            </div>
            <div style={{ ...rowStyle, borderBottom: 'none' }}>
              <div>
                <strong>Reddit</strong>
                <p style={{ margin: '5px 0 0', color: 'var(--muted, #9aa9b5)' }}>
                  Discussions publiques mentionnant vos mots-clés. Désactivée par défaut : nécessite les identifiants API Reddit (REDDIT_CLIENT_ID et REDDIT_CLIENT_SECRET) dans le fichier .env.
                </p>
                <p style={{ margin: '5px 0 0', color: 'var(--muted, #9aa9b5)' }}>{sourceStatusLine('reddit')}</p>
              </div>
              <Toggle checked={veilleEnabled.reddit} label="Reddit" disabled={searchBusy} onChange={() => void toggleVeille('veilleReddit', 'La source Reddit')} />
            </div>
          </Panel>
          <Panel title="Mots-clés surveillés" icon="tag" action={<Button variant="primary" icon="plus" onClick={() => edit('keywords')}>Ajouter un mot-clé</Button>}>
            {data.keywords.length ? data.keywords.map(keyword => <div key={keyword.id} style={rowStyle}><div><strong>{keyword.term || keyword.name}</strong><p style={{ margin: '5px 0 0', color: 'var(--muted, #9aa9b5)' }}>{(keyword.platforms || []).join(' · ') || 'Toutes les plateformes'}</p></div><div style={{ display: 'flex', gap: 8 }}><Button onClick={() => edit('keywords', keyword)}>Modifier</Button><Button onClick={() => void remove(keyword)}>Supprimer</Button></div></div>) : <p>Aucun mot-clé n’est encore surveillé.</p>}
          </Panel>
          <ScorePanel busy={searchBusy} />
        </div>}
        {activeTab === 'subscription' && <Panel title="Votre abonnement" icon="crown">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', paddingBottom: 16 }}><h2 style={{ margin: 0, textTransform: 'capitalize' }}>{String(subscription?.plan || subscription?.name || 'Pro')}</h2><Badge status={subscription?.status || 'active'}>{subscription?.status === 'active' ? 'Actif' : String(subscription?.status || 'Actif')}</Badge></div>
          <div style={sectionStyle}><div style={rowStyle}><span>Tarif mensuel</span><strong>{Number(subscription?.price || 250000).toLocaleString('fr-FR')} {String(subscription?.currency || 'FCFA')} / mois</strong></div><div style={rowStyle}><span>Prochaine facturation</span><strong>{subscription?.billingDate ? new Date(String(subscription.billingDate)).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : 'À confirmer'}</strong></div></div>
          <div style={{ paddingTop: 18 }}><Button variant="primary" icon="arrow" onClick={() => navigate('premium')}>Voir les offres et changer de plan</Button></div>
        </Panel>}

        {activeTab === 'preferences' && <Panel title="Préférences générales" icon="sliders">
          <div style={sectionStyle}>
            <div style={rowStyle}><div><strong>Données sensibles</strong><p style={{ margin: '5px 0 0', color: 'var(--muted, #9aa9b5)' }}>Autoriser la collecte de données publiquement accessibles concernant votre activité.</p></div>{preferenceToggle('sensitiveData', 'Données sensibles')}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
              {labeledField('Langue', <Select value={String(preferences?.languages || 'Français')} onChange={event => void saveSettings({ languages: event.target.value })}><option>Français</option><option>English</option></Select>)}
              {labeledField('Fuseau horaire', <Select value={String(preferences?.timezone || 'Africa/Douala')} onChange={event => void saveSettings({ timezone: event.target.value })}><option value="Africa/Douala">Afrique/Douala</option><option value="Europe/Paris">Europe/Paris</option><option value="UTC">UTC</option></Select>)}
              {labeledField('Format de date', <Select value={String(preferences?.dateFormat || 'DD/MM/YYYY')} onChange={event => void saveSettings({ dateFormat: event.target.value })}><option>DD/MM/YYYY</option><option>MM/DD/YYYY</option><option>YYYY-MM-DD</option></Select>)}
              {labeledField('Thème', <Select value={String(preferences?.theme || 'dark')} onChange={event => void saveSettings({ theme: event.target.value })}><option value="dark">Sombre</option><option value="light">Clair</option><option value="system">Système</option></Select>)}
            </div>
            <p style={{ margin: 0, color: 'var(--muted, #9aa9b5)' }}>{settingsBusy ? 'Enregistrement en cours…' : 'Les modifications sont enregistrées automatiquement.'}</p>
          </div>
        </Panel>}
      </div>
    </div>
  </div>;
}
