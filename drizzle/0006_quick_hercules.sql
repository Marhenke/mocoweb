ALTER TABLE "chat_conversations" ADD COLUMN "last_published" jsonb;--> statement-breakpoint
ALTER TABLE "chat_messages" DROP COLUMN "change_card";