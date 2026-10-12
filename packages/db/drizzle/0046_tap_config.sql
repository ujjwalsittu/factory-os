ALTER TABLE "iot_device" ADD COLUMN "config" jsonb DEFAULT '{"offAmps":0.5,"runAmps":3,"ctAmpsPerVolt":30,"debounceSeconds":5,"lights":{"red":"alarm","amber":"idle","green":"running"}}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "iot_device" ADD COLUMN "config_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "iot_device" ADD COLUMN "fw_version" text;--> statement-breakpoint
ALTER TABLE "iot_device" ADD COLUMN "applied_config_version" integer;--> statement-breakpoint
ALTER TABLE "iot_device" ADD COLUMN "rssi" integer;--> statement-breakpoint
ALTER TABLE "iot_device" ADD COLUMN "outbox" integer;--> statement-breakpoint
ALTER TABLE "iot_device" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "iot_device" ADD COLUMN "status_at" timestamp with time zone;