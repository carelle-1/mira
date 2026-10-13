import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { runScheduledFacebookSearch } from '@/lib/facebook-search';

export const dynamic = 'force-dynamic';

function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return null;
  // Comparaison à temps constant sur des condensats de longueur fixe.
  const provided = createHash('sha256').update(request.headers.get('authorization') || '').digest();
  const expected = createHash('sha256').update(`Bearer ${secret}`).digest();
  return timingSafeEqual(provided, expected);
}

/**
 * Passe de collecte Facebook pilotable de l'extérieur (cron externe,
 * Planificateur de tâches Windows, etc.).
 * Authentification : Authorization: Bearer <CRON_SECRET>
 * La planification intégrée au serveur (toutes les 15 minutes) reste active
 * même sans cet appel externe.
 */
async function handle() {
  const summary = await runScheduledFacebookSearch();
  return NextResponse.json({ success: true, ...summary });
}

async function run(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({
      error: 'CRON_SECRET n’est pas défini. La planification intégrée (toutes les 15 minutes) reste active ; renseignez CRON_SECRET dans .env pour déclencher aussi la collecte via un cron externe.',
    }, { status: 503 });
  }
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Jeton de planification invalide.' }, { status: 401 });
  }
  try {
    return await handle();
  } catch (error) {
    console.error('Facebook scheduled search route error:', error);
    return NextResponse.json({ error: 'La collecte planifiée Facebook a échoué.' }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return run(request);
}
