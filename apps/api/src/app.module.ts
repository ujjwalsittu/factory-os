import { createDb, type Database } from '@factoryos/db';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { createAuth } from './auth.js';
import { AccessGuard } from './common/access.js';
import { AuditService } from './common/audit.service.js';
import { AUTH, CONFIG, DB } from './common/tokens.js';
import { type AppConfig, loadConfig } from './config.js';
import { EntitiesController } from './modules/entities.controller.js';
import { HealthController } from './modules/health.controller.js';
import { InventoryController } from './modules/inventory.controller.js';
import { MastersController } from './modules/masters.controller.js';
import { StockPostingService } from './modules/stock-posting.service.js';
import { MeController } from './modules/me.controller.js';
import { MembersController } from './modules/members.controller.js';
import { PlatformController } from './modules/platform.controller.js';
import { RolesController } from './modules/roles.controller.js';
import { TenancyService } from './modules/tenancy.service.js';
import { WasteController } from './modules/waste.controller.js';

@Module({
  controllers: [HealthController, MeController, EntitiesController, MembersController, RolesController, PlatformController, MastersController, InventoryController, WasteController],
  providers: [
    { provide: CONFIG, useFactory: () => loadConfig() },
    { provide: DB, inject: [CONFIG], useFactory: (c: AppConfig) => createDb(c.DATABASE_URL) },
    { provide: AUTH, inject: [DB, CONFIG], useFactory: (db: Database, c: AppConfig) => createAuth(db, c) },
    { provide: APP_GUARD, useClass: AccessGuard },
    AuditService,
    TenancyService,
    StockPostingService,
  ],
})
export class AppModule {}
