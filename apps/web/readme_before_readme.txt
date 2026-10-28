Hi Mouad,

Before you start on the backend, please read README.md in this folder. It documents BOTH frontends:

  1. The public web client (the phone app)
     -> section "Expected API endpoints"
  2. The admin frontend (endpoint health, client data, settings)
     -> section "Admin frontend"

What we expect from your backend, in order of priority:

FIRST - the web client needs these to run on real data
  - GET /api/v1/day?date=YYYY-MM-DD
  - GET /api/v1/grid?date=YYYY-MM-DD
  - GET /api/v1/sensors
  They return factor scores per hour (heat, air, wind, traffic, light, safety; each 0-100,
  100 = best) plus the raw measurements. Please do NOT combine them into one score or apply
  sport weights: the app does that. Exact fields, rules and examples are in README.md
  ("Expected API endpoints", parts 4 and 5).
  Also: keep GET /health, serve gzip, answer bad or unknown dates with 404/422 (not an
  empty 200), set "source" honestly (measured / forecast / mock), and add the web AND the
  admin origins to GREENAIR_CORS_ORIGINS.

SECOND - optional, a proposal to agree on
  - Per-street scores: /scores, /score and vector tiles (README, part 6).

THIRD - the admin frontend
  - It already works without you: it checks your endpoints from the browser. For it to
    read status codes, its origin must be allowed by CORS.
  - Later, a server-side admin API under /api/v1/admin/* (endpoint registry and health,
    endpoint management, summary, client-data time series, recent uploads), behind
    authentication. README "Admin frontend", part A4. Nothing in the admin is access-
    protected until that exists.
  - The client-data numbers in the admin are SIMULATED. Real ones need an ingestion
    endpoint, and that needs a team decision on privacy first (the web client uploads
    nothing today). Please do not build it before we agree (README, A4.6).

Where the code is
  - Web client: apps/web, on branch web/ecomab-frontend.
  - Admin: apps/admin, on the same branch.

If anything in the README does not fit how the backend can work, tell us. We will change
the frontend or the document together. Please keep the README and the code in step with
whatever gets built.

Thanks!
Abdel
