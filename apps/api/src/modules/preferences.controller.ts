import { type Database, userPreference } from '@factoryos/db';
import { Body, Controller, Get, Inject, Put } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { Ctx, TenantScoped, type TenantRequestContext } from '../common/access.js';
import { DB } from '../common/tokens.js';
import { parse } from '../common/validation.js';

/** Menu areas a person can close (decision 068, slice 2). */
export const MENU_AREAS = ['sell', 'buy', 'stock', 'make', 'quality', 'machines', 'services', 'accounts', 'settings'] as const;

/** An in-app menu link: /app plus up to three lowercase segments, optionally the parties role filter. Never an external URL. */
const MENU_PATH = /^\/app(\/[a-z0-9-]+){0,3}(\?role=(customer|supplier))?$/;
const menuPath = z.string().max(80).regex(MENU_PATH, 'Not a menu link');

const preferencesInput = z.object({
  favourites: z.array(menuPath).max(12),
  recent: z.array(menuPath).max(5),
  collapsed: z.array(z.enum(MENU_AREAS)).max(MENU_AREAS.length),
});

export type Preferences = z.infer<typeof preferencesInput>;

const EMPTY: Preferences = { favourites: [], recent: [], collapsed: [] };
const unique = <T>(xs: T[]) => [...new Set(xs)];

/** Favourites, recent pages and closed menu areas: one row per person and workspace, readable only by that person. */
@Controller()
export class PreferencesController {
  constructor(@Inject(DB) private readonly db: Database) {}

  @Get('me/preferences')
  @TenantScoped()
  async get(@Ctx() ctx: TenantRequestContext): Promise<Preferences> {
    const [row] = await this.db
      .select({ data: userPreference.data })
      .from(userPreference)
      .where(and(eq(userPreference.userId, ctx.user.id), eq(userPreference.tenantId, ctx.tenant.tenantId)));
    const parsed = preferencesInput.safeParse(row?.data);
    return parsed.success ? parsed.data : EMPTY;
  }

  /** Replaces the whole set; the browser holds the state and sends it back, so the last write from any device wins. */
  @Put('me/preferences')
  @TenantScoped()
  async put(@Ctx() ctx: TenantRequestContext, @Body() body: unknown): Promise<Preferences> {
    const input = parse(preferencesInput, body);
    const data: Preferences = { favourites: unique(input.favourites), recent: unique(input.recent), collapsed: unique(input.collapsed) };
    await this.db
      .insert(userPreference)
      .values({ userId: ctx.user.id, tenantId: ctx.tenant.tenantId, data })
      .onConflictDoUpdate({ target: [userPreference.userId, userPreference.tenantId], set: { data, updatedAt: new Date() } });
    return data;
  }
}
