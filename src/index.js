/**
 * ASTON OS Omni-Matrix Apex — Extreme Power Edition
 * Edition: 8.0.0-extreme
 *
 * Capas:
 * - JWT + Bearer + Scopes
 * - Durable Objects (sesiones, rate limit, ledger locks)
 * - Streaming AI (SSE) + Tool Calling
 * - Vectorize RAG multi-tenant
 * - Audit log + usage counters + stats + semantic search
 * - D1 dual + R2 + Queues (resiliencia)
 */

import { SignJWT, jwtVerify } from "jose";
import { AstonSession, AstonRateLimiter, AstonLedgerLock } from "./durable-objects.js";

export { AstonSession, AstonRateLimiter, AstonLedgerLock };

const C = {
  VERSION: "8.0.0-extreme",
  PLATFORM: "ASTON OS Extreme Edge",
  MAX_BODY: 1048576,
  SESSION_TTL: 2592000,
  MODEL_DEFAULT: "@cf/meta/llama-3.1-8b-instruct-fp8",
  AI_FALLBACKS: [
    "@cf/meta/llama-3.1-8b-instruct-fp8",
    "@cf/meta/llama-3.1-8b-instruct-fast",
    "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    "@cf/google/gemma-4-26b-a4b-it",
    "@cf/openai/gpt-oss-20b"
  ],
  EMBED_MODEL: "@cf/baai/bge-base-en-v1.5",
  MAX_TOKENS: 2048,
  SECTORS: ["primary", "industry", "infra", "fintech", "govtech", "health", "mobility", "media"]
};

export default {
  async fetch(request, env, ctx) {
    const requestId = crypto.randomUUID();
    if (request.method === "OPTIONS") return preflight(request, env);

    try {
      return await route(request, env, ctx, requestId);
    } catch (e) {
      console.error("[ASTON_EXTREME_EXCEPTION]", { requestId, error: safeMessage(e) });
      return json({ ok: false, error: "Extreme Core Exception", request_id: requestId }, 500, request, env);
    }
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(
      executeTelemetrySync(env, {
        type: "omni_scheduled_global_sync",
        cron: controller?.cron || null,
        timestamp: Date.now()
      }).catch((e) => console.error("[ASTON_CRON_FAIL]", safeMessage(e)))
    );
  },

  async queue(batch, env) {
    for (const message of batch.messages) {
      try {
        await processQueueMessage(message.body, env);
        message.ack();
      } catch (e) {
        console.error("[ASTON_QUEUE_RETRY]", safeMessage(e));
        message.retry();
      }
    }
  }
};

/* ═══════════════ ROUTER ═══════════════ */

async function route(req, env, ctx, rid) {
  const url = new URL(req.url);
  const p = url.pathname;

  if (p === "/" && req.method === "GET") {
    return json({
      ok: true,
      service: C.PLATFORM,
      edition: C.VERSION,
      edge_node: req.cf?.colo || "GLOBAL",
      status: "extreme-operational",
      supported_macrosectors: C.SECTORS,
      features: [
        "jwt-auth", "durable-objects", "streaming-ai", "tool-calling",
        "vectorize-rag", "audit-log", "semantic-search", "stats"
      ]
    }, 200, req, env);
  }

  if (p === "/health" || p === "/health-diagnostic") {
    return healthDiagnostics(req, env);
  }

  if (p === "/v1/auth/token" && req.method === "POST") {
    return issueToken(req, env, rid);
  }

  const publicPaths = ["/", "/health", "/health-diagnostic", "/v1/auth/token"];
  const isPublicChat =
    ["/v1/ai/chat", "/api/chat", "/chat"].includes(p) && env.ASTON_PUBLIC_CHAT === "true";

  let auth = { tenant: "global-default", scopes: [], sub: "anonymous", mode: "none" };

  if (!publicPaths.includes(p) && !isPublicChat) {
    auth = await authenticate(req, env);
    if (auth.error) return json({ ok: false, error: auth.error }, 401, req, env);

    if (env.ASTON_RATE_LIMITER && auth.tenant) {
      const allowed = await checkRateLimit(env, auth.tenant);
      if (!allowed) return json({ ok: false, error: "Rate limit exceeded" }, 429, req, env);
    }
  } else if (isPublicChat) {
    const tryAuth = await authenticate(req, env);
    if (!tryAuth.error) auth = tryAuth;
  }

  if (p.startsWith("/v1/ingest/")) {
    if (req.method !== "POST") return methodNotAllowed(req, env, ["POST"]);
    if (!hasScope(auth, "write")) return json({ ok: false, error: "Insufficient scope" }, 403, req, env);
    return handleUniversalIngest(req, env, ctx, rid, p.split("/")[3], auth);
  }

  if (["/v1/ai/chat", "/api/chat", "/chat"].includes(p)) {
    if (req.method !== "POST") return methodNotAllowed(req, env, ["POST"]);
    if (!isPublicChat && !hasScope(auth, "ai") && !hasScope(auth, "read")) {
      return json({ ok: false, error: "Insufficient scope" }, 403, req, env);
    }
    return handleNeuralChat(req, env, ctx, rid, auth);
  }

  if (p.startsWith("/v1/records")) {
    const raw = p.split("/")[3] || "general";
    const sector = C.SECTORS.includes(raw) ? raw : "general";
    return handleSectorRecords(req, env, ctx, rid, sector, auth);
  }

  if (p === "/v1/ledger" && req.method === "POST") {
    if (!hasScope(auth, "write")) return json({ ok: false, error: "Insufficient scope" }, 403, req, env);
    return handleLedgerTransaction(req, env, ctx, rid, auth);
  }

  if (p === "/v1/search" && req.method === "POST") {
    if (!hasScope(auth, "read")) return json({ ok: false, error: "Insufficient scope" }, 403, req, env);
    return handleSemanticSearch(req, env, rid, auth);
  }

  if (p === "/v1/stats" && req.method === "GET") {
    if (!hasScope(auth, "read")) return json({ ok: false, error: "Insufficient scope" }, 403, req, env);
    return handleStats(req, env, rid, auth);
  }

  if (p === "/v1/audit" && req.method === "GET") {
    if (!hasScope(auth, "admin") && !hasScope(auth, "read")) {
      return json({ ok: false, error: "Insufficient scope" }, 403, req, env);
    }
    return handleAuditList(req, env, rid, auth);
  }

  return json({ ok: false, error: "Endpoint not found", request_id: rid }, 404, req, env);
}

/* ═══════════════ AUTH ═══════════════ */

async function authenticate(req, env) {
  const header = req.headers.get("Authorization") || "";
  if (!header.startsWith("Bearer ")) {
    return { error: "Missing or invalid Authorization header" };
  }
  const token = header.slice(7);

  // 1) JWT
  if (env.ASTON_JWT_SECRET) {
    try {
      const secret = new TextEncoder().encode(env.ASTON_JWT_SECRET);
      const { payload } = await jwtVerify(token, secret);
      return {
        tenant: String(payload.tenant || req.headers.get("X-Aston-Tenant") || "global-default").slice(0, 100),
        scopes: Array.isArray(payload.scopes) ? payload.scopes : ["read", "write", "ai"],
        sub: String(payload.sub || "service"),
        mode: "jwt"
      };
    } catch (_) {
      /* fall through to static token */
    }
  }

  // 2) Static API token (legacy / bootstrap)
  if (env.ASTON_API_TOKEN && safeEqual(header, `Bearer ${env.ASTON_API_TOKEN}`)) {
    const tenant = (req.headers.get("X-Aston-Tenant") || "global-default").slice(0, 100);
    return { tenant, scopes: ["read", "write", "ai", "admin"], sub: "api-token", mode: "bearer" };
  }

  return { error: "Invalid or expired token" };
}

async function issueToken(req, env, rid) {
  const parsed = await readBody(req);
  if (!parsed.ok) return json({ ok: false, error: parsed.error }, parsed.status, req, env);

  const apiKey = parsed.data.api_key;
  if (!env.ASTON_API_TOKEN || !safeEqual(String(apiKey || ""), env.ASTON_API_TOKEN)) {
    return json({ ok: false, error: "Invalid API Key" }, 401, req, env);
  }

  if (!env.ASTON_JWT_SECRET) {
    return json({ ok: false, error: "ASTON_JWT_SECRET not configured" }, 503, req, env);
  }

  const tenant = String(parsed.data.tenant || "global-default").slice(0, 100);
  const scopes = Array.isArray(parsed.data.scopes)
    ? parsed.data.scopes.map(String)
    : ["read", "write", "ai"];

  const secret = new TextEncoder().encode(env.ASTON_JWT_SECRET);
  const token = await new SignJWT({ tenant, scopes, sub: parsed.data.sub || "service" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("24h")
    .sign(secret);

  await writeAudit(env, {
    tenant,
    actor: "auth",
    action: "issue_token",
    resource: "jwt",
    detail: { scopes },
    request_id: rid
  });

  return json({ ok: true, token, expires_in: 86400, tenant, scopes }, 200, req, env);
}

function hasScope(auth, scope) {
  if (!auth || auth.error) return false;
  if (auth.mode === "none") return false;
  return auth.scopes?.includes(scope) || auth.scopes?.includes("admin");
}

/* ═══════════════ RATE LIMIT (DO) ═══════════════ */

async function checkRateLimit(env, tenant) {
  try {
    const id = env.ASTON_RATE_LIMITER.idFromName(tenant);
    const stub = env.ASTON_RATE_LIMITER.get(id);
    const res = await stub.fetch("https://do/check", { method: "POST" });
    const data = await res.json();
    return data.allowed === true;
  } catch (e) {
    console.warn("[RATE_LIMIT_FAIL]", safeMessage(e));
    return true; // fail open
  }
}

/* ═══════════════ INGEST ═══════════════ */

async function handleUniversalIngest(req, env, ctx, rid, sector, auth) {
  const targetSector = C.SECTORS.includes(sector) ? sector : "general";
  const parsed = await readBody(req);
  if (!parsed.ok) return json({ ok: false, error: parsed.error }, parsed.status, req, env);

  const packetId =
    typeof parsed.data.packet_id === "string" && parsed.data.packet_id.length <= 100
      ? parsed.data.packet_id.replace(/[^a-zA-Z0-9_-]/g, "")
      : crypto.randomUUID();
  const payload = parsed.data.payload || parsed.data;
  const tenant = auth.tenant;

  if (env.EVENTS) {
    ctx.waitUntil(
      env.EVENTS.send({
        type: `omni_ingest_${targetSector}`,
        packet_id: packetId,
        sector: targetSector,
        tenant,
        payload,
        timestamp: Date.now()
      }).catch((e) => console.error("[INGEST_QUEUE_FAIL]", safeMessage(e)))
    );
  }

  if (env.ASTON_R2) {
    const key = `datalake/${tenant}/${targetSector}/${new Date().toISOString().slice(0, 10)}/${packetId}.json`;
    ctx.waitUntil(
      env.ASTON_R2.put(
        key,
        JSON.stringify({ packet_id: packetId, sector: targetSector, tenant, payload, ingested_at: Date.now() }),
        { httpMetadata: { contentType: "application/json" } }
      ).catch((e) => console.error("[INGEST_R2_FAIL]", safeMessage(e)))
    );
  }

  if (env.VECTORIZE && env.AI) {
    ctx.waitUntil(
      indexForRAG(env, {
        id: packetId,
        tenant,
        sector: targetSector,
        text: JSON.stringify(payload).slice(0, 8000)
      })
    );
  }

  ctx.waitUntil(bumpUsage(env, tenant, "ingest_packets"));
  ctx.waitUntil(
    writeAudit(env, {
      tenant,
      actor: auth.sub,
      action: "ingest",
      resource: targetSector,
      detail: { packet_id: packetId },
      request_id: rid
    })
  );

  return json(
    {
      ok: true,
      status: "packet_secured_in_edge",
      sector: targetSector,
      packet_id: packetId,
      tenant,
      node: req.cf?.colo || "EDGE",
      request_id: rid
    },
    202,
    req,
    env
  );
}

/* ═══════════════ AI CHAT + STREAMING + TOOLS ═══════════════ */

async function handleNeuralChat(req, env, ctx, rid, auth) {
  if (!env.AI) return json({ ok: false, error: "Workers AI binding missing" }, 503, req, env);

  const parsed = await readBody(req);
  if (!parsed.ok) return json({ ok: false, error: parsed.error }, parsed.status, req, env);

  const message = typeof parsed.data.message === "string" ? parsed.data.message.trim() : "";
  if (!message) return json({ ok: false, error: "Field 'message' is required" }, 400, req, env);
  if (message.length > 8000) return json({ ok: false, error: "Message too long" }, 413, req, env);

  const sid =
    typeof parsed.data.session_id === "string" && /^[a-zA-Z0-9_-]{8,64}$/.test(parsed.data.session_id)
      ? parsed.data.session_id
      : crypto.randomUUID();
  const stream = parsed.data.stream === true;
  const tenant = auth.tenant || "global-default";

  const history = await getSessionHistory(env, sid);

  let context = "";
  if (env.VECTORIZE && env.AI) {
    const matches = await semanticSearch(env, tenant, message, 5);
    if (matches.length) {
      context =
        "\n\nRelevant knowledge:\n" + matches.map((m) => `- ${m.text}`).join("\n");
    }
  }

  const systemPrompt = `You are ASTON OS Extreme, global intelligence on the Cloudflare Edge.
Tenant: ${tenant}. Respect tenant isolation.
You can reason about records, ledger and multi-sector data.${context}`;

  const messages = [
    { role: "system", content: systemPrompt },
    ...history,
    { role: "user", content: message }
  ];

  // Tool definitions (executed server-side when model returns tool hints in text)
  const toolsHint =
    "\nAvailable tools (reply with TOOL:name{json} if needed): search_records, create_record, execute_ledger.";

  let answer = "";
  let modelUsed = "";
  const candidates = [
    typeof parsed.data.model === "string" ? parsed.data.model : null,
    env.ASTON_AI_MODEL,
    C.MODEL_DEFAULT,
    ...C.AI_FALLBACKS
  ]
    .filter(Boolean)
    .filter((m, i, a) => a.indexOf(m) === i);

  for (const model of candidates) {
    try {
      const res = await env.AI.run(model, {
        messages: [
          ...messages.slice(0, -1),
          { role: "user", content: message + toolsHint }
        ],
        max_tokens: C.MAX_TOKENS
      });
      answer = extractText(res);
      if (answer) {
        modelUsed = model;
        break;
      }
    } catch (e) {
      console.warn(`[AI_FALLBACK] ${model}: ${safeMessage(e)}`);
    }
  }

  if (!answer) return json({ ok: false, error: "All neural models failed", request_id: rid }, 502, req, env);

  // Simple tool execution if model emitted TOOL:...
  const toolMatch = answer.match(/TOOL:(search_records|create_record|execute_ledger)\s*(\{[\s\S]*?\})/i);
  if (toolMatch) {
    const toolResult = await executeTool(env, ctx, rid, auth, toolMatch[1], toolMatch[2]);
    answer += `\n\n[Tool ${toolMatch[1]} result]: ${JSON.stringify(toolResult).slice(0, 2000)}`;
  }

  ctx.waitUntil(saveSessionHistory(env, sid, message, answer));
  ctx.waitUntil(bumpUsage(env, tenant, "ai_calls"));

  if (stream) {
    return sseStream(answer, { session_id: sid, model: modelUsed, request_id: rid });
  }

  return json(
    { ok: true, request_id: rid, session_id: sid, answer, model: modelUsed, tenant },
    200,
    req,
    env
  );
}

async function executeTool(env, ctx, rid, auth, name, jsonStr) {
  let args = {};
  try {
    args = JSON.parse(jsonStr);
  } catch {
    return { ok: false, error: "Invalid tool args" };
  }

  if (name === "search_records") {
    const sector = C.SECTORS.includes(args.sector) ? args.sector : "general";
    const results = await readRecords(env, auth.tenant, sector);
    return { ok: true, data: results.slice(0, 20) };
  }

  if (name === "create_record" && hasScope(auth, "write")) {
    const id = crypto.randomUUID();
    const sector = C.SECTORS.includes(args.sector) ? args.sector : "general";
    const title = String(args.title || "AI Record").slice(0, 200);
    const payload = args.payload && typeof args.payload === "object" ? args.payload : {};
    const written = await writeWithFailover(
      env,
      "INSERT INTO enterprise_records (id, tenant_id, sector, title, payload) VALUES (?, ?, ?, ?, ?)",
      [id, auth.tenant, sector, title, JSON.stringify(payload)]
    );
    return { ok: !!written, id, sector };
  }

  if (name === "execute_ledger" && hasScope(auth, "write")) {
    return { ok: false, error: "Use /v1/ledger endpoint for transactions" };
  }

  return { ok: false, error: "Unknown or forbidden tool" };
}

function sseStream(text, meta) {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  (async () => {
    await writer.write(encoder.encode(`data: ${JSON.stringify({ meta })}\n\n`));
    const chunks = text.match(/.{1,48}/gs) || [text];
    for (const chunk of chunks) {
      await writer.write(encoder.encode(`data: ${JSON.stringify({ content: chunk })}\n\n`));
    }
    await writer.write(encoder.encode("data: [DONE]\n\n"));
    await writer.close();
  })();

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*"
    }
  });
}

/* ═══════════════ RECORDS ═══════════════ */

async function readRecords(env, tenant, sector) {
  const sql =
    "SELECT id, tenant_id, sector, title, payload, created_at FROM enterprise_records WHERE tenant_id = ? AND sector = ? AND (deleted_at IS NULL OR deleted_at = '') ORDER BY created_at DESC LIMIT 100";
  for (const db of [env.ASTON_DB, env.ASTON_DB_BACKUP]) {
    if (!db) continue;
    try {
      const r = await db.prepare(sql).bind(tenant, sector).all();
      if (r.results?.length) return r.results;
    } catch (e) {
      console.warn("[RECORDS_READ_FAIL]", safeMessage(e));
    }
  }
  return [];
}

async function handleSectorRecords(req, env, ctx, rid, sector, auth) {
  const tenant = auth.tenant;

  if (req.method === "GET") {
    if (!hasScope(auth, "read")) return json({ ok: false, error: "Insufficient scope" }, 403, req, env);
    const results = await readRecords(env, tenant, sector);
    return json({ ok: true, request_id: rid, sector, data: results }, 200, req, env);
  }

  if (req.method === "POST") {
    if (!hasScope(auth, "write")) return json({ ok: false, error: "Insufficient scope" }, 403, req, env);
    const parsed = await readBody(req);
    if (!parsed.ok) return json({ ok: false, error: parsed.error }, parsed.status, req, env);

    const id = crypto.randomUUID();
    const title =
      typeof parsed.data.title === "string" ? parsed.data.title.slice(0, 200) : "Omni Strategic Record";
    const payload =
      parsed.data.payload && typeof parsed.data.payload === "object" ? parsed.data.payload : {};

    const written = await writeWithFailover(
      env,
      "INSERT INTO enterprise_records (id, tenant_id, sector, title, payload) VALUES (?, ?, ?, ?, ?)",
      [id, tenant, sector, title, JSON.stringify(payload)]
    );

    if (env.ASTON_R2) {
      ctx.waitUntil(
        env.ASTON_R2.put(
          `records/${tenant}/${sector}/${id}.json`,
          JSON.stringify({ id, tenant, sector, title, payload })
        ).catch((e) => console.error("[RECORDS_R2_FAIL]", safeMessage(e)))
      );
    }

    if (env.VECTORIZE && env.AI) {
      ctx.waitUntil(
        indexForRAG(env, {
          id,
          tenant,
          sector,
          text: `${title} ${JSON.stringify(payload)}`.slice(0, 8000)
        })
      );
    }

    ctx.waitUntil(
      writeAudit(env, {
        tenant,
        actor: auth.sub,
        action: "create_record",
        resource: sector,
        detail: { id, title },
        request_id: rid
      })
    );

    return json(
      written
        ? { ok: true, request_id: rid, id, sector, stored_in: written }
        : { ok: false, error: "Could not persist record", request_id: rid },
      written ? 201 : 500,
      req,
      env
    );
  }

  return methodNotAllowed(req, env, ["GET", "POST"]);
}

/* ═══════════════ LEDGER + LOCK ═══════════════ */

async function handleLedgerTransaction(req, env, ctx, rid, auth) {
  const parsed = await readBody(req);
  if (!parsed.ok) return json({ ok: false, error: parsed.error }, parsed.status, req, env);

  const { sender, recipient, currency, metadata } = parsed.data;
  const amount = Number(parsed.data.amount);

  if (typeof sender !== "string" || typeof recipient !== "string" || !sender || !recipient) {
    return json({ ok: false, error: "Fields 'sender' and 'recipient' are required strings" }, 400, req, env);
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return json({ ok: false, error: "Field 'amount' must be a positive number" }, 400, req, env);
  }

  const tenant = auth.tenant;
  let lockStub = null;

  if (env.ASTON_LEDGER_LOCK) {
    try {
      const lockId = env.ASTON_LEDGER_LOCK.idFromName(`${tenant}:${sender}`);
      lockStub = env.ASTON_LEDGER_LOCK.get(lockId);
      const lockRes = await lockStub.fetch("https://do/acquire", { method: "POST" });
      const lockData = await lockRes.json();
      if (!lockData.acquired) {
        return json({ ok: false, error: "Could not acquire ledger lock" }, 409, req, env);
      }
    } catch (e) {
      console.warn("[LEDGER_LOCK_FAIL]", safeMessage(e));
    }
  }

  try {
    const txId = crypto.randomUUID();
    const cur =
      typeof currency === "string" && /^[A-Za-z]{3,10}$/.test(currency)
        ? currency.toUpperCase()
        : "USD";
    const meta = metadata && typeof metadata === "object" ? metadata : {};

    const written = await writeWithFailover(
      env,
      "INSERT INTO ledger_transactions (id, tenant_id, sender, recipient, amount, currency, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [txId, tenant, sender.slice(0, 200), recipient.slice(0, 200), amount, cur, JSON.stringify(meta)]
    );

    if (!written) {
      return json(
        { ok: false, error: "Ledger write failed; transaction NOT recorded", request_id: rid },
        503,
        req,
        env
      );
    }

    if (env.ASTON_R2) {
      ctx.waitUntil(
        env.ASTON_R2.put(
          `ledger/${tenant}/${txId}.json`,
          JSON.stringify({
            tx_id: txId,
            tenant,
            sender,
            recipient,
            amount,
            currency: cur,
            metadata: meta,
            timestamp: Date.now()
          })
        ).catch((e) => console.error("[LEDGER_R2_FAIL]", safeMessage(e)))
      );
    }

    ctx.waitUntil(bumpUsage(env, tenant, "ledger_txs"));
    ctx.waitUntil(
      writeAudit(env, {
        tenant,
        actor: auth.sub,
        action: "ledger_tx",
        resource: txId,
        detail: { sender, recipient, amount, currency: cur },
        request_id: rid
      })
    );

    return json(
      { ok: true, status: "settled_at_edge", stored_in: written, transaction_id: txId, request_id: rid },
      201,
      req,
      env
    );
  } finally {
    if (lockStub) {
      try {
        await lockStub.fetch("https://do/release", { method: "POST" });
      } catch (_) {}
    }
  }
}

/* ═══════════════ VECTORIZE RAG ═══════════════ */

async function indexForRAG(env, { id, tenant, sector, text }) {
  try {
    const embedding = await env.AI.run(C.EMBED_MODEL, { text: [text] });
    const values = embedding?.data?.[0];
    if (!values) return;
    await env.VECTORIZE.upsert([
      {
        id: String(id),
        values,
        metadata: { tenant, sector, text: text.slice(0, 1000) }
      }
    ]);
  } catch (e) {
    console.warn("[VECTORIZE_INDEX_FAIL]", safeMessage(e));
  }
}

async function semanticSearch(env, tenant, query, topK = 5) {
  try {
    const embedding = await env.AI.run(C.EMBED_MODEL, { text: [query] });
    const values = embedding?.data?.[0];
    if (!values) return [];
    const results = await env.VECTORIZE.query(values, {
      topK,
      filter: { tenant },
      returnMetadata: true
    });
    return (results.matches || []).map((m) => ({
      id: m.id,
      score: m.score,
      text: m.metadata?.text || ""
    }));
  } catch (e) {
    console.warn("[VECTORIZE_SEARCH_FAIL]", safeMessage(e));
    return [];
  }
}

async function handleSemanticSearch(req, env, rid, auth) {
  const parsed = await readBody(req);
  if (!parsed.ok) return json({ ok: false, error: parsed.error }, parsed.status, req, env);
  const query = parsed.data.query;
  if (!query || typeof query !== "string") {
    return json({ ok: false, error: "query is required" }, 400, req, env);
  }
  if (!env.VECTORIZE || !env.AI) {
    return json({ ok: false, error: "Vectorize or AI not configured" }, 503, req, env);
  }
  const results = await semanticSearch(env, auth.tenant, query, parsed.data.topK || 8);
  return json({ ok: true, request_id: rid, results }, 200, req, env);
}

/* ═══════════════ STATS + AUDIT ═══════════════ */

async function handleStats(req, env, rid, auth) {
  const day = new Date().toISOString().slice(0, 10);
  let row = null;
  if (env.ASTON_DB) {
    try {
      row = await env.ASTON_DB.prepare(
        "SELECT * FROM usage_counters WHERE tenant_id = ? AND day = ?"
      )
        .bind(auth.tenant, day)
        .first();
    } catch (_) {}
  }
  return json(
    {
      ok: true,
      request_id: rid,
      tenant: auth.tenant,
      day,
      usage: row || { requests: 0, ai_calls: 0, ingest_packets: 0, ledger_txs: 0 }
    },
    200,
    req,
    env
  );
}

async function handleAuditList(req, env, rid, auth) {
  let results = [];
  if (env.ASTON_DB) {
    try {
      const r = await env.ASTON_DB.prepare(
        "SELECT id, tenant_id, actor, action, resource, detail, request_id, created_at FROM audit_log WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 50"
      )
        .bind(auth.tenant)
        .all();
      results = r.results || [];
    } catch (_) {}
  }
  return json({ ok: true, request_id: rid, data: results }, 200, req, env);
}

async function writeAudit(env, { tenant, actor, action, resource, detail, request_id }) {
  if (!env.ASTON_DB) return;
  try {
    await env.ASTON_DB.prepare(
      "INSERT INTO audit_log (id, tenant_id, actor, action, resource, detail, request_id) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
      .bind(
        crypto.randomUUID(),
        tenant || "global",
        actor || "system",
        action,
        resource || "",
        JSON.stringify(detail || {}),
        request_id || ""
      )
      .run();
  } catch (e) {
    console.warn("[AUDIT_FAIL]", safeMessage(e));
  }
}

async function bumpUsage(env, tenant, field) {
  if (!env.ASTON_DB || !tenant) return;
  const day = new Date().toISOString().slice(0, 10);
  const allowed = ["requests", "ai_calls", "ingest_packets", "ledger_txs"];
  if (!allowed.includes(field)) return;
  try {
    await env.ASTON_DB.prepare(
      `INSERT INTO usage_counters (tenant_id, day, ${field}) VALUES (?, ?, 1)
       ON CONFLICT(tenant_id, day) DO UPDATE SET ${field} = ${field} + 1`
    )
      .bind(tenant, day)
      .run();
  } catch (e) {
    console.warn("[USAGE_FAIL]", safeMessage(e));
  }
}

/* ═══════════════ SESSION DO / KV FALLBACK ═══════════════ */

async function getSessionHistory(env, sid) {
  if (env.ASTON_SESSION) {
    try {
      const id = env.ASTON_SESSION.idFromName(sid);
      const stub = env.ASTON_SESSION.get(id);
      const res = await stub.fetch("https://do/history");
      const data = await res.json();
      return data.messages || [];
    } catch (e) {
      console.warn("[SESSION_DO_FAIL]", safeMessage(e));
    }
  }
  if (!env.ASTON_KV) return [];
  try {
    const s = await env.ASTON_KV.get(`session:${sid}`, "json");
    return Array.isArray(s?.messages) ? s.messages : [];
  } catch {
    return [];
  }
}

async function saveSessionHistory(env, sid, userMsg, aiMsg) {
  if (env.ASTON_SESSION) {
    try {
      const id = env.ASTON_SESSION.idFromName(sid);
      const stub = env.ASTON_SESSION.get(id);
      await stub.fetch("https://do/append", {
        method: "POST",
        body: JSON.stringify({ user: userMsg, assistant: aiMsg })
      });
      return;
    } catch (e) {
      console.warn("[SESSION_SAVE_DO_FAIL]", safeMessage(e));
    }
  }
  if (!env.ASTON_KV) return;
  const history = await getSessionHistory(env, sid);
  const updated = [
    ...history,
    { role: "user", content: userMsg },
    { role: "assistant", content: aiMsg }
  ].slice(-25);
  await env.ASTON_KV.put(`session:${sid}`, JSON.stringify({ messages: updated }), {
    expirationTtl: C.SESSION_TTL
  });
}

/* ═══════════════ HEALTH ═══════════════ */

async function healthDiagnostics(req, env) {
  const check = async (db) => {
    if (!db) return false;
    try {
      await db.prepare("SELECT 1").first();
      return true;
    } catch {
      return false;
    }
  };
  const primaryD1 = await check(env.ASTON_DB);
  const backupD1 = await check(env.ASTON_DB_BACKUP);
  const ok = primaryD1 || backupD1;

  return json(
    {
      ok,
      service: C.PLATFORM,
      version: C.VERSION,
      colo: req.cf?.colo || "GLOBAL",
      status_matrix: {
        primary_d1: primaryD1 ? "nominal" : "offline",
        backup_d1: backupD1 ? "nominal" : "offline",
        r2_data_lake: !!env.ASTON_R2,
        queues_engine: !!env.EVENTS,
        kv_sessions: !!env.ASTON_KV,
        workers_ai: !!env.AI,
        vectorize: !!env.VECTORIZE,
        durable_objects: !!(env.ASTON_SESSION && env.ASTON_RATE_LIMITER && env.ASTON_LEDGER_LOCK),
        jwt_configured: !!env.ASTON_JWT_SECRET,
        api_token_configured: !!env.ASTON_API_TOKEN
      }
    },
    ok ? 200 : 503,
    req,
    env
  );
}

/* ═══════════════ HELPERS ═══════════════ */

async function writeWithFailover(env, sql, params) {
  const targets = [
    ["primary", env.ASTON_DB],
    ["backup", env.ASTON_DB_BACKUP]
  ];
  for (const [name, db] of targets) {
    if (!db) continue;
    try {
      await db.prepare(sql).bind(...params).run();
      return name;
    } catch (e) {
      console.warn(`[WRITE_FAIL_${name.toUpperCase()}]`, safeMessage(e));
    }
  }
  return null;
}

function safeEqual(a, b) {
  const x = String(a);
  const y = String(b);
  if (x.length !== y.length) return false;
  let r = 0;
  for (let i = 0; i < x.length; i++) r |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return r === 0;
}

function extractText(o) {
  if (typeof o === "string") return o.trim();
  const t = o?.response || o?.text || o?.choices?.[0]?.message?.content || "";
  return typeof t === "string" ? t.trim() : "";
}

async function readBody(req) {
  try {
    const declared = Number(req.headers.get("Content-Length") || 0);
    if (declared > C.MAX_BODY) return { ok: false, error: "Payload too large", status: 413 };
    const text = await req.text();
    if (text.length > C.MAX_BODY) return { ok: false, error: "Payload too large", status: 413 };
    const data = JSON.parse(text || "{}");
    if (data === null || typeof data !== "object" || Array.isArray(data)) {
      return { ok: false, error: "JSON body must be an object", status: 400 };
    }
    return { ok: true, data, status: 200 };
  } catch {
    return { ok: false, error: "Invalid JSON Body", status: 400 };
  }
}

async function processQueueMessage(body, env) {
  if (env.ASTON_DB) {
    await env.ASTON_DB.prepare(
      "INSERT INTO events (id, payload, created_at) VALUES (?, ?, datetime('now'))"
    )
      .bind(crypto.randomUUID(), JSON.stringify(body))
      .run();
  }
}

async function executeTelemetrySync(env, payload) {
  if (env.EVENTS) await env.EVENTS.send(payload);
}

function preflight(req, env) {
  return new Response(null, { status: 204, headers: headersFor(req, env) });
}

function json(data, status, req, env) {
  const h = headersFor(req, env);
  h.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data), { status, headers: h });
}

function methodNotAllowed(req, env, methods) {
  const r = json({ ok: false, error: "Method Not Allowed" }, 405, req, env);
  r.headers.set("Allow", methods.join(", "));
  return r;
}

function headersFor(req, env) {
  const h = new Headers();
  h.set("Access-Control-Allow-Origin", env?.ASTON_ALLOWED_ORIGIN || "*");
  h.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  h.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Aston-Tenant");
  h.set("Vary", "Origin");
  h.set("Cache-Control", "no-store");
  h.set("X-Content-Type-Options", "nosniff");
  return h;
}

function safeMessage(e) {
  return typeof e?.message === "string" ? e.message.slice(0, 250) : "Unknown Error";
}
