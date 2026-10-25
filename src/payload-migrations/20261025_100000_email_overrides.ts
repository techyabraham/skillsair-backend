import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * Studio email editor: `email-overrides` (published and draft wording per template, `_shared`,
 * `_settings`), the append-only `email-override-history`, their document-lock columns, and the
 * Email settings group on the Email content global (sender name, sign-off, company line).
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_email_override_history_action') THEN
        CREATE TYPE "public"."enum_email_override_history_action" AS ENUM('publish', 'reset', 'restore_to_draft');
      END IF;
    END $$;
    CREATE TABLE IF NOT EXISTS "email_overrides" (
      "id" serial PRIMARY KEY NOT NULL,
      "template_id" varchar NOT NULL,
      "published" jsonb,
      "draft" jsonb,
      "published_at" timestamp(3) with time zone,
      "published_by_id" integer,
      "draft_updated_at" timestamp(3) with time zone,
      "draft_updated_by_id" integer,
      "notes" varchar,
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
    );
    CREATE TABLE IF NOT EXISTS "email_override_history" (
      "id" serial PRIMARY KEY NOT NULL,
      "template_id" varchar NOT NULL,
      "action" "enum_email_override_history_action" NOT NULL,
      "snapshot" jsonb,
      "author_id" integer,
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
    );
    ALTER TABLE "payload_locked_documents_rels" ADD COLUMN IF NOT EXISTS "email_overrides_id" integer;
    ALTER TABLE "payload_locked_documents_rels" ADD COLUMN IF NOT EXISTS "email_override_history_id" integer;
    ALTER TABLE "email_content" ADD COLUMN IF NOT EXISTS "email_settings_sender_name" varchar;
    ALTER TABLE "email_content" ADD COLUMN IF NOT EXISTS "email_settings_sign_off_name" varchar;
    ALTER TABLE "email_content" ADD COLUMN IF NOT EXISTS "email_settings_sign_off_help" varchar;
    ALTER TABLE "email_content" ADD COLUMN IF NOT EXISTS "email_settings_company_line" varchar;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'email_overrides_published_by_id_users_id_fk') THEN
        ALTER TABLE "email_overrides" ADD CONSTRAINT "email_overrides_published_by_id_users_id_fk" FOREIGN KEY ("published_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'email_overrides_draft_updated_by_id_users_id_fk') THEN
        ALTER TABLE "email_overrides" ADD CONSTRAINT "email_overrides_draft_updated_by_id_users_id_fk" FOREIGN KEY ("draft_updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'email_override_history_author_id_users_id_fk') THEN
        ALTER TABLE "email_override_history" ADD CONSTRAINT "email_override_history_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payload_locked_documents_rels_email_overrides_fk') THEN
        ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_email_overrides_fk" FOREIGN KEY ("email_overrides_id") REFERENCES "public"."email_overrides"("id") ON DELETE cascade ON UPDATE no action;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payload_locked_documents_rels_email_override_history_fk') THEN
        ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_email_override_history_fk" FOREIGN KEY ("email_override_history_id") REFERENCES "public"."email_override_history"("id") ON DELETE cascade ON UPDATE no action;
      END IF;
    END $$;
    CREATE UNIQUE INDEX IF NOT EXISTS "email_overrides_template_id_idx" ON "email_overrides" USING btree ("template_id");
    CREATE INDEX IF NOT EXISTS "email_overrides_published_by_idx" ON "email_overrides" USING btree ("published_by_id");
    CREATE INDEX IF NOT EXISTS "email_overrides_draft_updated_by_idx" ON "email_overrides" USING btree ("draft_updated_by_id");
    CREATE INDEX IF NOT EXISTS "email_overrides_updated_at_idx" ON "email_overrides" USING btree ("updated_at");
    CREATE INDEX IF NOT EXISTS "email_overrides_created_at_idx" ON "email_overrides" USING btree ("created_at");
    CREATE INDEX IF NOT EXISTS "email_override_history_template_id_idx" ON "email_override_history" USING btree ("template_id");
    CREATE INDEX IF NOT EXISTS "email_override_history_author_idx" ON "email_override_history" USING btree ("author_id");
    CREATE INDEX IF NOT EXISTS "email_override_history_updated_at_idx" ON "email_override_history" USING btree ("updated_at");
    CREATE INDEX IF NOT EXISTS "email_override_history_created_at_idx" ON "email_override_history" USING btree ("created_at");
    CREATE INDEX IF NOT EXISTS "payload_locked_documents_rels_email_overrides_id_idx" ON "payload_locked_documents_rels" USING btree ("email_overrides_id");
    CREATE INDEX IF NOT EXISTS "payload_locked_documents_rels_email_override_history_id_idx" ON "payload_locked_documents_rels" USING btree ("email_override_history_id");
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_email_overrides_fk";
    ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_email_override_history_fk";
    DROP INDEX IF EXISTS "payload_locked_documents_rels_email_overrides_id_idx";
    DROP INDEX IF EXISTS "payload_locked_documents_rels_email_override_history_id_idx";
    ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "email_overrides_id";
    ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "email_override_history_id";
    DROP TABLE IF EXISTS "email_override_history" CASCADE;
    DROP TABLE IF EXISTS "email_overrides" CASCADE;
    DROP TYPE IF EXISTS "public"."enum_email_override_history_action";
    ALTER TABLE "email_content" DROP COLUMN IF EXISTS "email_settings_sender_name";
    ALTER TABLE "email_content" DROP COLUMN IF EXISTS "email_settings_sign_off_name";
    ALTER TABLE "email_content" DROP COLUMN IF EXISTS "email_settings_sign_off_help";
    ALTER TABLE "email_content" DROP COLUMN IF EXISTS "email_settings_company_line";
  `)
}
