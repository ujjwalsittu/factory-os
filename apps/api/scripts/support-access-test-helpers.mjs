// Support access (decision 050) fixture: an owned, freshly migrated PostgreSQL database plus the real native auth
// handler and the real Nest guard and controllers. Nothing about authentication or authorization is mocked.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { isolatedSsoDatabase } from './sso-schema-helpers.mjs';
import { createAuth } from '../dist/auth.js';
import { loadConfig } from '../dist/config.js';
import { EmailService } from '../dist/modules/email/email.service.js';
import { AuditService } from '../dist/common/audit.service.js';
import { TenancyService } from '../dist/modules/tenancy.service.js';
import { Module } from '@nestjs/common';
import { NestFactory, APP_GUARD } from '@nestjs/core';
import { AccessGuard } from '../dist/common/access.js';
import { AUTH, CONFIG, DB } from '../dist/common/tokens.js';
import { SupportAccessStore } from '../dist/modules/support-access/support-access.store.js';

export const PASSWORD = 'Synthetic-password-123';

/**
 * @param overrides environment overrides (SUPPORT_ACCESS_ENABLED defaults to true here)
 * @param extra { controllers, providers, configure(app,{config,auth,db}) } added by later support tasks
 */
export async function startSupportFixture(overrides = {}, extra = {}) {
  const f = await isolatedSsoDatabase();
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: f.url,
    BETTER_AUTH_URL: 'http://localhost:3000',
    WEB_ORIGIN: 'http://localhost:3000',
    BETTER_AUTH_SECRET: 'synthetic-secret-over-thirty-two-characters',
    SUPPORT_ACCESS_ENABLED: 'true',
    ...overrides,
  });
  const audit = new AuditService(f.db),
    tenancy = new TenancyService(f.db, audit),
    email = new EmailService(f.db, config, audit, tenancy),
    auth = createAuth(f.db, config, email);
  class FixtureModule {}
  Module({
    controllers: extra.controllers ?? [],
    providers: [
      SupportAccessStore,
      AuditService,
      ...(extra.providers ?? []),
      { provide: AUTH, useValue: auth },
      { provide: DB, useValue: f.db },
      { provide: CONFIG, useValue: config },
      { provide: APP_GUARD, useClass: AccessGuard },
    ],
  })(FixtureModule);
  let app;
  const api = new URL(process.env.API ?? 'http://localhost:4000');
  const listenHost = api.hostname === 'localhost' ? '127.0.0.1' : api.hostname;
  const transportApi = new URL(api);
  transportApi.hostname = listenHost;
  try {
    app = await NestFactory.create(FixtureModule, { logger: false, abortOnError: false, bodyParser: true });
    await extra.configure?.(app, { config, auth, db: f.db });
    app.setGlobalPrefix('api');
    await app.listen(Number(api.port || 4000), listenHost);
  } catch (error) {
    if (app) await app.close();
    await f.close();
    throw error;
  }

  /** Native auth paths go through the real Better Auth handler; /api/... paths through the running Nest app. */
  async function request(path, { method, body, cookies = new Map(), headers = {} } = {}) {
    const application = path.startsWith('/api/') && !path.startsWith('/api/auth/');
    const url = application ? new URL(path, transportApi) : config.BETTER_AUTH_URL + (path.startsWith('/api/') ? path : '/api/auth' + path);
    const req = new Request(url, {
      method: method ?? (body === undefined ? 'GET' : 'POST'),
      headers: { origin: config.WEB_ORIGIN, 'content-type': 'application/json', cookie: [...cookies].map(([k, v]) => k + '=' + v).join('; '), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const response = application ? await fetch(req) : await auth.handler(req);
    for (const item of response.headers.getSetCookie()) {
      const [pair] = item.split(';'),
        i = pair.indexOf('='),
        key = pair.slice(0, i),
        value = pair.slice(i + 1);
      if (value && !/max-age=0/i.test(item)) cookies.set(key, value);
      else cookies.delete(key);
    }
    const data = await response.json().catch(() => null);
    return { status: response.status, data, headers: response.headers };
  }

  /** A real native sign-up (password account, session cookie), email marked verified by the fixture. */
  async function localUser(email, name = 'Synthetic user') {
    const cookies = new Map();
    const result = await request('/sign-up/email', { body: { name, email, password: PASSWORD }, cookies });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    const id = result.data.user.id;
    await f.db.$client.query('update "user" set email_verified = true where id = $1', [id]);
    const session = (await f.db.$client.query('select id from session where user_id = $1 order by created_at desc limit 1', [id])).rows[0];
    return { id, email, cookies, ctx: { user: { id, email, name }, sessionId: session.id, tenant: null, platformAdminLevel: null, ip: null, userAgent: null } };
  }

  return {
    db: f.db,
    url: f.url,
    config,
    auth,
    app,
    store: app.get(SupportAccessStore),
    request,
    localUser,
    async close() {
      await app.close();
      await f.close();
    },
  };
}

/** A tenant with one entity; the owner's membership has the seeded Owner role (tenant-wide). */
export async function seedTenant(db, ownerUserId, name = 'Support fixture') {
  const q = (text, values) => db.$client.query(text, values).then((r) => r.rows);
  const [t] = await q(`insert into tenant(name, slug) values ($1, $2) returning id`, [name, 'sup-' + crypto.randomUUID()]);
  const [e] = await q(`insert into legal_entity(tenant_id, legal_name, short_name, code) values ($1, $2, $3, $4) returning id`, [t.id, name + ' Pvt Ltd', name, 'SF']);
  const [owner] = await q(`insert into role(tenant_id, system_key, name, permissions) values ($1, 'owner', 'Owner', $2::jsonb) returning id`, [t.id, JSON.stringify(ALL)]);
  const [m] = await q(`insert into membership(tenant_id, user_id, is_owner) values ($1, $2, true) returning id`, [t.id, ownerUserId]);
  await q(`insert into role_assignment(tenant_id, membership_id, role_id) values ($1, $2, $3)`, [t.id, m.id, owner.id]);
  return { tenantId: t.id, entityId: e.id, ownerRoleId: owner.id, ownerMembershipId: m.id };
}

/** Adds a member with one role (optionally entity-scoped). */
export async function addMember(db, tenantId, userId, permissions, entityIds = null) {
  const q = (text, values) => db.$client.query(text, values).then((r) => r.rows);
  const [r] = await q(`insert into role(tenant_id, name, permissions) values ($1, $2, $3::jsonb) returning id`, [tenantId, 'Role ' + crypto.randomUUID(), JSON.stringify(permissions)]);
  const [m] = await q(`insert into membership(tenant_id, user_id) values ($1, $2) returning id`, [tenantId, userId]);
  await q(`insert into role_assignment(tenant_id, membership_id, role_id, entity_ids) values ($1, $2, $3, $4::jsonb)`, [tenantId, m.id, r.id, entityIds === null ? null : JSON.stringify(entityIds)]);
  return { membershipId: m.id, roleId: r.id };
}

const { ALL_PERMISSIONS: ALL } = await import('../../../packages/auth/dist/index.js');
