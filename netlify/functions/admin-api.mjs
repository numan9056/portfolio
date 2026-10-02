import { getStore } from "@netlify/blobs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Admin-Password, Range",
};

// Netlify limits a single request/response to ~6 MB, so big files (videos,
// long images) are stored as several parts and served one part at a time.
const MAX_PART = 3 * 1024 * 1024;
const CACHE    = "public, max-age=31536000, immutable";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

const partKey = (key, i) => `${key}.part${i}`;

// Parse "bytes=start-end" against a known total size.
function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header || "");
  if (!m || (m[1] === "" && m[2] === "")) return null;
  let start, end;
  if (m[1] === "") {
    start = Math.max(0, size - Number(m[2]));
    end   = size - 1;
  } else {
    start = Number(m[1]);
    end   = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start > end || start >= size) return "invalid";
  return { start, end };
}

async function serveMedia(req, key) {
  const store = getStore("portfolio-images");
  const found = await store.getWithMetadata(key, { type: "arrayBuffer" });
  if (!found || !found.data) return new Response("Not found", { status: 404 });

  const meta        = found.metadata || {};
  const contentType = meta.contentType || "image/jpeg";
  const chunked     = Number(meta.parts) > 0;
  const size        = chunked ? Number(meta.size) : found.data.byteLength;
  const base        = { "Content-Type": contentType, "Cache-Control": CACHE, "Accept-Ranges": "bytes" };

  const range = parseRange(req.headers.get("Range"), size);
  if (range === "invalid") {
    return new Response("", { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  }

  // Whole small file, no range asked for.
  if (!range && !chunked) {
    return new Response(found.data, { status: 200, headers: { ...base, "Content-Length": String(size) } });
  }

  // Whole chunked file: stream the parts one after another.
  if (!range) {
    const parts = Number(meta.parts);
    let i = 0;
    const body = new ReadableStream({
      async pull(controller) {
        if (i >= parts) return controller.close();
        const buf = await store.get(partKey(key, i++), { type: "arrayBuffer" });
        if (!buf) return controller.error(new Error("Missing part"));
        controller.enqueue(new Uint8Array(buf));
      },
    });
    return new Response(body, { status: 200, headers: { ...base, "Content-Length": String(size) } });
  }

  // Ranged request (video players): answer with at most one part.
  let { start, end } = range;
  let bytes;
  if (chunked) {
    const partSize = Number(meta.partSize);
    const index    = Math.floor(start / partSize);
    const partFrom = index * partSize;
    const buf      = await store.get(partKey(key, index), { type: "arrayBuffer" });
    if (!buf) return new Response("Not found", { status: 404 });
    end   = Math.min(end, partFrom + buf.byteLength - 1);
    bytes = buf.slice(start - partFrom, end - partFrom + 1);
  } else {
    end   = Math.min(end, start + MAX_PART - 1);
    bytes = found.data.slice(start, end + 1);
  }
  return new Response(bytes, {
    status: 206,
    headers: {
      ...base,
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Content-Length": String(bytes.byteLength),
    },
  });
}

export default async (req) => {
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: CORS });

  const url    = new URL(req.url);
  const action = url.searchParams.get("action");
  const PASS   = process.env.ADMIN_PASSWORD;

  // ── PUBLIC: serve a stored image or video ────────────────
  if (action === "image") {
    const key = url.searchParams.get("key");
    if (!key) return new Response("Missing key", { status: 400 });
    try {
      return await serveMedia(req, key);
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

  // ── ADMIN: upload a small file in one request ─────────────
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

  // ── ADMIN: upload one part of a big file ──────────────────
  if (action === "upload-part" && req.method === "POST") {
    const form  = await req.formData();
    const file  = form.get("file");
    const key   = form.get("key");
    const index = Number(form.get("index"));
    if (!file || !key || !Number.isInteger(index) || index < 0) return json({ error: "Bad part" }, 400);
    const buffer = await file.arrayBuffer();
    if (buffer.byteLength > MAX_PART) return json({ error: "Part too large" }, 413);
    await getStore("portfolio-images").set(partKey(key, index), buffer);
    return json({ ok: true });
  }

  // ── ADMIN: finish a big file once every part is stored ────
  if (action === "upload-finish" && req.method === "POST") {
    const { key, parts, size, partSize, contentType } = await req.json();
    if (!key || !(parts > 0) || !(size > 0) || !(partSize > 0)) return json({ error: "Bad manifest" }, 400);
    await getStore("portfolio-images").set(key, "chunked", {
      metadata: { contentType: contentType || "application/octet-stream", parts, size, partSize },
    });
    return json({ ok: true, url: `/api/admin?action=image&key=${encodeURIComponent(key)}`, key });
  }

  return json({ error: "Not found" }, 404);
};

export const config = { path: "/api/admin" };
