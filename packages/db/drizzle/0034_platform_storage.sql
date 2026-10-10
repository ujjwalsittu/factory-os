CREATE TABLE "platform_storage_setting" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"endpoint" text NOT NULL,
	"region" text DEFAULT 'auto' NOT NULL,
	"bucket" text NOT NULL,
	"access_key_id" text NOT NULL,
	"secret" jsonb NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_storage_setting_singleton_ck" CHECK ("platform_storage_setting"."id" = 'default')
);
--> statement-breakpoint
ALTER TABLE "platform_storage_setting" ADD CONSTRAINT "platform_storage_setting_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;