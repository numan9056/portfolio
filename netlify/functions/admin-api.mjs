import { getStore } from "@netlify/blobs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Admin-Password",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

export default async (req) => {
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: CORS });

  const url    = new URL(req.url);
  const action = url.searchParams.get("action");
  const PASS   = process.env.ADMIN_PASSWORD;

  // ── PUBLIC: serve a stored image ─────────────────────────
  if (action === "image") {
    const key = url.searchParams.get("key");
    if (!key) return new Response("Missing key", { status: 400 });
    try {
      const store = getStore("portfolio-images");
      const { data, metadata } = await store.getWithMetadata(key, { type: "arrayBuffer" });
      if (!data) return new Response("Not found", { status: 404 });
      return new Response(data, {
        status: 200,
        headers: {
          "Content-Type": metadata?.contentType || "image/jpeg",
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  }

  // ── PUBLIC: get published projects (portfolio page) ───────
  if (action === "projects" && req.method === "GET") {
    const store = getStore("portfolio");
    const raw   = await store.get("projects").catch(() => null);
    const all   = raw ? JSON.parse(raw) : [];
    return json({ projects: all.filter((p) => p.published !== false) });
  }

  // ── AUTH CHECK ────────────────────────────────────────────
  const provided = req.headers.get("X-Admin-Password");
  if (!PASS || provided !== PASS) return json({ error: "Unauthorized" }, 401);

  // ── ADMIN: get all projects (including drafts) ────────────
  if (action === "admin-projects" && req.method === "GET") {
    const store = getStore("portfolio");
    const raw   = await store.get("projects").catch(() => null);
    return json({ projects: raw ? JSON.parse(raw) : [] });
  }

  // ── ADMIN: save projects list ─────────────────────────────
  if (action === "save" && req.method === "POST") {
    const { projects } = await req.json();
    const store = getStore("portfolio");
    await store.set("projects", JSON.stringify(projects || []));
    return json({ ok: true });
  }

  // ── ADMIN: upload image ───────────────────────────────────
  if (action === "upload" && req.method === "POST") {
    const form = await req.formData();
    const file = form.get("file");
    const key  = form.get("key") || `img-${Date.now()}.jpg`;
    if (!file) return json({ error: "No file provided" }, 400);
    const buffer = await file.arrayBuffer();
    const store  = getStore("portfolio-images");
    await store.set(key, buffer, { metadata: { contentType: file.type || "image/jpeg" } });
    return json({ ok: true, url: `/api/admin?action=image&key=${encodeURIComponent(key)}`, key });
  }

  return json({ error: "Not found" }, 404);
};

export const config = { path: "/api/admin" };
