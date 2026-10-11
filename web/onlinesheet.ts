import { str } from './i18n';
import { closeSheet, sheetRow, showSheet } from './ui/sheet';
import { parseTitle } from './title';
import {
  configFromSetupLink, isFetched, listOnlineGames, loadOnlineConfig, saveOnlineConfig, serverFrom,
  setupLink, type OnlineConfig, type OnlineGame,
} from './online';

export type ImportOnlineGames = (c: OnlineConfig, games: OnlineGame[]) => void;

const titleOf = (g: OnlineGame): string => parseTitle(g.name.replace(/\.(zip|punnet)$/i, '')).title || g.name;

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

export function openOnlineSetup(returnTo: HTMLElement, importGames: ImportOnlineGames): void {
  const c = loadOnlineConfig();
  const link = field(str('online.address'), c?.server ?? '', str('online.paste_the_library_address_or'));
  const key = field(str('online.passcode'), c?.code ?? '', str('online.family_passcode'));
  const msg = note(str('online.setup_help'));
  const save = sheetRow(str('online.save_and_open'), '');
  save.addEventListener('click', () => {
    const setup = configFromSetupLink(link.input.value);
    const server = setup?.server ?? serverFrom(link.input.value);
    const code = setup?.code ?? key.input.value.trim();
    if (!server || !code) {
      msg.replaceWith(note(!server ? str('online.that_address_doesn_t_look') : str('online.add_the_passcode'), true));
      return;
    }
    saveOnlineConfig({ server, code });
    void openOnlineLibrary(returnTo, importGames);
  });
  const rows: HTMLElement[] = [link.row, key.row, save, msg];
  if (c) {
    const forget = sheetRow(str('online.disconnect'), str('online.games_already_on_this_device'));
    forget.classList.add('destructive');
    forget.addEventListener('click', () => { saveOnlineConfig(null); closeSheet(); });
    rows.push(forget);
  }
  showSheet(str('online.online_library'), rows, returnTo);
}

export async function openOnlineLibrary(returnTo: HTMLElement, importGames: ImportOnlineGames): Promise<void> {
  const c = loadOnlineConfig();
  if (!c) { openOnlineSetup(returnTo, importGames); return; }
  const loading = sheetRow(str('online.checking_your_library'), '');
  loading.classList.add('inert');
  showSheet(str('online.online_library'), [loading], returnTo);

  let games: OnlineGame[];
  try {
    games = await listOnlineGames(c);
  } catch (e) {
    const err = note((e as Error).message || String(e), true);
    const retry = sheetRow(str('online.try_again'), '');
    retry.addEventListener('click', () => void openOnlineLibrary(returnTo, importGames));
    const change = sheetRow(str('online.change_library'), '');
    change.addEventListener('click', () => openOnlineSetup(returnTo, importGames));
    showSheet(str('online.online_library'), [err, retry, change], returnTo);
    return;
  }

  const fresh = games.filter((g) => !isFetched(g));
  const rows: HTMLElement[] = [];
  const getNew = sheetRow(
    fresh.length ? str('online.get_n_new_games', { n: fresh.length }) : str('online.all_games_on_this_device'),
    fresh.length ? mb(fresh.reduce((t, g) => t + g.size, 0)) : str('online.n_games_in_your_library', { n: games.length }),
  );
  if (fresh.length) getNew.addEventListener('click', () => { closeSheet(); importGames(c, fresh); });
  else getNew.classList.add('inert');
  rows.push(getNew);

  for (const g of games) {
    const have = isFetched(g);
    const row = sheetRow(titleOf(g), have ? str('online.on_this_device_tap_to') : mb(g.size));
    if (have) row.style.color = 'var(--muted)';
    row.addEventListener('click', () => { closeSheet(); importGames(c, [g]); });
    rows.push(row);
  }

  const share = sheetRow(str('online.copy_setup_link'), str('online.sets_up_another_phone_with'));
  share.addEventListener('click', () => {
    const text = setupLink(c);
    const show = (): void => share.replaceWith(note(text));
    if (!navigator.clipboard) { show(); return; }
    navigator.clipboard.writeText(text).then(
      () => share.replaceWith(note(str('online.setup_link_copied'))),
      show,
    );
  });
  const change = sheetRow(str('online.change_library'), '');
  change.addEventListener('click', () => openOnlineSetup(returnTo, importGames));
  rows.push(share, change);
  showSheet(str('online.online_library'), rows, returnTo);
}
