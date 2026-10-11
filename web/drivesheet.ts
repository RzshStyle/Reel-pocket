import { str } from './i18n';
import { closeSheet, sheetRow, showSheet } from './ui/sheet';
import { parseTitle } from './title';
import {
  configFromSetupLink, folderIdFrom, isFetched, listDriveGames, loadDriveConfig, saveDriveConfig,
  setupLink, type DriveConfig, type DriveGame,
} from './drive';

export type ImportDriveGames = (c: DriveConfig, games: DriveGame[]) => void;

const titleOf = (g: DriveGame): string => parseTitle(g.name.replace(/\.(zip|punnet)$/i, '')).title || g.name;

function mb(n: number): string {
  return n ? `${(n / 1048576).toFixed(1)} MB` : '';
}

function field(caption: string, value: string, placeholder: string): { row: HTMLElement; input: HTMLInputElement } {
  const row = document.createElement('div');
  row.className = 'sheet-row sheet-field';
  const label = document.createElement('span');
  label.textContent = caption;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = value;
  input.placeholder = placeholder;
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('aria-label', caption);
  input.addEventListener('keydown', (ev) => ev.stopPropagation());
  row.append(label, input);
  return { row, input };
}

function note(text: string, bad = false): HTMLParagraphElement {
  const p = document.createElement('p');
  p.className = 'sheet-note';
  if (bad) p.style.color = 'var(--danger)';
  p.textContent = text;
  return p;
}

export function openDriveSetup(returnTo: HTMLElement, importGames: ImportDriveGames): void {
  const c = loadDriveConfig();
  const link = field(str('drive.folder_link'), c ? `https://drive.google.com/drive/folders/${c.folder}` : '',
    str('drive.paste_the_shared_folder_link'));
  const key = field(str('drive.api_key'), c?.key ?? '', str('drive.google_api_key'));
  const msg = note(str('drive.setup_help'));
  const save = sheetRow(str('drive.save_and_open'), '');
  save.addEventListener('click', () => {
    const setup = configFromSetupLink(link.input.value);
    const folder = setup?.folder ?? folderIdFrom(link.input.value);
    const apiKey = setup?.key ?? key.input.value.trim();
    if (!folder || !apiKey) {
      msg.replaceWith(note(!folder ? str('drive.that_folder_link_doesn_t') : str('drive.add_the_api_key'), true));
      return;
    }
    saveDriveConfig({ folder, key: apiKey });
    void openDriveLibrary(returnTo, importGames);
  });
  const rows: HTMLElement[] = [link.row, key.row, save, msg];
  if (c) {
    const forget = sheetRow(str('drive.disconnect'), str('drive.games_already_on_this_device'));
    forget.classList.add('destructive');
    forget.addEventListener('click', () => { saveDriveConfig(null); closeSheet(); });
    rows.push(forget);
  }
  showSheet(str('drive.online_library'), rows, returnTo);
}

export async function openDriveLibrary(returnTo: HTMLElement, importGames: ImportDriveGames): Promise<void> {
  const c = loadDriveConfig();
  if (!c) { openDriveSetup(returnTo, importGames); return; }
  const loading = sheetRow(str('drive.checking_your_library'), '');
  loading.classList.add('inert');
  showSheet(str('drive.online_library'), [loading], returnTo);

  let games: DriveGame[];
  try {
    games = await listDriveGames(c);
  } catch (e) {
    const err = note((e as Error).message || String(e), true);
    const retry = sheetRow(str('drive.try_again'), '');
    retry.addEventListener('click', () => void openDriveLibrary(returnTo, importGames));
    const change = sheetRow(str('drive.change_library'), '');
    change.addEventListener('click', () => openDriveSetup(returnTo, importGames));
    showSheet(str('drive.online_library'), [err, retry, change], returnTo);
    return;
  }

  const fresh = games.filter((g) => !isFetched(g));
  const rows: HTMLElement[] = [];
  const getNew = sheetRow(
    fresh.length ? str('drive.get_n_new_games', { n: fresh.length }) : str('drive.all_games_on_this_device'),
    fresh.length ? mb(fresh.reduce((t, g) => t + g.size, 0)) : str('drive.n_games_in_your_library', { n: games.length }),
  );
  if (fresh.length) getNew.addEventListener('click', () => { closeSheet(); importGames(c, fresh); });
  else getNew.classList.add('inert');
  rows.push(getNew);

  for (const g of games) {
    const have = isFetched(g);
    const row = sheetRow(titleOf(g), have ? str('drive.on_this_device_tap_to') : mb(g.size));
    if (have) row.style.color = 'var(--muted)';
    row.addEventListener('click', () => { closeSheet(); importGames(c, [g]); });
    rows.push(row);
  }

  const share = sheetRow(str('drive.copy_setup_link'), str('drive.sets_up_another_phone_with'));
  share.addEventListener('click', () => {
    const text = setupLink(c);
    const show = (): void => share.replaceWith(note(text));
    if (!navigator.clipboard) { show(); return; }
    navigator.clipboard.writeText(text).then(
      () => share.replaceWith(note(str('drive.setup_link_copied'))),
      show,
    );
  });
  const change = sheetRow(str('drive.change_library'), '');
  change.addEventListener('click', () => openDriveSetup(returnTo, importGames));
  rows.push(share, change);
  showSheet(str('drive.online_library'), rows, returnTo);
}
