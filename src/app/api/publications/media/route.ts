import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getUser, sameOrigin } from '@/lib/auth';

/** Types de fichiers acceptés avec leur extension et leur taille maximale. */
const ACCEPTED_TYPES: Record<string, { extension: string; maxSize: number }> = {
  'image/jpeg': { extension: 'jpg', maxSize: 5 * 1024 * 1024 },
  'image/png': { extension: 'png', maxSize: 5 * 1024 * 1024 },
  'image/webp': { extension: 'webp', maxSize: 5 * 1024 * 1024 },
  'image/gif': { extension: 'gif', maxSize: 5 * 1024 * 1024 },
  'video/mp4': { extension: 'mp4', maxSize: 50 * 1024 * 1024 },
  'video/webm': { extension: 'webm', maxSize: 50 * 1024 * 1024 },
  'video/quicktime': { extension: 'mov', maxSize: 50 * 1024 * 1024 },
};

/** Vérifie que le contenu correspond bien au type déclaré (magic bytes). */
function hasValidSignature(mime: string, bytes: Buffer): boolean {
  const startsWith = (...values: number[]) => values.every((value, index) => bytes[index] === value);
  const ascii = (offset: number, length: number) => bytes.toString('ascii', offset, offset + length);

  switch (mime) {
    case 'image/jpeg': return startsWith(0xff, 0xd8, 0xff);
    case 'image/png': return startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case 'image/gif': return ascii(0, 4) === 'GIF8';
    case 'image/webp': return ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP';
    case 'video/mp4': return bytes.length > 11 && ascii(4, 4) === 'ftyp';
    case 'video/webm': return startsWith(0x1a, 0x45, 0xdf, 0xa3);
    default: return false;
  }
}

const MAX_MESSAGE = 5 * 1024 * 1024;

/**
 * Enregistre un média (image ou vidéo) pour un contenu et renvoie son URL.
 * Fichiers limités en taille, type vérifié par magic bytes, nom généré.
 */
export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return Response.json({ error: 'Origine non autorisée.' }, { status: 403 });

    const user = await getUser();
    if (!user) return Response.json({ error: 'Connectez-vous pour envoyer un fichier.' }, { status: 401 });

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return Response.json({ error: 'Requête invalide : envoyez le fichier via un formulaire multipart.' }, { status: 400 });
    }

    const file = form.get('file');
    if (!(file instanceof File)) return Response.json({ error: 'Aucun fichier reçu.' }, { status: 400 });

    const expected = ACCEPTED_TYPES[file.type];
    if (!expected) {
      return Response.json({ error: 'Format non pris en charge. Utilisez JPG, PNG, WebP, GIF, MP4, WebM ou MOV.' }, { status: 400 });
    }
    if (file.size === 0 || file.size > expected.maxSize) {
      const limit = Math.round(expected.maxSize / MAX_MESSAGE);
      return Response.json({ error: `Fichier trop volumineux (maximum ${limit} Mo pour ce format).` }, { status: 400 });
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    if (!hasValidSignature(file.type, bytes)) {
      return Response.json({ error: 'Le contenu du fichier ne correspond pas à son format déclaré.' }, { status: 400 });
    }

    const directory = join(process.cwd(), 'public', 'uploads', 'publications');
    await mkdir(directory, { recursive: true });

    const filename = `${randomUUID()}.${expected.extension}`;
    await writeFile(join(directory, filename), bytes);

    return Response.json({ success: true, url: `/uploads/publications/${filename}` });
  } catch (error) {
    console.error('Envoi de média impossible :', error instanceof Error ? error.message : 'erreur inconnue');
    return Response.json({ error: 'L’envoi du fichier a échoué.' }, { status: 500 });
  }
}
