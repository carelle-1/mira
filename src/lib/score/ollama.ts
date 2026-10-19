import { fetchWithPolicy } from '../sources/http';
import type { ScoreAnalysis, ScoringInput, ScoringProvider } from './types';

/** Paramètres Ollama, configurables par variable d'environnement. */
export function ollamaConfig() {
  const url = (process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/+$/, '');
  const configuredModel = process.env.OLLAMA_MODEL?.trim();
  // Les modèles locaux peuvent être lents sur CPU : 2 minutes par défaut.
  const timeoutMs = Number(process.env.OLLAMA_TIMEOUT_MS) > 0 ? Number(process.env.OLLAMA_TIMEOUT_MS) : 120_000;
  return { url, configuredModel: configuredModel || undefined, timeoutMs };
}

interface OllamaTagsResponse {
  models?: { name?: string }[];
}

interface OllamaChatResponse {
  message?: { content?: string };
}

export interface OllamaStatus {
  available: boolean;
  /** Modèles installés sur la machine. */
  models: string[];
  /** Modèle effectivement utilisé. */
  model?: string;
  error?: string;
}

/** Erreur levée quand Ollama est injoignable ou renvoie une réponse inexploitable. */
export class OllamaUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OllamaUnavailableError';
  }
}

const SENTIMENTS: ScoreAnalysis['sentiment'][] = ['positif', 'neutre', 'negatif'];

/** Borne une valeur numérique dans un intervalle, ou renvoie undefined. */
function clampNumber(value: unknown, min: number, max: number): number | undefined {
  const parsed = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN;
  if (!Number.isFinite(parsed)) return undefined;
  return Math.min(max, Math.max(min, parsed));
}

/**
 * Extrait un objet JSON d'une réponse texte (blocs ```json, texte libre).
 * Certains modèles ajoutent des explications malgré `format: "json"`, ou
 * tronquent leur réponse : le JSON est alors réparé avant relecture.
 */
export function extractJsonObject(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : raw;

  const start = candidate.indexOf('{');
  if (start === -1) return null;

  const end = candidate.lastIndexOf('}');
  if (end > start) {
    const text = candidate.slice(start, end + 1);
    try {
      return JSON.parse(text);
    } catch {
      return repairTruncatedJson(text);
    }
  }

  // Réponse tronquée : aucun objet complet n'est présent.
  return repairTruncatedJson(candidate.slice(start));
}

/** Referme les guillemets, crochets et accolades d'un JSON tronqué. */
function repairTruncatedJson(text: string): unknown {
  let repaired = text.trimEnd();

  // Dernière chaîne ouverte (ex. "raison":"L'entreprise …) : on la referme.
  if (/"[^"]*$/.test(repaired)) repaired += '"';
  // Clé ouverte sans valeur (ex. "themes":) : on la supprime.
  repaired = repaired.replace(/,\s*"[^"]*"\s*:\s*$/, '');

  const openBrackets = (repaired.match(/\[/g) || []).length - (repaired.match(/\]/g) || []).length;
  const openBraces = (repaired.match(/\{/g) || []).length - (repaired.match(/\}/g) || []).length;
  repaired += ']'.repeat(Math.max(0, openBrackets)) + '}'.repeat(Math.max(0, openBraces));

  try {
    return JSON.parse(repaired);
  } catch {
    return null;
  }
}

/** Valeurs de sentiment par défaut quand le modèle omet `sentiment_score`. */
const DEFAULT_SENTIMENT_SCORE: Record<ScoreAnalysis['sentiment'], number> = {
  positif: 0.5,
  neutre: 0,
  negatif: -0.5,
};

/**
 * Valide strictement la réponse JSON d'Ollama et borne chaque valeur.
 * `sentiment` est le seul champ obligatoire ; les valeurs numériques
 * manquantes reçoivent une valeur par défaut (le modèle local les omet
 * parfois). Renvoie null si la structure est inexploitable — l'appelant
 * décide alors de la nouvelle tentative.
 */
export function validateAnalysis(raw: unknown): ScoreAnalysis | null {
  if (typeof raw === 'string') {
    return validateAnalysis(extractJsonObject(raw));
  }
  if (typeof raw !== 'object' || raw === null) return null;

  const candidate = raw as Record<string, unknown>;
  const sentiment = candidate.sentiment;
  if (typeof sentiment !== 'string' || !SENTIMENTS.includes(sentiment as ScoreAnalysis['sentiment'])) return null;

  const chosen = sentiment as ScoreAnalysis['sentiment'];

  // Valeurs dérivées ou neutres quand le modèle omet un champ numérique.
  const sentimentScore = clampNumber(candidate.sentiment_score, -1, 1) ?? DEFAULT_SENTIMENT_SCORE[chosen];
  const pertinence = clampNumber(candidate.pertinence, 0, 100) ?? 50;
  const gravite = clampNumber(candidate.gravite, 0, 100) ?? 30;

  if (candidate.pertinence === undefined || candidate.gravite === undefined) {
    console.info(`[score] modèle a omis pertinence/gravite ; valeurs neutres utilisées.`);
  }

  const themes = Array.isArray(candidate.themes)
    ? candidate.themes
      .filter((theme): theme is string => typeof theme === 'string')
      .filter(theme => theme.trim().length > 0 && !isPlaceholder(theme))
      .slice(0, 5)
    : [];

  // Le modèle recopie parfois le texte du gabarit : on l'écarte.
  const rawReason = typeof candidate.raison === 'string' ? candidate.raison.trim() : '';
  const raison = rawReason && !isPlaceholder(rawReason)
    ? rawReason.slice(0, 300)
    : 'Analyse automatique sans justification fournie.';

  return {
    sentiment: sentiment as ScoreAnalysis['sentiment'],
    sentimentScore,
    pertinence,
    gravite,
    themes,
    raison,
  };
}

/** Vrai si un texte est un placeholder du prompt plutôt qu'une vraie valeur. */
function isPlaceholder(value: string): boolean {
  const normalized = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
  return normalized.length < 3
    || /^(ton |ta |votre |une |explication|exemple|phrase|raison|themes?)/.test(normalized)
    || /themes? courts?/.test(normalized)
    || normalized.includes('entre 0 et 100')
    || normalized.includes('entre -1 et 1');
}

/** Prompt système : juge le texte uniquement par rapport à la marque. */
export function buildPrompt(input: ScoringInput): { system: string; user: string } {
  const keywords = input.keywords.length ? input.keywords.join(', ') : 'aucun';
  return {
    system: `Tu analyses la réputation en ligne de la marque ${input.brandName}. Juge le texte UNIQUEMENT par rapport à cette marque. Si le texte ne parle pas de la marque, réponds neutre avec pertinence faible. Réponds uniquement en JSON.`,
    user: [
      `Marque surveillée : ${input.brandName}`,
      `Mots-clés correspondants : ${keywords}`,
      `Source : ${input.sourceLabel}`,
      `Titre : ${input.title || '(sans titre)'}`,
      `Extrait : ${input.excerpt || '(vide)'}`,
      '',
      'Réponds UNIQUEMENT avec un objet JSON de cette forme exacte, sans texte autour :',
      '{"sentiment":"positif"|"neutre"|"negatif","sentiment_score":nombre entre -1 et 1,"pertinence":nombre entre 0 et 100,"gravite":nombre entre 0 et 100,"themes":["2 à 4 thèmes courts"],"raison":"ton explication en une phrase"}',
      '',
      'pertinence = la mention parle-t-elle réellement de la marque ? gravite = risque pour la réputation (insulte, accusation, arnaque, plainte = élevé ; simple citation = faible ; éloge = 0). La raison doit être ta propre phrase, en français.',
    ].join('\n'),
  };
}

/**
 * Fournisseur d'analyse sémantique Ollama (API locale).
 * L'interface ScoringProvider permet de le remplacer plus tard par une API cloud.
 */
export class OllamaScoringProvider implements ScoringProvider {
  readonly id = 'ollama';

  private readonly modelName: string;

  constructor(model?: string) {
    const config = ollamaConfig();
    this.modelName = model || config.configuredModel || 'qwen2.5:3b';
  }

  get model(): string {
    return this.modelName;
  }

  async analyze(input: ScoringInput): Promise<ScoreAnalysis> {
    const { url, timeoutMs } = ollamaConfig();
    const prompt = buildPrompt(input);

    let lastError = 'Analyse impossible.';

    // Une nouvelle tentative en cas de JSON invalide ou de réponse vide.
    for (let attempt = 1; attempt <= 2; attempt++) {
      const result = await fetchWithPolicy<OllamaChatResponse>(`${url}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        timeoutMs,
        body: JSON.stringify({
          model: this.model,
          stream: false,
          format: 'json',
          options: {
            temperature: 0,
            // Borne la sortie : évite les réponses tronquées du modèle.
            num_predict: 320,
            // Maintient le modèle chargé entre deux analyses.
            keep_alive: MODEL_KEEP_ALIVE,
          },
          messages: [
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user },
          ],
        }),
      });

      if (!result.ok || !result.data) {
        lastError = `Ollama indisponible (${result.error ?? 'réponse vide'})`;
        throw new OllamaUnavailableError(lastError);
      }

      const content = result.data.message?.content ?? '';
      const analysis = validateAnalysis(content);
      if (analysis) return analysis;

      lastError = `Réponse Ollama illisible ou hors format JSON attendu (aperçu : ${content.replace(/\s+/g, ' ').slice(0, 120) || 'réponse vide'}).`;
      console.warn(`[score] modèle=${this.modelName} : ${lastError} (tentative ${attempt}/2)`);
    }

    throw new Error(lastError);
  }
}

/** État d'Ollama et modèles disponibles (utilisé par /parametres). */
export async function readOllamaStatus(): Promise<OllamaStatus> {
  const { url, configuredModel } = ollamaConfig();

  const result = await fetchWithPolicy<OllamaTagsResponse>(`${url}/api/tags`, {
    timeoutMs: 5_000,
  });

  if (!result.ok || !result.data) {
    return { available: false, models: [], error: `Ollama injoignable sur ${url} (${result.error ?? 'réponse vide'})` };
  }

  const models = (result.data.models || [])
    .map(model => model.name)
    .filter((name): name is string => typeof name === 'string');

  if (!models.length) {
    return { available: true, models: [], model: configuredModel, error: 'Aucun modèle installé (ollama pull qwen2.5:3b).' };
  }

  return {
    available: true,
    models,
    model: configuredModel && models.includes(configuredModel) ? configuredModel : models[0],
  };
}

/** Durée de maintien du modèle en mémoire (évite le rechargement entre lots). */
const MODEL_KEEP_ALIVE = '30m';

/**
 * Précharge le modèle dans la mémoire d'Ollama (`keep_alive` de 30 minutes)
 * pour éviter le temps de chargement à chaque analyse.
 */
export async function prewarmOllamaModel(model: string): Promise<boolean> {
  const { url, timeoutMs } = ollamaConfig();

  const result = await fetchWithPolicy(`${url}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    timeoutMs,
    body: JSON.stringify({
      model,
      prompt: '',
      stream: false,
      keep_alive: MODEL_KEEP_ALIVE,
      options: { num_predict: 1 },
    }),
  });

  if (result.ok) {
    console.info(`[score] modèle ${model} préchauffé (maintien en mémoire ${MODEL_KEEP_ALIVE}).`);
  }
  return result.ok;
}
