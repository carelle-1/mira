import { createHash } from 'node:crypto';
import { cookies } from 'next/headers';
import { and, eq, gt, ne } from 'drizzle-orm';
import { db } from '@/db';
import { sessions, users } from '@/db/schema';
import { getUser, sameOrigin } from '@/lib/auth';
import { createTotpSecret, verifyTotp } from '@/lib/totp';
async function currentHash() { const token=(await cookies()).get('ghostroar_session')?.value;return token?createHash('sha256').update(token).digest('hex'):''; }
export async function GET() {
  try {
    const user=await getUser();if(!user)return Response.json({error:'Veuillez vous connecter.'},{status:401});
    const hash=await currentHash();
    const active=await db.select({id:sessions.tokenHash,expiresAt:sessions.expiresAt}).from(sessions).where(and(eq(sessions.userId,user.id),gt(sessions.expiresAt,new Date())));
    return Response.json({twoFactorEnabled:Boolean(user.totpSecret),demo:user.isDemo,sessions:active.map((s,i)=>({id:s.id,current:s.id===hash,name:s.id===hash?'Ce navigateur':`Session ${i+1}`,expiresAt:s.expiresAt}))});
  } catch {return Response.json({error:'Impossible de charger les informations de sécurité.'},{status:500});}
}
export async function POST(request:Request) {
  try {
    if(!sameOrigin(request))return Response.json({error:'Origine non autorisée.'},{status:403});
    const user=await getUser();if(!user)return Response.json({error:'Veuillez vous connecter.'},{status:401});
    const body=await request.json();
    if(body.action==='revoke') {
      const hash=await currentHash();
      await db.delete(sessions).where(and(eq(sessions.userId,user.id),ne(sessions.tokenHash,hash),typeof body.id==='string'?eq(sessions.tokenHash,body.id):undefined));
      return Response.json({success:true});
    }
    if(user.isDemo)return Response.json({error:'Créez votre compte personnel pour configurer l’authentification à deux facteurs.'},{status:403});
    if(body.action==='setup') {
      if(user.totpSecret)return Response.json({error:'La double authentification est déjà active.'},{status:400});
      const secret=createTotpSecret();
      await db.update(users).set({pendingTotpSecret:secret}).where(eq(users.id,user.id));
      return Response.json({secret,uri:`otpauth://totp/GHOSTROAR:${encodeURIComponent(user.email)}?secret=${secret}&issuer=GHOSTROAR&algorithm=SHA1&digits=6&period=30`});
    }
    if(body.action==='enable') {
      if(!user.pendingTotpSecret||typeof body.code!=='string'||!verifyTotp(user.pendingTotpSecret,body.code))return Response.json({error:'Le code de vérification est incorrect ou expiré.'},{status:400});
      await db.update(users).set({totpSecret:user.pendingTotpSecret,pendingTotpSecret:null}).where(eq(users.id,user.id));
      return Response.json({success:true});
    }
    if(body.action==='disable') {
      if(!user.totpSecret||typeof body.code!=='string'||!verifyTotp(user.totpSecret,body.code))return Response.json({error:'Le code de vérification est incorrect ou expiré.'},{status:400});
      await db.update(users).set({totpSecret:null,pendingTotpSecret:null}).where(eq(users.id,user.id));
      return Response.json({success:true});
    }
    return Response.json({error:'Action inconnue.'},{status:400});
  } catch {return Response.json({error:'Impossible de mettre à jour la sécurité du compte.'},{status:500});}
}
