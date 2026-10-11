import { and, eq, ne } from 'drizzle-orm';
import { db } from '@/db';
import { resources, users } from '@/db/schema';
import { getUser, sameOrigin } from '@/lib/auth';
export async function PATCH(request:Request) {
  try {
    if(!sameOrigin(request))return Response.json({error:'Origine non autorisée.'},{status:403});
    const user=await getUser();if(!user)return Response.json({error:'Veuillez vous connecter.'},{status:401});
    const body=await request.json();
    const name=typeof body.name==='string'?body.name.trim():'';
    const email=typeof body.email==='string'?body.email.toLowerCase().trim():'';
    if(name.length<2||name.length>100||!/^\S+@\S+\.\S+$/.test(email)||email.length>254)return Response.json({error:'Vérifiez le nom complet et l’adresse email.'},{status:400});
    if(!user.isDemo) {const [duplicate]=await db.select({id:users.id}).from(users).where(and(eq(users.email,email),ne(users.id,user.id))).limit(1);if(duplicate)return Response.json({error:'Cette adresse email est déjà utilisée.'},{status:409});}
    const data:Record<string,string|boolean>={};
    for(const key of ['phone','city','languages','timezone','theme','dateFormat'])if(typeof body[key]==='string')data[key]=body[key].slice(0,200);
    for(const key of ['emailAlerts','pushAlerts','sensitiveData','digest','weeklyReport','criticalOnly'])if(typeof body[key]==='boolean')data[key]=body[key];
    await db.transaction(async tx=>{
      await tx.update(users).set(user.isDemo?{name}:{name,email}).where(eq(users.id,user.id));
      const [profile]=await tx.select().from(resources).where(and(eq(resources.userId,user.id),eq(resources.type,'profile'))).limit(1);
      if(profile)await tx.update(resources).set({data:{...profile.data,name,email,phone:String(data.phone||profile.data.phone||''),city:String(data.city||profile.data.city||'')},updatedAt:new Date()}).where(eq(resources.id,profile.id));
      const [settings]=await tx.select().from(resources).where(and(eq(resources.userId,user.id),eq(resources.type,'settings'))).limit(1);
      if(settings)await tx.update(resources).set({data:{...settings.data,...data,email,lastSaved:new Date().toISOString()},updatedAt:new Date()}).where(eq(resources.id,settings.id));
    });
    return Response.json({success:true});
  } catch {return Response.json({error:'Impossible d’enregistrer les préférences du compte.'},{status:500});}
}
