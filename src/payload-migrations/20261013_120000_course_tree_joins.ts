import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * Courses already own sections through sections.course_id, and sections own
 * lessons through lessons.section_id. The old editable hasMany fields kept a
 * second, redundant pointer to the same children. Join fields now derive those
 * lists from the canonical child-to-parent foreign keys.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    DELETE FROM "courses_rels" WHERE "sections_id" IS NOT NULL;
    ALTER TABLE "courses_rels" DROP CONSTRAINT IF EXISTS "courses_rels_sections_fk";
    DROP INDEX IF EXISTS "courses_rels_sections_id_idx";
    ALTER TABLE "courses_rels" DROP COLUMN IF EXISTS "sections_id";
    DROP TABLE IF EXISTS "sections_rels" CASCADE;
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "courses_rels" ADD COLUMN IF NOT EXISTS "sections_id" integer;
    ALTER TABLE "courses_rels" ADD CONSTRAINT "courses_rels_sections_fk"
      FOREIGN KEY ("sections_id") REFERENCES "public"."sections"("id") ON DELETE cascade ON UPDATE no action;
    CREATE INDEX IF NOT EXISTS "courses_rels_sections_id_idx" ON "courses_rels" USING btree ("sections_id");
    INSERT INTO "courses_rels" ("order", "parent_id", "path", "sections_id")
      SELECT (ROW_NUMBER() OVER (PARTITION BY "course_id" ORDER BY "order", "id") - 1)::integer,
        "course_id", 'sections', "id" FROM "sections";
    CREATE TABLE IF NOT EXISTS "sections_rels" (
      "id" serial PRIMARY KEY NOT NULL,
      "order" integer,
      "parent_id" integer NOT NULL,
      "path" varchar NOT NULL,
      "lessons_id" integer
    );
    ALTER TABLE "sections_rels" ADD CONSTRAINT "sections_rels_parent_fk"
      FOREIGN KEY ("parent_id") REFERENCES "public"."sections"("id") ON DELETE cascade ON UPDATE no action;
    ALTER TABLE "sections_rels" ADD CONSTRAINT "sections_rels_lessons_fk"
      FOREIGN KEY ("lessons_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;
    CREATE INDEX "sections_rels_order_idx" ON "sections_rels" USING btree ("order");
    CREATE INDEX "sections_rels_parent_idx" ON "sections_rels" USING btree ("parent_id");
    CREATE INDEX "sections_rels_path_idx" ON "sections_rels" USING btree ("path");
    CREATE INDEX "sections_rels_lessons_id_idx" ON "sections_rels" USING btree ("lessons_id");
    INSERT INTO "sections_rels" ("order", "parent_id", "path", "lessons_id")
      SELECT (ROW_NUMBER() OVER (PARTITION BY "section_id" ORDER BY "order", "id") - 1)::integer,
        "section_id", 'lessons', "id" FROM "lessons" WHERE "section_id" IS NOT NULL;
  `)
}
