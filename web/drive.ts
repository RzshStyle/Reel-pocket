// Online game library: a Google Drive folder shared by link, read with an API key.
// Nothing is uploaded; games are downloaded on request and imported like any zip.

const CONFIG_STORE = 'reelpocket.driveLibrary';
const FETCHED_STORE = 'reelpocket.driveFetched';
const API = 'https://www.googleapis.com/drive/v3/files';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const MAX_DEPTH = 3;

export interface DriveConfig { folder: string; key: string }

export interface DriveGame {
  id: string;
  name: string;
  size: number;
  modified: string;
}

export function folderIdFrom(text: string): string | null {
  const t = text.trim();
  const m = t.match(/\/folders\/([\w-]{10,})/) ?? t.match(/[?&]id=([\w-]{10,})/);
  if (m) return m[1];
  return /^[\w-]{10,}$/.test(t) ? t : null;
}

export function loadDriveConfig(): DriveConfig | null {
  try {
    const c = JSON.parse(localStorage.getItem(CONFIG_STORE) ?? 'null') as DriveConfig | null;
    return c?.folder && c.key ? c : null;
  } catch {
    return null;
  }
}

export function saveDriveConfig(c: DriveConfig | null): void {
  try {
    if (c) localStorage.setItem(CONFIG_STORE, JSON.stringify(c));
    else localStorage.removeItem(CONFIG_STORE);
  } catch {  }
}

// A link that sets up another device in one tap (website), or can be pasted into the app.
const SITE_URL = 'https://rzshstyle.github.io/Reel-pocket/';

export function setupLink(c: DriveConfig): string {
  // Inside the Android app the page lives on localhost, which is no use to another phone.
  const u = new URL(location.hostname === 'localhost' || !location.protocol.startsWith('http') ? SITE_URL : location.href);
  u.search = '';
  u.hash = '';
  u.searchParams.set('library', c.folder);
  u.searchParams.set('key', c.key);
  return u.href;
}

export function configFromSetupLink(text: string): DriveConfig | null {
  try {
    const u = new URL(text.trim());
    const folder = u.searchParams.get('library');
    const key = u.searchParams.get('key');
    return folder && key ? { folder, key } : null;
  } catch {
    return null;
  }
}

// Drive file id -> modifiedTime when it was last fetched to this device.
function fetchedMap(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(FETCHED_STORE) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

export function isFetched(g: DriveGame): boolean {
  return fetchedMap()[g.id] === g.modified;
}

export function markFetched(g: DriveGame): void {
  const m = fetchedMap();
  m[g.id] = g.modified;
  try { localStorage.setItem(FETCHED_STORE, JSON.stringify(m)); } catch {  }
}

export function forgetFetched(): void {
  try { localStorage.removeItem(FETCHED_STORE); } catch {  }
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

async function listFolder(c: DriveConfig, folder: string, depth: number, out: DriveGame[]): Promise<void> {
  let page: string | undefined;
  do {
    const u = new URL(API);
    u.searchParams.set('q', `'${folder}' in parents and trashed = false`);
    u.searchParams.set('fields', 'nextPageToken,files(id,name,size,mimeType,modifiedTime)');
    u.searchParams.set('pageSize', '1000');
    u.searchParams.set('key', c.key);
    if (page) u.searchParams.set('pageToken', page);
    const res = await fetch(u.href, { credentials: 'omit' });
    if (!res.ok) throw await driveError(res);
    const body = await res.json() as {
      nextPageToken?: string;
      files: { id: string; name: string; size?: string; mimeType: string; modifiedTime: string }[];
    };
    for (const f of body.files) {
      if (f.mimeType === FOLDER_MIME) {
        if (depth < MAX_DEPTH) await listFolder(c, f.id, depth + 1, out);
      } else if (/\.(zip|punnet)$/i.test(f.name)) {
        out.push({ id: f.id, name: f.name, size: Number(f.size ?? 0), modified: f.modifiedTime });
      }
    }
    page = body.nextPageToken;
  } while (page);
}

export async function listDriveGames(c: DriveConfig): Promise<DriveGame[]> {
  const out: DriveGame[] = [];
  await listFolder(c, c.folder, 0, out);
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function downloadDriveGame(c: DriveConfig, g: DriveGame): Promise<File> {
  const u = new URL(`${API}/${encodeURIComponent(g.id)}`);
  u.searchParams.set('alt', 'media');
  u.searchParams.set('key', c.key);
  const res = await fetch(u.href, { credentials: 'omit' });
  if (!res.ok) throw await driveError(res);
  return new File([await res.blob()], g.name);
}
