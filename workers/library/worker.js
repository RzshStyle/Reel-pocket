// Reel Pocket online library: a private R2 bucket of game zips, readable only with
// the family passcode (the PASSCODE secret). Upload games in the Cloudflare dashboard.
//   GET /list            -> [{ key, size, uploaded }]
//   GET /file/<key>      -> the zip
// Every request needs the header  x-library-code: <passcode>

const GAME = /\.(zip|punnet)$/i;

function allowedOrigin(origin) {
  if (!origin) return null;
  if (origin === 'https://rzshstyle.github.io' || origin === 'https://localhost') return origin;
  if (/^http:\/\/localhost(:\d+)?$/.test(origin)) return origin;
  return null;
}

function cors(req) {
  const origin = allowedOrigin(req.headers.get('origin'));
  return origin ? {
    'access-control-allow-origin': origin,
    'access-control-allow-headers': 'x-library-code',
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-max-age': '86400',
    vary: 'origin',
  } : {};
}

function sameText(a, b) {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

export default {
  async fetch(req, env) {
    const head = cors(req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: head });
    if (req.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: head });
    if (!env.PASSCODE || !sameText(req.headers.get('x-library-code') ?? '', env.PASSCODE)) {
      return new Response('Wrong passcode', { status: 401, headers: head });
    }
    const path = new URL(req.url).pathname;
    if (path === '/list') {
      const games = [];
      let cursor;
      do {
        const page = await env.GAMES.list({ cursor, limit: 1000 });
        for (const o of page.objects) {
          if (GAME.test(o.key)) games.push({ key: o.key, size: o.size, uploaded: o.uploaded.toISOString() });
        }
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);
      return Response.json(games, { headers: { ...head, 'cache-control': 'no-store' } });
    }
    if (path.startsWith('/file/')) {
      const key = decodeURIComponent(path.slice('/file/'.length));
      const obj = await env.GAMES.get(key);
      if (!obj) return new Response('Not found', { status: 404, headers: head });
      return new Response(obj.body, {
        headers: { ...head, 'content-type': 'application/zip', 'content-length': String(obj.size) },
      });
    }
    return new Response('Not found', { status: 404, headers: head });
  },
};
