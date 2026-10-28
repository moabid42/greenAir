# Infrastructure boundary

Future local/deployment configuration belongs here. Nothing is provisioned yet;
the FastAPI scaffold runs independently.

The [target architecture](../docs/architecture.md) calls for PostgreSQL with
PostGIS and TimescaleDB, a replayable event bus, optional Redis caching, and a
vector-tile server. Select compatible database extensions/images and decide the
bus implementation alongside the first data slice before adding Compose or
deployment manifests. Add object storage only when raw payload retention needs
it. Keep credentials in ignored environment files.
