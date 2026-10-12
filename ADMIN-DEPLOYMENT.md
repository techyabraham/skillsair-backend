# Payload admin service

The Express service remains the public SkillsAir API. The Payload admin panel runs as a separate Next.js service from the same repository and shares the same PostgreSQL database.

## Deploy in Coolify

1. Create a second application from this repository and branch.
2. Set its Dockerfile to `Dockerfile.admin` and expose port `3000`.
3. Assign a private admin domain such as `cms.skillsair.com`.
4. Add the same runtime `DATABASE_URI`, `REDIS_URL`, `PAYLOAD_SECRET`, `JWT_SECRET`, and `ENCRYPTION_KEY` used by the API service. Use the internal database and Redis URLs.
5. Add the R2 credentials used by the API if admins will upload media. Add the email settings if admins will send password reset messages.
6. Set `BACKEND_URL` to the admin service's public origin, for example `https://cms.skillsair.com`. Set `CORS_ORIGINS` to include that origin and the SkillsAir frontend origins.
7. Deploy and open `https://cms.skillsair.com/admin`.

The first-user screen can create the initial Payload admin when there are no users yet. Create that admin before importing WordPress users. Public registration only creates student accounts.

Run database migrations once from the API service using its `PAYLOAD_CONFIG_PATH`; do not run them independently from both services. After the first admin is created, use the Payload panel to manage courses, lessons, quizzes, users, and media.

## Media resizing

Sharp is installed and passed to the shared Payload config. Both Docker images install Sharp in their production dependencies, so Payload's configured media sizes are generated for uploads.
