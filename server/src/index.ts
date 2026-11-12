import type { Env } from './db';
import { HttpError, authenticate, claimGift, getSave, inbox, login, logout, me, putSave, register, sendGift } from './handlers';

const DEFAULT_ORIGINS = ['https://roentgenjon.github.io', 'http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:4173', 'http://127.0.0.1:4173'];
const MAX_BODY = 200_000;

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const allowed = env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()) : DEFAULT_ORIGINS;
  const origin = request.headers.get('Origin') ?? '';
  const h: Record<string, string> = { Vary: 'Origin' };
  if (allowed.includes(origin)) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Access-Control-Allow-Headers'] = 'Authorization, Content-Type';
    h['Access-Control-Allow-Methods'] = 'GET, POST, PUT, OPTIONS';
    h['Access-Control-Max-Age'] = '86400';
  }
  return h;
}

function json(data: unknown, status: number, request: Request, env: Env): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...corsHeaders(request, env) },
  });
}

async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.length > MAX_BODY) throw new HttpError(413, 'too_large');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'invalid_json');
  }
}

/** Alle Anfragen; `now` ist für Tests einstellbar. */
export async function handle(request: Request, env: Env, now: number = Date.now()): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env) });
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  const method = request.method;
  try {
    if (path === '/api/health' && method === 'GET') return json({ ok: true }, 200, request, env);
    if (path === '/api/register' && method === 'POST') return json(await register(env, await readJson(request), now), 201, request, env);
    if (path === '/api/login' && method === 'POST') return json(await login(env, await readJson(request), now), 200, request, env);

    const auth = await authenticate(request, env, now);
    if (path === '/api/logout' && method === 'POST') {
      await logout(env, request);
      return json({ ok: true }, 200, request, env);
    }
    if (path === '/api/me' && method === 'GET') return json(await me(env, auth), 200, request, env);
    if (path === '/api/save' && method === 'GET') return json(await getSave(env, auth), 200, request, env);
    if (path === '/api/save' && method === 'PUT') return json(await putSave(env, auth, await readJson(request), now), 200, request, env);
    if (path === '/api/send' && method === 'POST') return json(await sendGift(env, auth, await readJson(request), now), 200, request, env);
    if (path === '/api/inbox' && method === 'GET') return json(await inbox(env, auth), 200, request, env);
    if (path === '/api/inbox/claim' && method === 'POST') return json(await claimGift(env, auth, await readJson(request), now), 200, request, env);
    throw new HttpError(404, 'not_found');
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.code, ...e.extra }, e.status, request, env);
    return json({ error: 'internal' }, 500, request, env);
  }
}

export default {
  fetch: (request: Request, env: Env): Promise<Response> => handle(request, env),
};
