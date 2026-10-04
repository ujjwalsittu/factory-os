import 'reflect-metadata';
import { runMigrations } from '@factoryos/db/migrate';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { toNodeHandler } from 'better-auth/node';
import express from 'express';
import { AppModule } from './app.module.js';
import { bootstrapSuperadmin, syncOnStartup } from './bootstrap.js';
import type { Auth } from './auth.js';
import { AUTH } from './common/tokens.js';
import { loadConfig } from './config.js';

async function bootstrap() {
  const config = loadConfig();
  if (config.MIGRATE_ON_START) await runMigrations(config.DATABASE_URL);
  await syncOnStartup(config);
  await bootstrapSuperadmin(config);

  // Body parsing is disabled so Better Auth can read raw requests; JSON parsing is added after its route.
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  const server = app.getHttpAdapter().getInstance() as express.Express;
  server.set('trust proxy', 1);
  server.disable('x-powered-by');
  server.all('/api/auth/{*path}', toNodeHandler(app.get<Auth>(AUTH)));
  app.use(express.json({ limit: '1mb' }));

  app.setGlobalPrefix('api');
  app.enableCors({ origin: [config.WEB_ORIGIN, ...config.EXTRA_TRUSTED_ORIGINS], credentials: true });
  app.enableShutdownHooks();
  await app.listen(config.PORT);
  Logger.log(`API listening on :${config.PORT}`, 'Bootstrap');
}

void bootstrap();
