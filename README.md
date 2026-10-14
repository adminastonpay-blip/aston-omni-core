# ASTON OS Omni-Matrix Apex — Extreme Edition 8.0.0

Universal Edge Engine on Cloudflare Workers.

## Features

- 8 global macrosectors (primary, industry, infra, fintech, govtech, health, mobility, media)
- JWT + Bearer token auth with scopes
- Durable Objects: sessions, rate limiting, ledger locks
- Workers AI with model fallbacks + streaming (SSE)
- Tool calling (search_records, create_record, execute_ledger)
- Vectorize RAG multi-tenant
- D1 dual (primary + backup) + R2 data lake + Queues
- Audit log + usage counters + semantic search + stats

## Setup

```bash
npm install
npx wrangler secret put ASTON_API_TOKEN
npx wrangler secret put ASTON_JWT_SECRET
npm run db:init
# Create Vectorize index once:
# npx wrangler vectorize create aston-omni-index --dimensions=768 --metric=cosine
npm run deploy
```

## Main endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | No | Status |
| GET | `/health` | No | Diagnostics |
| POST | `/v1/auth/token` | API Key | Issue JWT |
| POST | `/v1/ingest/:sector` | Yes | Universal ingest + RAG index |
| POST | `/v1/ai/chat` | Yes (or public) | AI chat + streaming + tools |
| GET/POST | `/v1/records/:sector` | Yes | Sector records |
| POST | `/v1/ledger` | Yes | Ledger tx with DO lock |
| POST | `/v1/search` | Yes | Semantic search (Vectorize) |
| GET | `/v1/stats` | Yes | Tenant usage stats |
| GET | `/v1/audit` | Yes | Audit log |

## Auth

```bash
# Get JWT
curl -X POST https://YOUR_WORKER/v1/auth/token \
  -H "Content-Type: application/json" \
  -d '{"api_key":"YOUR_TOKEN","tenant":"acme","scopes":["read","write","ai","admin"]}'

# Use JWT
curl https://YOUR_WORKER/v1/records/fintech \
  -H "Authorization: Bearer <jwt>"
```

## License

Private — ASTON OS
