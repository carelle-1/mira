import { boolean, customType, index, mysqlTable, timestamp, varchar } from 'drizzle-orm/mysql-core';
import type { Entity } from '@/lib/types';

const uuid = () => crypto.randomUUID();

const jsonColumn = customType<{ data: unknown }>({
  dataType() {
    return 'json';
  },
  toDriver(value: unknown) {
    return JSON.stringify(value);
  },
  fromDriver(value: unknown) {
    return typeof value === 'string' ? JSON.parse(value) : value;
  },
});

export const users = mysqlTable('ghostroar_users', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(uuid),
  name: varchar('name', { length: 255 }).notNull(),
  email: varchar('email', { length: 254 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  isDemo: boolean('is_demo').notNull().default(false),
  totpSecret: varchar('totp_secret', { length: 255 }),
  pendingTotpSecret: varchar('pending_totp_secret', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
export const sessions = mysqlTable('ghostroar_sessions', {
  tokenHash: varchar('token_hash', { length: 64 }).primaryKey(),
  userId: varchar('user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at').notNull(),
}, table => [index('session_user_idx').on(table.userId)]);
export const resources = mysqlTable('ghostroar_resources', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(uuid),
  userId: varchar('user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: varchar('type', { length: 64 }).notNull(),
  data: jsonColumn('data').$type<Partial<Entity>>().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, table => [index('resource_owner_type_idx').on(table.userId, table.type)]);

export const platformAccounts = mysqlTable('ghostroar_platform_accounts', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(uuid),
  userId: varchar('user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  platform: varchar('platform', { length: 50 }).notNull(),
  accountName: varchar('account_name', { length: 255 }).notNull(),
  accountId: varchar('account_id', { length: 255 }).notNull(),
  accessToken: varchar('access_token', { length: 1024 }).notNull(),
  refreshToken: varchar('refresh_token', { length: 1024 }),
  expiresAt: timestamp('expires_at'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, table => [index('platform_account_user_idx').on(table.userId, table.platform)]);
