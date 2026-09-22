ALTER TABLE "chat_conversations" ADD COLUMN "pending_change" jsonb;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "change_card" jsonb;