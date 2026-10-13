// Per person and workspace menu preferences (decision 068, slice 2): favourites, recent pages and which menu areas are
// closed. One row per (user, tenant); the JSON shape is validated by the API, which only stores menu link paths.
import { jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth.js';
import { tenant } from './platform.js';

export const userPreference = pgTable(
  'user_preference',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'cascade' }),
    data: jsonb('data').notNull().default({}),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.tenantId] })],
);
