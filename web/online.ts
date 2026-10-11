// Online game library, from either
//  - a Google Drive folder shared by link, read with the owner's API key
//    (config: server 'drive:<folder id>', code = API key), or
//  - a private Cloudflare R2 bucket behind workers/library, which only answers to
//    the family passcode (config: server = its https address, code = passcode).
// Games are downloaded on request and imported like any zip.

const CONFIG_STORE = 'reelpocket.onlineLibrary';
const FETCHED_STORE = 'reelpocket.onlineFetched';
const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_PREFIX = 'drive:';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const MAX_DEPTH = 3;
const SITE_URL = 'https://rzshstyle.github.io/Reel-pocket/';

export const ONLINE_CHANGED = 'reelpocket-online-changed';

export interface OnlineConfig { server: string; code: string }

export interface OnlineGame {
  id: string;
  name: string;
  size: number;
  modified: string;
}

const driveFolder = (c: OnlineConfig): string | null =>
  (c.server.startsWith(DRIVE_PREFIX) ? c.server.slice(DRIVE_PREFIX.length) : null);

// A Drive folder link (or bare folder id) becomes 'drive:<id>'; anything else must be an https address.
export function serverFrom(text: string): string | null {
  let t = text.trim();
  if (!t) return null;
  const drive = t.match(/drive\.google\.com\/.*(?:\/folders\/|[?&]id=)([\w-]{10,})/);
  if (drive) return DRIVE_PREFIX + drive[1];
  if (t.startsWith(DRIVE_PREFIX)) return t;
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
  const folder = driveFolder(c);
  if (folder) {
    u.searchParams.set('library', folder);
    u.searchParams.set('key', c.code);
  } else {
    u.searchParams.set('server', c.server);
    u.searchParams.set('code', c.code);
  }
  return u.href;
}

export function configFromSetupLink(text: string): OnlineConfig | null {
  try {
    // Chat apps sometimes copy '&' as '&amp;'.
    const u = new URL(text.trim().replace(/&amp;/g, '&'));
    const folder = u.searchParams.get('library');
    const key = u.searchParams.get('key');
    if (folder && key) return { server: DRIVE_PREFIX + folder, code: key };
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

async function driveError(res: Response): Promise<Error> {
  let msg = `${res.status} ${res.statusText}`;
  try {
    const body = await res.json() as { error?: { message?: string } };
    if (body.error?.message) msg = body.error.message;
  } catch {  }
  if (res.status === 404) msg = 'Folder not found. Check it is shared as "Anyone with the link".';
  if (res.status === 400 || res.status === 403) msg = `Google refused the request: ${msg}`;
  return new Error(msg);
}

async function driveFetch(url: URL): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url.href, { credentials: 'omit' });
  } catch {
    throw new Error('Google Drive could not be reached. Check your connection.');
  }
  if (!res.ok) throw await driveError(res);
  return res;
}

async function listDriveFolder(c: OnlineConfig, folder: string, depth: number, out: OnlineGame[]): Promise<void> {
  let page: string | undefined;
  do {
    const u = new URL(DRIVE_API);
    u.searchParams.set('q', `'${folder}' in parents and trashed = false`);
    u.searchParams.set('fields', 'nextPageToken,files(id,name,size,mimeType,modifiedTime)');
    u.searchParams.set('pageSize', '1000');
    u.searchParams.set('key', c.code);
    if (page) u.searchParams.set('pageToken', page);
    const body = await (await driveFetch(u)).json() as {
      nextPageToken?: string;
      files: { id: string; name: string; size?: string; mimeType: string; modifiedTime: string }[];
    };
    for (const f of body.files) {
      if (f.mimeType === FOLDER_MIME) {
        if (depth < MAX_DEPTH) await listDriveFolder(c, f.id, depth + 1, out);
      } else if (/\.(zip|punnet)$/i.test(f.name)) {
        out.push({ id: f.id, name: f.name, size: Number(f.size ?? 0), modified: f.modifiedTime });
      }
    }
    page = body.nextPageToken;
  } while (page);
}

export async function listOnlineGames(c: OnlineConfig): Promise<OnlineGame[]> {
  const folder = driveFolder(c);
  if (folder) {
    const out: OnlineGame[] = [];
    await listDriveFolder(c, folder, 0, out);
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }
  const res = await call(c, '/list');
  const body = await res.json() as { key: string; size: number; uploaded: string }[];
  return body
    .map((o) => ({ id: o.key, name: o.key.split('/').pop() || o.key, size: o.size, modified: o.uploaded }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function downloadOnlineGame(c: OnlineConfig, g: OnlineGame): Promise<File> {
  if (driveFolder(c)) {
    const u = new URL(`${DRIVE_API}/${encodeURIComponent(g.id)}`);
    u.searchParams.set('alt', 'media');
    u.searchParams.set('key', c.code);
    return new File([await (await driveFetch(u)).blob()], g.name);
  }
  const res = await call(c, `/file/${encodeURIComponent(g.id)}`);
  return new File([await res.blob()], g.name);
}
