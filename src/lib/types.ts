export const resourceTypes = ['sources', 'mentions', 'alerts', 'publications', 'contacts', 'reports', 'rules', 'crises', 'profile', 'settings', 'appointments', 'campaigns', 'threats', 'monitors', 'subscriptions', 'keywords'] as const;
export type ResourceType = typeof resourceTypes[number];
export interface Entity {
  id: string;
  type: ResourceType;
  name: string;
  description?: string;
  status?: string;
  platform?: string;
  category?: string;
  sentiment?: string;
  score?: number;
  count?: number;
  growth?: number;
  author?: string;
  date?: string;
  time?: string;
  url?: string;
  email?: string;
  phone?: string;
  role?: string;
  company?: string;
  country?: string;
  city?: string;
  languages?: string;
  domain?: string;
  severity?: string;
  assignee?: string;
  views?: string;
  likes?: number;
  comments?: number;
  image?: string;
  notes?: string;
  progress?: number;
  metrics?: { views?: number; comments?: number; likes?: number; shares?: number };
  metricsUpdatedAt?: string;
  /** Motif du dernier échec de publication. */
  publishError?: string;
  // Score de réputation (analyse Ollama + calcul déterministe)
  scoreLevel?: 'faible' | 'moyen' | 'eleve';
  scoreStatus?: 'en_attente' | 'provisoire' | 'final' | 'echec';
  scoreBreakdown?: {
    components: { key: string; label: string; value: number; weight: number; contribution: number; detail?: string }[];
    weights: Record<string, number>;
    provisional: boolean;
    capApplied?: string;
  };
  sentimentAnalyse?: string;
  sentimentScore?: number;
  pertinence?: number;
  gravite?: number;
  themes?: string[];
  scoreReason?: string;
  scoredAt?: string;
  scoreModel?: string;
  scoreTextHash?: string;
  ollamaModel?: string;
  scoreWeights?: Record<string, number>;
  active?: boolean;
  emailAlerts?: boolean;
  pushAlerts?: boolean;
  digest?: boolean;
  facebookPublicSearch?: boolean;
  veilleFacebook?: boolean;
  veilleGoogleNews?: boolean;
  veilleYoutube?: boolean;
  veilleReddit?: boolean;
  veilleRss?: boolean;
  veilleNewsLang?: string;
  veilleNewsCountry?: string;
  lastFacebookScanAt?: string;
  lastFacebookScanAdded?: number;
  lastFacebookScanChecked?: number;
  lastFacebookScanPages?: number;
  lastFacebookScanWarning?: string;
  term?: string;
  platforms?: string[];
  [key: string]: string | number | boolean | string[] | { views?: number; comments?: number; likes?: number; shares?: number } | { components: unknown[]; weights: Record<string, number>; provisional: boolean; capApplied?: string } | undefined;
}
export type WorkspaceData = Record<ResourceType, Entity[]>;
export interface AppUser { id: string; name: string; email: string; demo: boolean; }
export const sectionLabels: Record<string, string> = {
  dashboard: 'Tableau de bord', profil: 'Profil de la personnalité', sources: 'Sources de surveillance', mentions: 'Mentions & Analyse', analyse: 'Analyse IA', alertes: 'Gestion des alertes', crise: 'Gestion de crise', contenus: 'Contenus & publications', medias: 'Relations médias', rapports: 'Rapports & statistiques', protection: 'Protection de l’identité', parametres: 'Paramètres', premium: 'Changer de plan',
};
export const formatNumber = (n: number) => new Intl.NumberFormat('fr-FR').format(n);
