# ASTON OS Omni-Core (v7.0.1)

Motor Edge multi-sector sobre Cloudflare Workers: ingesta universal, chat con Workers AI (con fallbacks), registros multi-tenant en D1 con failover, ledger y data lake en R2.

## Endpoints

| Ruta | Metodo | Auth |
|---|---|---|
| `/` | GET | publica |
| `/health` | GET | publica |
| `/v1/ingest/:sector` | POST | Bearer token |
| `/chat`, `/api/chat`, `/v1/ai/chat` | POST | Bearer token (o publico si `ASTON_PUBLIC_CHAT="true"`) |
| `/v1/records/:sector` | GET / POST | Bearer token + header `X-Aston-Tenant` |
| `/v1/ledger` | POST | Bearer token |

Sectores: `primary, industry, infra, fintech, govtech, health, mobility, media`.

## Instalacion

1. `npm install`
2. `npx wrangler login`
3. `npm run queue:create`
4. `npm run db:init`
5. `npx wrangler secret put ASTON_API_TOKEN`
6. `npm run deploy`

## Deploy automatico con GitHub Actions

En el repo: Settings -> Secrets and variables -> Actions -> New repository secret:

- `CLOUDFLARE_API_TOKEN` (plantilla "Edit Cloudflare Workers")
- `CLOUDFLARE_ACCOUNT_ID`

Cada push a `main` despliega el Worker. El secreto `ASTON_API_TOKEN` se configura una vez con el paso 5.

## Prueba rapida

```bash
curl https://aston-omni-core.<subdominio>.workers.dev/health

curl -X POST https://aston-omni-core.<subdominio>.workers.dev/v1/ledger \
  -H "Authorization: Bearer TU_TOKEN" -H "Content-Type: application/json" \
  -d '{"sender":"a","recipient":"b","amount":10}'
```

## Variables opcionales

- `ASTON_ALLOWED_ORIGIN`: origen CORS permitido (por defecto `*`)
- `ASTON_PUBLIC_CHAT`: `"true"` para chat sin token
- `ASTON_AI_MODEL`: modelo preferido de Workers AI

> Recomendado: repositorio **privado**.
