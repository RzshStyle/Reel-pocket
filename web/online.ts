// Online game library: a private Cloudflare R2 bucket behind a small worker
// (workers/library) that only answers to the family passcode. Games are downloaded
// on request and imported like any zip.

const CONFIG_STORE = 'reelpocket.onlineLibrary';
const FETCHED_STORE = 'reelpocket.onlineFetched';
const SITE_URL = 'https://rzshstyle.github.io/Reel-pocket/';

export const ONLINE_CHANGED = 'reelpocket-online-changed';

export interface OnlineConfig { server: string; code: string }

export interface OnlineGame {
  id: string;
  name: string;
  size: number;
  modified: string;
}

export function serverFrom(text: string): string | null {
  let t = text.trim();
  if (!t) return null;
  if (!/^https?:\/\//i.test(t)) t = `https://${t}`;
  try {
    const u = new URL(t);
    return u.protocol === 'https:' || u.hostname === 'localhost' ? u.origin : null;
  } catch {
    return null;
  }
}

export function loadOnlineConfig(): OnlineConfig | null {
  try {
    const c = JSON.parse(localStorage.getItem(CONFIG_STORE) ?? 'null') as OnlineConfig | null;
    return c?.server && c.code ? c : null;
  } catch {
    return null;
  }
}

export function saveOnlineConfig(c: OnlineConfig | null): void {
  try {
    if (c) localStorage.setItem(CONFIG_STORE, JSON.stringify(c));
    else localStorage.removeItem(CONFIG_STORE);
  } catch {  }
  window.dispatchEvent(new Event(ONLINE_CHANGED));
}

// A link that sets up another device in one tap (website), or can be pasted into the app.
export function setupLink(c: OnlineConfig): string {
  // Inside the Android app the page lives on localhost, which is no use to another phone.
  const u = new URL(location.hostname === 'localhost' || !location.protocol.startsWith('http') ? SITE_URL : location.href);
  u.search = '';
  u.hash = '';
  u.searchParams.set('server', c.server);
  u.searchParams.set('code', c.code);
  return u.href;
}

export function configFromSetupLink(text: string): OnlineConfig | null {
  try {
    // Chat apps sometimes copy '&' as '&amp;'.
    const u = new URL(text.trim().replace(/&amp;/g, '&'));
    const server = serverFrom(u.searchParams.get('server') ?? '');
    const code = u.searchParams.get('code');
    return server && code ? { server, code } : null;
  } catch {
    return null;
  }
}

// Game key -> upload time when it was last fetched to this device.
function fetchedMap(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(FETCHED_STORE) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

export function isFetched(g: OnlineGame): boolean {
  return fetchedMap()[g.id] === g.modified;
}

export function markFetched(g: OnlineGame): void {
  const m = fetchedMap();
  m[g.id] = g.modified;
  try { localStorage.setItem(FETCHED_STORE, JSON.stringify(m)); } catch {  }
}

async function call(c: OnlineConfig, path: string): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${c.server}${path}`, { headers: { 'x-library-code': c.code }, credentials: 'omit' });
  } catch {
    throw new Error('The library could not be reached. Check the address and your connection.');
  }
  if (res.status === 401) throw new Error('Wrong passcode.');
  if (!res.ok) throw new Error(`The library answered ${res.status} ${res.statusText}`.trim());
  return res;
}

export async function listOnlineGames(c: OnlineConfig): Promise<OnlineGame[]> {
  const res = await call(c, '/list');
  const body = await res.json() as { key: string; size: number; uploaded: string }[];
  return body
    .map((o) => ({ id: o.key, name: o.key.split('/').pop() || o.key, size: o.size, modified: o.uploaded }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function downloadOnlineGame(c: OnlineConfig, g: OnlineGame): Promise<File> {
  const res = await call(c, `/file/${encodeURIComponent(g.id)}`);
  return new File([await res.blob()], g.name);
}
