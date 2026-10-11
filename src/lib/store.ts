import { randomBytes } from 'node:crypto';
import { asc, eq, and } from 'drizzle-orm';
import { db } from '@/db';
import { resources, users } from '@/db/schema';
import { demoData } from './demo-data';
import { hashPassword } from './auth';
import { resourceTypes, type Entity, type ResourceType, type WorkspaceData } from './types';

let seedPromise: Promise<typeof users.$inferSelect> | undefined;
export async function seedWorkspace(userId: string) {
  const [account] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const rows = resourceTypes.flatMap(type => demoData[type].map(entity => {
    const { id: _id, type: _type, ...data } = entity;
    if (account && !account.isDemo) {
      if (type === 'profile') { data.name = account.name; data.email = account.email; }
      if (type === 'settings') data.email = account.email;
    }
    return { userId, type, data };
  }));
  await db.insert(resources).values(rows);
}
export async function ensureDemoUser() {
  if (!seedPromise) seedPromise = (async () => {
    const email = 'demo@ghostroar.app';
    const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existing) {
      const [settings] = await db.select().from(resources).where(and(eq(resources.userId, existing.id), eq(resources.type, 'settings'))).limit(1);
      if (settings && settings.data.seedVersion !== 3) {
        const current = await db.select({ type: resources.type }).from(resources).where(eq(resources.userId, existing.id));
        const missing = (['appointments', 'campaigns', 'threats', 'monitors', 'subscriptions'] as const).filter(type => !current.some(row => row.type === type));
        const rows = missing.flatMap(type => demoData[type].map(({ id: _id, type: _type, ...data }) => ({ userId: existing.id, type, data })));
        if (rows.length) await db.insert(resources).values(rows);
        await db.update(resources).set({ data: { ...demoData.settings[0], ...settings.data, seedVersion: 3 } }).where(eq(resources.id, settings.id));
      }
      return existing;
    }
    await db.insert(users).values({ name: 'Arnaud Kenne', email, passwordHash: hashPassword(randomBytes(40).toString('hex')), isDemo: true });
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (user) { await seedWorkspace(user.id); return user; }
    throw new Error('Utilisateur de démonstration introuvable');
  })().catch(error => { seedPromise = undefined; throw error; });
  return seedPromise;
}
export async function loadWorkspace(userId: string): Promise<WorkspaceData> {
  const data = Object.fromEntries(resourceTypes.map(type => [type, []])) as unknown as WorkspaceData;
  const rows = await db.select().from(resources).where(eq(resources.userId, userId)).orderBy(asc(resources.createdAt));
  rows.forEach(row => {
    const type = row.type as ResourceType;
    if (data[type]) data[type].push({ ...row.data, id: row.id, type, name: row.data.name || '' } as Entity);
  });
  return data;
}
