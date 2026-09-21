ALTER TABLE "scheduler"."executions" ADD COLUMN "execution_profile_id" text;--> statement-breakpoint
ALTER TABLE "scheduler"."executions" ADD COLUMN "network_route_id" text;--> statement-breakpoint
ALTER TABLE "scheduler"."schedules" ADD COLUMN "execution_profile_id" text;--> statement-breakpoint
ALTER TABLE "scheduler"."schedules" ADD COLUMN "network_route_id" text;