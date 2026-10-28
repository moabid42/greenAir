# Database migrations

Future PostgreSQL schema and migration history live here. There are no migrations
or database connections yet. Add the migration tool alongside the first storage
implementation, then manage PostGIS/TimescaleDB extensions and schema changes
explicitly. Keep raw payload retention, normalized observations, segment geometry,
watermarks, and versioned scores distinct.

Validate the proposed idempotency key against actual source identity and geometry;
include source identity so unrelated providers' station IDs cannot collide.
