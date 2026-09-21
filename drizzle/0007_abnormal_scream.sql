ALTER TABLE "scheduler"."schedules" ADD COLUMN "external_source" text;--> statement-breakpoint
ALTER TABLE "scheduler"."schedules" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "scheduler"."schedules" ADD COLUMN "external_request_hash" text;--> statement-breakpoint
CREATE UNIQUE INDEX "schedules_external_identity_idx" ON "scheduler"."schedules" USING btree ("external_source","external_id");