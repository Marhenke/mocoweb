CREATE TABLE "inquiries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"message" text NOT NULL,
	"status" text DEFAULT 'unread' NOT NULL,
	"ip_hash" text,
	"notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "page_view_stats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"day" text NOT NULL,
	"path" text NOT NULL,
	"referrer_host" text NOT NULL,
	"device" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "inquiries_created_at_idx" ON "inquiries" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "inquiries_status_created_at_idx" ON "inquiries" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "page_view_stats_day_path_referrer_device_key" ON "page_view_stats" USING btree ("day","path","referrer_host","device");--> statement-breakpoint
CREATE INDEX "page_view_stats_day_idx" ON "page_view_stats" USING btree ("day");--> statement-breakpoint
CREATE INDEX "page_view_stats_path_idx" ON "page_view_stats" USING btree ("path");