/**
 * ASTON OS Extreme — Durable Objects
 * AstonSession | AstonRateLimiter | AstonLedgerLock
 */

export class AstonSession {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/history") {
      const messages = (await this.state.storage.get("messages")) || [];
      return Response.json({ messages });
    }

    if (url.pathname === "/append" && request.method === "POST") {
      const body = await request.json();
      let messages = (await this.state.storage.get("messages")) || [];
      if (body.user) messages.push({ role: "user", content: String(body.user).slice(0, 8000) });
      if (body.assistant) messages.push({ role: "assistant", content: String(body.assistant).slice(0, 8000) });
      messages = messages.slice(-30);
      await this.state.storage.put("messages", messages);
      return Response.json({ ok: true, count: messages.length });
    }

    if (url.pathname === "/clear" && request.method === "POST") {
      await this.state.storage.delete("messages");
      return Response.json({ ok: true });
    }

    return new Response("Not found", { status: 404 });
  }
}

export class AstonRateLimiter {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const windowMs = 60_000;
    const limit = 120;
    const now = Date.now();
    const key = "bucket";

    let data = (await this.state.storage.get(key)) || { count: 0, reset: now + windowMs };

    if (now > data.reset) {
      data = { count: 0, reset: now + windowMs };
    }

    data.count += 1;
    await this.state.storage.put(key, data);

    return Response.json({
      allowed: data.count <= limit,
      remaining: Math.max(0, limit - data.count),
      reset_at: data.reset
    });
  }
}

export class AstonLedgerLock {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/acquire" && request.method === "POST") {
      const locked = await this.state.storage.get("locked");
      const lockedAt = await this.state.storage.get("locked_at");
      const now = Date.now();
      // Auto-release stale locks (>15s)
      if (locked && lockedAt && now - lockedAt > 15_000) {
        await this.state.storage.delete("locked");
        await this.state.storage.delete("locked_at");
      } else if (locked) {
        return Response.json({ acquired: false });
      }
      await this.state.storage.put("locked", true);
      await this.state.storage.put("locked_at", now);
      return Response.json({ acquired: true });
    }

    if (url.pathname === "/release" && request.method === "POST") {
      await this.state.storage.delete("locked");
      await this.state.storage.delete("locked_at");
      return Response.json({ released: true });
    }

    return new Response("Not found", { status: 404 });
  }
}
