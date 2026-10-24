import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * Lesson captions (WebVTT from the Drive subtitle file), transcript and a has-captions flag; learner
 * player preferences and the exam extra-time accommodation.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "lessons_captions" (
      "_order" integer NOT NULL,
      "_parent_id" integer NOT NULL,
      "id" varchar PRIMARY KEY NOT NULL,
      "language" varchar DEFAULT 'en' NOT NULL,
      "label" varchar DEFAULT 'English' NOT NULL,
      "vtt" varchar NOT NULL,
      "source_file_id" varchar,
      "source_modified_time" varchar
    );
    ALTER TABLE "lessons" ADD COLUMN IF NOT EXISTS "transcript" varchar;
    ALTER TABLE "lessons" ADD COLUMN IF NOT EXISTS "has_captions" boolean DEFAULT false;
    ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "exam_time_multiplier" numeric DEFAULT 1;
    ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "preferences" jsonb;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lessons_captions_parent_id_fk') THEN
        ALTER TABLE "lessons_captions" ADD CONSTRAINT "lessons_captions_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;
      END IF;
    END $$;
    CREATE INDEX IF NOT EXISTS "lessons_captions_order_idx" ON "lessons_captions" USING btree ("_order");
    CREATE INDEX IF NOT EXISTS "lessons_captions_parent_id_idx" ON "lessons_captions" USING btree ("_parent_id");
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP TABLE IF EXISTS "lessons_captions" CASCADE;
    ALTER TABLE "lessons" DROP COLUMN IF EXISTS "transcript";
    ALTER TABLE "lessons" DROP COLUMN IF EXISTS "has_captions";
    ALTER TABLE "users" DROP COLUMN IF EXISTS "exam_time_multiplier";
    ALTER TABLE "users" DROP COLUMN IF EXISTS "preferences";
  `)
}
