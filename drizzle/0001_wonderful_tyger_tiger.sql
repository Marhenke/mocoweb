ALTER TABLE "entries" ADD COLUMN "published_position" integer;--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "pending_delete" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "entries_collection_key_published_position_idx" ON "entries" USING btree ("collection_key","published_position");