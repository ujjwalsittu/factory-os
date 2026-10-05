import assert from 'node:assert/strict';
export class Client {
  constructor() {
    this.base = `${process.env.API ?? 'http://localhost:4001'}/api`;
    this.origin = process.env.WEB_ORIGIN ?? 'http://localhost:3001';
    this.cookie = '';
    this.checks = 0;
  }
  async raw(method, path, body) {
    const response = await fetch(this.base + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Origin: this.origin,
        Cookie: this.cookie,
        ...(this.tenantId && { 'x-tenant-id': this.tenantId }),
        ...(this.entityId && { 'x-entity-id': this.entityId }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    const cookies = response.headers.getSetCookie();
    if (cookies.length)
      this.cookie = cookies.map((c) => c.split(';')[0]).join('; ');
    return { status: response.status, data: await response.json() };
  }
  async req(method, path, body, expected = 200) {
    const res = await this.raw(method, path, body);
    assert.equal(
      res.status,
      expected,
      `${method} ${path}: ${JSON.stringify(res.data)}`,
    );
    this.checks++;
    return res.data;
  }
  async init(name = 'Accounting Test') {
    await this.req('POST', '/auth/sign-up/email', {
      name,
      email: `gl${Date.now()}${Math.random().toString(36).slice(2)}@example.com`,
      password: 'Sup3r-secret-pw',
    });
    const w = await this.req(
      'POST',
      '/tenants',
      {
        name,
        entity: {
          legalName: name,
          shortName: 'GL',
          code: 'GL',
          pan: 'AAACA1234B',
        },
      },
      201,
    );
    this.tenantId = w.tenant.id;
    this.entityId = w.entity.id;
    this.settings = await this.req('GET', '/accounts/settings');
    this.accounts = await this.req('GET', '/accounts/accounts');
    return this;
  }
  account(role) {
    const a = this.accounts.find((a) => a.role === role);
    assert.ok(a, role);
    return a.id;
  }
  line(role, debit, credit = '0') {
    return { accountId: this.account(role), debit, credit };
  }
  async activate(
    lines = [],
    receiptBaselines = [],
    bills = [],
    settlements = [],
  ) {
    const w = await this.req('PUT', '/accounts/opening', {
      lines,
      bills,
      settlements,
      receiptBaselines,
    });
    const p = await this.req('GET', '/accounts/opening/reconciliation');
    assert.deepEqual(p.differences, []);
    await this.req('POST', '/accounts/opening/activate', {
      worksheetId: w.id,
      reviewedToken: p.snapshotToken,
    });
    this.settings = await this.req('GET', '/accounts/settings');
    return p;
  }
}
export function gstin(first) {
  const C = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let n = 0;
  for (let i = 0; i < 14; i++) {
    const p = C.indexOf(first[i]) * (i % 2 ? 2 : 1);
    n += Math.floor(p / 36) + (p % 36);
  }
  return first + C[(36 - (n % 36)) % 36];
}
