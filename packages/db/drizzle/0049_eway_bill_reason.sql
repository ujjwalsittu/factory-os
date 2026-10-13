CREATE TYPE "public"."eway_bill_reason" AS ENUM('job_worker_generates', 'exempt');--> statement-breakpoint
ALTER TABLE "job_work_challan" ADD COLUMN "eway_bill_reason" "eway_bill_reason";