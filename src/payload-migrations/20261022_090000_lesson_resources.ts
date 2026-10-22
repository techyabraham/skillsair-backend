import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/** Lesson resources: documents kept in Google Drive and streamed through the backend. */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "lessons_resources" (
      "_order" integer NOT NULL,
      "_parent_id" integer NOT NULL,
      "id" varchar PRIMARY KEY NOT NULL,
      "title" varchar NOT NULL,
      "drive_file_id" varchar NOT NULL,
      "mime_type" varchar
    );
    ALTER TABLE "lessons_resources" ADD CONSTRAINT "lessons_resources_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;
    CREATE INDEX IF NOT EXISTS "lessons_resources_order_idx" ON "lessons_resources" USING btree ("_order");
    CREATE INDEX IF NOT EXISTS "lessons_resources_parent_id_idx" ON "lessons_resources" USING btree ("_parent_id");
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP TABLE IF EXISTS "lessons_resources" CASCADE;
  `)
}
