import type { Cabinet, CabLamp, Rect } from './dat';

// Phone controls. A pad of equal keys mirrors the machine's deck buttons,
// each showing the cap's own artwork live (so HOLD HI reads as HOLD HI and
// lights when the cap lights). Buttons elsewhere on the glass, such as a
// feature's TAKE IT / LEAVE IT or DEAL / NO DEAL, pop up under the machine
// while they are lit. Auto frames the reels, displays and deck; Machine
// shows the whole cabinet.

export type ViewMode = 'auto' | 'whole';

const MODE_KEY = 'fruitulator.phoneview2';
const MODES: { id: ViewMode; label: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'whole', label: 'Machine' },
];
const ZOOM_STEP = 1.25;
const DOUBLE_TAP_MS = 320;
// A feature button counts as live this long after it was last seen lit, so
// flashing lamps do not make the keys and the view flicker.
const FEATURE_HOLD_MS = 1600;
const GLIDE_MS = 350;
// Height Auto keeps free under the machine for the feature keys.
const STRIP_PX = 78;
// Attract mode flashes every lamp on the glass; feature keys only pop up
// while someone is actually playing.
const PLAYING_MS = 90_000;

export interface PhoneViewHost {
  stage: HTMLElement;
  bar: HTMLElement;
  canvas: HTMLCanvasElement;
  cabinet(): Cabinet | null;
  screenSize(): { w: number; h: number };
  getView(): { zoom: number; panX: number; panY: number };
  setView(zoom: number, panX: number, panY: number): void;
  maxZoom: number;
  nameOf(lp: CabLamp): string;
  // How good a slot is for the Credit button: 0 = not usable, higher is preferred.
  takesMoney(lp: CabLamp): number;
  isControlAt(clientX: number, clientY: number): boolean;
  // The machine's own lamp state for a cap, or null before the first frame.
  isLit(lp: CabLamp): boolean | null;
  press(lp: CabLamp, pointerId: number): void;
  release(pointerId: number): void;
}

type Role = 'start' | 'stake' | 'other';

interface Key {
  lp: CabLamp;
  el: HTMLButtonElement;
  cv: HTMLCanvasElement;
  role: Role;
  lo: number;
  hi: number;
  litAt: number;
  label: string;
}

function union(rects: Rect[]): Rect | null {
  if (!rects.length) return null;
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
  for (const x of rects) {
    l = Math.min(l, x.left);
    t = Math.min(t, x.top);
    r = Math.max(r, x.left + x.width);
    b = Math.max(b, x.top + x.height);
  }
  return { left: l, top: t, width: r - l, height: b - t };
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[s.length >> 1] : 0;
}

function roleOf(name: string): Role {
  const n = name.toUpperCase();
  if (/START|SPIN|PLAY\b/.test(n)) return 'start';
  if (/STAKE|\bSTK\b|EXCH/.test(n)) return 'stake';
  return 'other';
}

// MFME button names are short and cryptic (STRTHI, TRNSFR); spell them out for the key labels.
const WORDS: Record<string, string> = {
  CANCEL: 'Cancel', CANCL: 'Cancel', CANC: 'Cancel', COLLECT: 'Collect', COLLCT: 'Collect', COLECT: 'Collect', COLL: 'Collect',
  HOLD: 'Hold', HLD: 'Hold', HI: 'Hi', HIGH: 'Hi', LO: 'Lo', LW: 'Lo', LOW: 'Lo',
  START: 'Start', STRT: 'Start', STR: 'Start', SPIN: 'Spin', PLAY: 'Play', PLY: 'Play',
  TRNSFR: 'Transfer', TRANSFER: 'Transfer', TRANS: 'Transfer', XFER: 'Transfer',
  AUTPLY: 'Auto Play', AUTOPLAY: 'Auto Play', AUTO: 'Auto', AUT: 'Auto',
  DEAL: 'Deal', NODEAL: 'No Deal', NO: 'No', TAKEIT: 'Take It', TAKE: 'Take', LEAVIT: 'Leave It', LEAVEIT: 'Leave It',
  LEAVE: 'Leave', IT: 'It', GAMBLE: 'Gamble', GMBL: 'Gamble', NUDGE: 'Nudge', NDG: 'Nudge', NUDG: 'Nudge',
  EXCHNG: 'Exchange', EXCH: 'Exchange', EXCHANGE: 'Exchange', STAKE: 'Stake', STK: 'Stake', REPEAT: 'Repeat',
  REFILL: 'Refill', TEST: 'Test', MENU: 'Menu', FEATURE: 'Feature', FEAT: 'Feature', SELECT: 'Select', SEL: 'Select',
  STOP: 'Stop', SHUFFLE: 'Shuffle', SHFL: 'Shuffle', BANK: 'Bank', MAX: 'Max', BET: 'Bet', TOKEN: 'Token', TKN: 'Token',
  SV: 'Save', SAVE: 'Save', BK: 'Bank', BONUS: 'Bonus', BON: 'Bonus',
  CAN: 'Cancel', CO: 'Collect', CH: 'Change', CHG: 'Change', CHANGE: 'Change', OR: 'or', PL: 'Play', DON: 'DOND', SAFE: 'Safe',
  SWAP: 'Swap', PICK: 'Pick', ACCEPT: 'Accept', REJECT: 'Reject', YES: 'Yes', LEFT: 'Left', RIGHT: 'Right', UP: 'Up', DOWN: 'Down',
};
const HILO_DIFF = 18;

function capDiff(a: Float32Array, b: Float32Array): number {
  let t = 0;
  for (let i = 0; i < a.length; i++) t += Math.abs(a[i] - b[i]);
  return t / a.length;
}

const STEMS = Object.keys(WORDS).sort((a, b) => b.length - a.length);
// ROM button names are cut to six letters (COLLEC, TRANSF, NO DEA): finish a cut word when only one fits.
const FULL = [...new Set(Object.values(WORDS).filter((w) => !w.includes(' ')))];
function finishWord(part: string): string | null {
  if (part.length < 3) return null;
  const hits = FULL.filter((w) => w.toUpperCase().startsWith(part));
  return hits.length === 1 ? hits[0] : null;
}

// Whole names that word-by-word spelling gets wrong.
const PHRASES: Record<string, string> = { 'SAFE C': 'Safe Cracker', 'PL DON': 'Play DOND', 'C OR B': 'Cash or Bust' };

export function friendlyLabel(name: string): string {
  if (/^unnamed/i.test(name.trim())) return '';
  const phrase = PHRASES[name.trim().toUpperCase()];
  if (phrase) return phrase;
  return name.split('/').map(friendlyWords).filter(Boolean).join(' / ');
}

function friendlyWords(name: string): string {
  const out: string[] = [];
  for (const part of name.toUpperCase().split(/[\s_\-.]+/).filter(Boolean)) {
    const num = /^([A-Z]+?)(\d+)$/.exec(part);
    if (num && WORDS[num[1]]) { out.push(`${WORDS[num[1]]} ${num[2]}`); continue; }
    if (WORDS[part]) { out.push(WORDS[part]); continue; }
    const whole = finishWord(part);
    if (whole) { out.push(whole); continue; }
    // Run-together names: peel known words off the front (STRTHI -> Start Hi).
    let rest = part;
    const bits: string[] = [];
    while (rest) {
      const stem = STEMS.find((w) => rest.startsWith(w) && (rest.length === w.length || rest.length - w.length >= 2 || WORDS[rest.slice(w.length)]));
      if (!stem) break;
      bits.push(WORDS[stem]);
      rest = rest.slice(stem.length);
    }
    if (!rest && bits.length) out.push(...bits);
    else out.push(/^\d+$/.test(part) ? part : part.charAt(0) + part.slice(1).toLowerCase());
  }
  return out.join(' ');
}

function storedMode(): ViewMode | null {
  try {
    const v = localStorage.getItem(MODE_KEY);
    return v === 'whole' ? v : v === 'auto' || v === 'play' ? 'auto' : null;
  } catch {
    return null;
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}


export class PhoneView {
  private mode: ViewMode;
  private hiLoDebug: number[] = [];
  private hiLo: boolean | null = null;
  private cab: Cabinet | null = null;
  private deck: Key[] = [];
  private extras: Key[] = [];
  private shownExtras: Key[] = [];
  private coins: CabLamp[] = [];
  private whole: Rect | null = null;
  private play: Rect | null = null;
  private focus: Rect | null = null;
  private glide: { from: { zoom: number; panX: number; panY: number }; to: { zoom: number; panX: number; panY: number }; t0: number } | null = null;
  private lastStage = { w: 0, h: 0 };
  private probe = document.createElement('canvas');
  private frameNo = 0;
  private lastTap = { t: 0, x: 0, y: 0 };
  private playedAt = -Infinity;
  private view: { zoom: number; panX: number; panY: number; w: number; h: number } | null = null;

  private coinBtn = el('button', 'pv-coin');
  private seg = el('div', 'pv-seg');
  private main = el('div', 'pv-main');
  private feature = el('div', 'pv-feature');

  constructor(private host: PhoneViewHost) {
    this.mode = storedMode() ?? 'auto';
    this.probe.width = 8;
    this.probe.height = 8;

    this.coinBtn.type = 'button';
    this.coinBtn.innerHTML = '<span class="pv-coin-disc">£</span><span>Credit</span>';
    // The first slot the machine will take money through right now; a
    // layout can draw several and some are locked or unwired.
    this.bindPress(this.coinBtn, () => {
      let best: CabLamp | null = null, rank = 0;
      for (const lp of this.coins) {
        const r = host.takesMoney(lp);
        if (r > rank) { rank = r; best = lp; }
      }
      return best ?? this.coins[0] ?? null;
    });

    this.seg.setAttribute('role', 'group');
    this.seg.setAttribute('aria-label', 'Display mode');
    for (const m of MODES) {
      const b = el('button', '', m.label);
      b.type = 'button';
      b.dataset.mode = m.id;
      b.addEventListener('click', () => this.setMode(m.id));
      this.seg.append(b);
    }
    const zoom = el('div', 'pv-zoom');
    const out = el('button', '', '−');
    const inn = el('button', '', '+');
    out.type = 'button';
    inn.type = 'button';
    out.setAttribute('aria-label', 'Zoom out');
    inn.setAttribute('aria-label', 'Zoom in');
    out.addEventListener('click', () => this.zoomBy(1 / ZOOM_STEP));
    inn.addEventListener('click', () => this.zoomBy(ZOOM_STEP));
    // In landscape the pad covers the header's menu button; offer it here.
    const menu = el('button', 'pv-menu', '☰');
    menu.type = 'button';
    menu.setAttribute('aria-label', 'Menu');
    menu.addEventListener('click', () => document.getElementById('burgerBtn')?.click());
    zoom.append(out, inn, menu);

    const top = el('div', 'pv-top');
    top.append(this.coinBtn, this.seg, zoom);
    host.bar.replaceChildren(top, this.main);
    this.paintSeg();

    this.feature.hidden = true;
    this.feature.setAttribute('aria-label', 'Feature buttons');
    host.stage.append(this.feature);
    host.stage.addEventListener('pointerup', (ev) => this.maybeDoubleTap(ev));
    host.stage.addEventListener('pointerdown', () => { this.playedAt = performance.now(); });
    if (location.search.includes('pvdebug')) {
      (window as unknown as { __pvobj: unknown }).__pvobj = this;
      (window as unknown as { __pv: unknown }).__pv = () => ({
        deck: this.deck.map((k) => [k.el.getAttribute('aria-label'), k.el.classList.contains('lit'), Math.round(k.lp.width), Math.round(k.lp.height), k.lp.label, k.lp.name, k.lp.legend?.off, k.lp.legend?.on]),
        hilo: this.hiLoDebug,
        extras: this.extras.map((k) => [k.el.getAttribute('aria-label'), k.el.classList.contains('lit'), Math.round(k.lp.width), Math.round(k.lp.height), k.lp.label, k.lp.name, k.lp.legend?.off, k.lp.legend?.on]),
      });
    }
  }

  setMode(m: ViewMode): void {
    this.mode = m;
    try { localStorage.setItem(MODE_KEY, m); } catch { }
    this.paintSeg();
    this.applyMode(false);
  }

  private paintSeg(): void {
    for (const b of this.seg.querySelectorAll('button')) {
      b.setAttribute('aria-pressed', String(b.dataset.mode === this.mode));
    }
  }

  reset(): void {
    this.cab = null;
    this.deck = [];
    this.hiLo = null;
    this.extras = [];
    this.shownExtras = [];
    this.coins = [];
    this.view = null;
    this.glide = null;
    this.main.replaceChildren();
    this.feature.replaceChildren();
    this.feature.hidden = true;
    this.host.bar.hidden = true;
  }

  private build(cab: Cabinet): void {
    this.reset();
    this.cab = cab;
    const c = cab.content;
    const off = (r: Rect): Rect => ({ left: r.left - c.left, top: r.top - c.top, width: r.width, height: r.height });
    // Only caps drawn on the glass: switch-matrix entries carry no artwork
    // and can sit outside the visible cabinet.
    const visible = (lp: CabLamp): boolean => lp.width > 4 && lp.height > 4 && !lp.angle
      && lp.states.length > 0
      && lp.left >= c.left && lp.top >= c.top
      && lp.left + lp.width <= c.left + c.width && lp.top + lp.height <= c.top + c.height;
    const btnLamps = cab.lamps.filter((lp) => lp.button !== undefined && !lp.acceptor && visible(lp));
    // Note slots first: they credit in one go, where coin mechs can need a
    // validated coin protocol.
    this.coins = cab.lamps.filter((lp) => lp.acceptor && visible(lp))
      .sort((a, b) => Number(b.acceptor!.note !== undefined) - Number(a.acceptor!.note !== undefined));

    // One lamp per button number: the biggest is the cap, the rest overlays.
    const byButton = new Map<number, CabLamp>();
    for (const lp of btnLamps) {
      const had = byButton.get(lp.button!);
      if (!had || lp.width * lp.height > had.width * had.height) byButton.set(lp.button!, lp);
    }
    const caps = [...byButton.values()];

    // The deck buttons are the lowest row of full-size caps on the cabinet;
    // every other cap is a feature button.
    const h = median(caps.map((lp) => lp.height)) || 1;
    const area = median(caps.map((lp) => lp.width * lp.height));
    const full = caps.filter((lp) => lp.width * lp.height >= area * 0.5);
    const mid = (lp: CabLamp): number => lp.top + lp.height / 2;
    const lowest = Math.max(...full.map(mid), -Infinity);
    const deck = full.filter((lp) => mid(lp) >= lowest - 0.6 * h).sort((a, b) => a.left - b.left);
    const extras = caps.filter((lp) => !deck.includes(lp) && lp.width * lp.height >= area * 0.3);

    const whole = { left: 0, top: 0, width: this.host.canvas.width, height: this.host.canvas.height };
    const reels: Rect[] = [
      ...cab.reels, ...(cab.bandReels ?? []), ...(cab.flipReels ?? []), ...cab.frameReels,
      // A video machine's screen plays the part of the reels.
      ...(cab.videoScreen ? [cab.videoScreen] : []),
    ].filter((r) => r.width > 0 && r.height > 0).map(off);
    const deckTop = deck.length ? Math.min(...deck.map((lp) => lp.top - c.top)) : whole.height;
    // Main reels sit just above the deck; feature reels up on the top glass
    // belong to the feature.
    const mainReels = reels.filter((r) => r.top + r.height <= deckTop + h && r.top >= deckTop - whole.height * 0.3);
    const useReels = mainReels.length ? mainReels : reels;
    const reelBox = union(useReels);
    const vfd = cab.vfd ? [off(cab.vfd)].filter((v) => !reelBox || Math.abs(v.top - reelBox.top) < reelBox.height * 1.5) : [];
    // The pad carries the deck, so Reels frames just the reels and their
    // display, which lets portrait zoom in properly.
    this.whole = whole;
    this.play = this.pad(union([...useReels, ...vfd]), h * 0.8, whole);
    // What Auto must keep on screen: the reels, their display and the deck.
    this.focus = this.pad(union([...useReels, ...vfd, ...deck.map(off)]), h * 0.35, whole);

    this.deck = deck.map((lp) => this.makeKey(lp, 'pv-btn'));
    this.extras = extras.map((lp) => this.makeKey(lp, 'pv-btn pv-fbtn'));
    this.layoutDeck();
    this.coinBtn.hidden = this.coins.length === 0;
    this.host.bar.hidden = false;
    this.lastStage = { w: 0, h: 0 };
  }

  private pad(r: Rect | null, k: number, within: Rect): Rect | null {
    if (!r) return null;
    const left = Math.max(within.left, r.left - k);
    const top = Math.max(within.top, r.top - k);
    return {
      left, top,
      width: Math.min(within.left + within.width, r.left + r.width + k) - left,
      height: Math.min(within.top + within.height, r.top + r.height + k) - top,
    };
  }

  private makeKey(lp: CabLamp, cls: string): Key {
    const b = el('button', cls);
    b.type = 'button';
    const name = this.host.nameOf(lp);
    const role = roleOf(name);
    b.dataset.role = role;
    b.setAttribute('aria-label', name);
    const cv = document.createElement('canvas');
    b.append(cv);
    this.bindPress(b, () => lp);
    return { lp, el: b, cv, role, lo: Infinity, hi: -Infinity, litAt: 0, label: friendlyLabel(name) };
  }

  // One row of equal keys in the machine's left-to-right order, with stake
  // and start moved to the right-hand end where a thumb rests.
  private layoutDeck(): void {
    const start = this.deck.filter((k) => k.role === 'start');
    const stake = this.deck.filter((k) => k.role === 'stake');
    const rest = this.deck.filter((k) => k.role === 'other');
    const row = el('div', 'pv-row');
    for (const k of [...rest, ...stake, ...start]) row.append(k.el);
    row.style.setProperty('--keys', String(this.deck.length));
    this.main.replaceChildren(row);
  }

  private bindPress(b: HTMLButtonElement, target: () => CabLamp | null): void {
    b.addEventListener('pointerdown', (ev) => {
      // Feature keys sit over the stage; keep the press off the cabinet.
      ev.stopPropagation();
      const lp = target();
      if (ev.button !== 0 || !lp) return;
      ev.preventDefault();
      b.setPointerCapture(ev.pointerId);
      b.classList.add('down');
      try { navigator.vibrate?.(12); } catch { }
      this.playedAt = performance.now();
      this.host.press(lp, ev.pointerId);
    });
    const up = (ev: PointerEvent): void => {
      ev.stopPropagation();
      b.classList.remove('down');
      this.host.release(ev.pointerId);
    };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('contextmenu', (ev) => ev.preventDefault());
  }

  // Once per drawn frame: pick up a new cabinet, keep the framing, paint the
  // keys from the frame and follow the game in Auto view.
  frame(): void {
    const cab = this.host.cabinet();
    if (cab !== this.cab) {
      if (cab) this.build(cab); else this.reset();
    }
    if (!this.cab) return;
    const now = performance.now();
    const s = { w: this.host.stage.clientWidth, h: this.host.stage.clientHeight };
    if (s.w !== this.lastStage.w || s.h !== this.lastStage.h) {
      this.lastStage = s;
      this.applyMode(false);
    }
    if (this.glide) this.stepGlide(now);
    else if (this.view) {
      // Remember pinches and drags so a host reset can put them back.
      const v = this.host.getView();
      if (v.zoom !== this.view.zoom || v.panX !== this.view.panX || v.panY !== this.view.panY) {
        this.view = { ...v, w: s.w, h: s.h };
      }
    }
    if (++this.frameNo % 60 === 0) this.relabel();
    if (this.frameNo % 2) return;
    for (const k of this.deck) this.paintKey(k);
    if (this.frameNo % 2 === 0) {
      for (const k of this.deck) this.measure(k, now);
      for (const k of this.extras) this.measure(k, now);
      this.updateFeature(now);
    }
    for (const k of this.shownExtras) this.paintKey(k);
  }

  // Button names arrive once the ROM has been read, after the layout.
  private relabel(): void {
    let moved = false;
    for (const k of [...this.deck, ...this.extras]) {
      const name = this.host.nameOf(k.lp);
      if (k.el.getAttribute('aria-label') === name) continue;
      k.el.setAttribute('aria-label', name);
      k.label = friendlyLabel(name);
      const role = roleOf(name);
      if (role !== k.role) {
        k.role = role;
        k.el.dataset.role = role;
        moved = true;
      }
    }
    this.markHiLo();
    if (moved) this.layoutDeck();
  }

  // Many games print HI and LO on the second and third hold caps (Mega DOND, Cops n Robbers)
  // while the program still calls them HOLD 2 and HOLD 3. When those two caps carry different
  // artwork from the plain first hold, label them Hold Hi and Hold Lo.
  private markHiLo(): void {
    const holds = [1, 2, 3].map((n) => this.deck.find((k) => new RegExp(`^HOLD\\s*${n}$`, 'i').test(k.el.getAttribute('aria-label') ?? '')));
    if (holds.some((k) => !k)) return;
    if (this.hiLo === null) {
      const [h1, h2, h3] = holds.map((k) => this.capPrint(k!.lp));
      if (!h1 || !h2 || !h3) return;
      const d12 = capDiff(h1, h2), d13 = capDiff(h1, h3), d23 = capDiff(h2, h3);
      this.hiLoDebug = [d12, d13, d23].map((d) => Math.round(d));
      this.hiLo = d12 > HILO_DIFF && d13 > HILO_DIFF && d23 > HILO_DIFF / 3;
    }
    if (this.hiLo) {
      holds[1]!.label = 'Hold Hi';
      holds[2]!.label = 'Hold Lo';
    }
  }

  // A small greyscale print of a cap's unlit artwork, for comparing caps.
  private capPrint(lp: CabLamp): Float32Array | null {
    const img = (lp.states[0]?.canvas ?? lp.offState?.canvas) as CanvasImageSource | undefined;
    if (!img) return null;
    const cv = document.createElement('canvas');
    cv.width = 24; cv.height = 16;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, 24, 16);
    const d = ctx.getImageData(0, 0, 24, 16).data;
    const out = new Float32Array(24 * 16);
    let mean = 0;
    for (let i = 0; i < out.length; i++) { out[i] = 0.3 * d[i * 4] + 0.59 * d[i * 4 + 1] + 0.11 * d[i * 4 + 2]; mean += out[i]; }
    mean /= out.length;
    for (let i = 0; i < out.length; i++) out[i] -= mean;
    return out;
  }

  private paintKey(k: Key): void {
    const w = k.el.clientWidth, h = k.el.clientHeight;
    if (w <= 0 || h <= 0 || !this.cab) return;
    const dpr = window.devicePixelRatio || 1;
    const cw = Math.round(w * dpr), ch = Math.round(h * dpr);
    if (k.cv.width !== cw || k.cv.height !== ch) {
      k.cv.width = cw;
      k.cv.height = ch;
    }
    const ctx = k.cv.getContext('2d');
    if (!ctx) return;
    const c = this.cab.content;
    const inset = 4 * dpr;
    const s = Math.min((cw - inset) / k.lp.width, (ch - inset) / k.lp.height);
    const dw = k.lp.width * s, dh = k.lp.height * s;
    ctx.clearRect(0, 0, cw, ch);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const lit = k.el.classList.contains('lit');
    // The cap artwork is only ~20px in most layouts, too small to read when enlarged,
    // so it becomes a soft backdrop under a sharp text label.
    const label = k.label;
    ctx.filter = label
      ? (lit ? 'blur(1.5px) brightness(1.15) saturate(1.4)' : 'blur(1.5px) brightness(1.6) saturate(1.3)')
      : (lit ? 'none' : 'brightness(1.7) saturate(1.15)');
    ctx.drawImage(
      this.host.canvas, k.lp.left - c.left, k.lp.top - c.top, k.lp.width, k.lp.height,
      label ? 0 : (cw - dw) / 2, label ? 0 : (ch - dh) / 2, label ? cw : dw, label ? ch : dh,
    );
    ctx.filter = 'none';
    if (label) this.paintLabel(ctx, label, cw, ch, dpr, lit);
  }

  private paintLabel(ctx: CanvasRenderingContext2D, label: string, cw: number, ch: number, dpr: number, lit: boolean): void {
    ctx.fillStyle = lit ? 'rgba(0,0,0,0.12)' : 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, cw, ch);
    const words = label.split(' ');
    const pad = 4 * dpr;
    const fits = (lines: string[], px: number) => {
      ctx.font = `700 ${px}px system-ui, sans-serif`;
      return lines.length * px * 1.1 <= ch - pad && lines.every((l) => ctx.measureText(l).width <= cw - pad);
    };
    const sizeFor = (lines: string[]) => {
      let px = Math.floor(17 * dpr);
      while (px > 7 * dpr && !fits(lines, px)) px--;
      return px;
    };
    let best: string[] = [label], size = sizeFor(best);
    // Break onto two lines only when one line would be too small to read,
    // and never for short labels like Hold 1 or Start Hi.
    if (size < 13 * dpr && label.length > 8) {
      for (let i = 1; i < words.length; i++) {
        const lines = [words.slice(0, i).join(' '), words.slice(i).join(' ')];
        const px = sizeFor(lines);
        if (px > size) { size = px; best = lines; }
      }
    }
    ctx.font = `700 ${size}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(2, size / 5);
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.fillStyle = lit ? '#fff' : '#e8e8e8';
    const lh = size * 1.1, y0 = ch / 2 - ((best.length - 1) * lh) / 2;
    best.forEach((l, i) => { ctx.strokeText(l, cw / 2, y0 + i * lh); ctx.fillText(l, cw / 2, y0 + i * lh); });
  }

  private measure(k: Key, now: number): void {
    const ctx = this.probe.getContext('2d', { willReadFrequently: true });
    if (!ctx || !this.cab) return;
    const c = this.cab.content;
    ctx.drawImage(this.host.canvas, k.lp.left - c.left, k.lp.top - c.top, k.lp.width, k.lp.height, 0, 0, 8, 8);
    const d = ctx.getImageData(0, 0, 8, 8).data;
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
    const n = d.length / 4;
    const lum = (0.3 * r + 0.59 * g + 0.11 * b) / n;
    k.lo = Math.min(k.lo, lum);
    k.hi = Math.max(k.hi, lum);
    const lit = this.host.isLit(k.lp) ?? (k.hi - k.lo > 18 && lum > k.lo + 0.55 * (k.hi - k.lo));
    if (lit) {
      k.litAt = now;
      k.el.style.setProperty('--glow', `rgb(${Math.round(r / n)}, ${Math.round(g / n)}, ${Math.round(b / n)})`);
    }
    k.el.classList.toggle('lit', lit);
  }

  // Lit feature buttons pop up as keys in the space under the machine.
  private updateFeature(now: number): void {
    const playing = now - this.playedAt < PLAYING_MS;
    const live = this.extras.filter((k) => playing && k.litAt > 0 && now - k.litAt < FEATURE_HOLD_MS)
      .sort((a, b) => a.lp.left - b.lp.left);
    const same = live.length === this.shownExtras.length && live.every((k, i) => k === this.shownExtras[i]);
    if (!same) {
      this.shownExtras = live;
      this.feature.replaceChildren(...live.map((k) => k.el));
      this.feature.hidden = live.length === 0;
    }
  }

  applyMode(glide: boolean): void {
    if (!this.cab) return;
    if (this.mode === 'auto' && this.autoFrame(glide)) return;
    this.feature.style.bottom = '';
    this.frameRegion(this.mode === 'whole' ? this.whole : this.play ?? this.whole, glide);
  }

  // Auto fits the machine to the phone: as big as the reels, display and
  // deck allow across the screen, with the deck sitting just above a band
  // kept free for feature keys. Where the cabinet is shorter than the
  // screen it sits in the middle of what is left, so the band falls in the
  // blank space under it. A wide, short screen has no room to spare, so
  // there the reels fill it and the keys float over them.
  private autoFrame(glide: boolean): boolean {
    const f = this.focus, whole = this.whole;
    const scr = this.host.screenSize();
    const cw = this.host.canvas.width, ch = this.host.canvas.height;
    const sw = this.host.stage.clientWidth, sh = this.host.stage.clientHeight;
    if (!f || !whole || scr.w <= 0 || cw <= 0 || sw >= sh) return false;
    const band = this.extras.length ? STRIP_PX : 0;
    const k = scr.w / cw;
    const room = sh - band;
    const z = Math.max(1, Math.min(this.host.maxZoom, sw / (f.width * k), room / (f.height * k)));
    const s = k * z;
    // Stage y of a canvas y with no vertical pan.
    const y0 = (y: number): number => sh / 2 + (y / ch - 0.5) * scr.h * z;
    const cabH = ch * s;
    let panY: number;
    if (cabH <= room) {
      panY = room / 2 - y0(ch / 2);
    } else {
      // Deck bottom just above the band, but never past the cabinet's edges.
      panY = room - 4 - y0(f.top + f.height);
      panY = Math.min(panY, -y0(0));
      panY = Math.max(panY, sh - y0(ch));
    }
    const panX = -((f.left + f.width / 2) / cw - 0.5) * scr.w * z;
    const to = { zoom: z, panX, panY };
    this.feature.style.bottom = band ? '6px' : '';
    if (glide) {
      this.glide = { from: this.host.getView(), to, t0: performance.now() };
    } else {
      this.glide = null;
      this.show(to.zoom, to.panX, to.panY);
    }
    return true;
  }

  private frameRegion(r: Rect | null, glide: boolean): void {
    const scr = this.host.screenSize();
    const cw = this.host.canvas.width, ch = this.host.canvas.height;
    if (!r || scr.w <= 0 || cw <= 0) return;
    const k = scr.w / cw;
    const sw = this.host.stage.clientWidth, sh = this.host.stage.clientHeight;
    const z = Math.max(1, Math.min(this.host.maxZoom, sw / (r.width * k), sh / (r.height * k)));
    const fx = (r.left + r.width / 2) / cw;
    const fy = (r.top + r.height / 2) / ch;
    const to = { zoom: z, panX: -(fx - 0.5) * scr.w * z, panY: -(fy - 0.5) * scr.h * z };
    if (glide) {
      this.glide = { from: this.host.getView(), to, t0: performance.now() };
    } else {
      this.glide = null;
      this.show(to.zoom, to.panX, to.panY);
    }
  }

  private stepGlide(now: number): void {
    const g = this.glide!;
    const t = Math.min(1, (now - g.t0) / GLIDE_MS);
    const e = t * t * (3 - 2 * t);
    const mix = (a: number, b: number): number => a + (b - a) * e;
    this.show(mix(g.from.zoom, g.to.zoom), mix(g.from.panX, g.to.panX), mix(g.from.panY, g.to.panY));
    if (t >= 1) this.glide = null;
  }

  private show(zoom: number, panX: number, panY: number): void {
    this.host.setView(zoom, panX, panY);
    const v = this.host.getView();
    this.view = { ...v, w: this.host.stage.clientWidth, h: this.host.stage.clientHeight };
  }

  // The host resets its view on every resize, and phone browsers resize as
  // their toolbars slide. Put back the framing the player chose; only a real
  // change of stage size reframes from the mode.
  reframe(): void {
    if (!this.cab) return;
    const v = this.view;
    if (v && v.w === this.host.stage.clientWidth && v.h === this.host.stage.clientHeight) {
      this.host.setView(v.zoom, v.panX, v.panY);
    } else {
      this.applyMode(false);
    }
  }

  // Zoom about a point on the stage, keeping the spot under it still. The
  // buttons zoom about the middle of the stage.
  zoomBy(f: number, clientX?: number, clientY?: number): void {
    this.glide = null;
    const v = this.host.getView();
    const z2 = Math.max(1, Math.min(this.host.maxZoom, v.zoom * f));
    const rect = this.host.stage.getBoundingClientRect();
    const dx = clientX === undefined ? 0 : clientX - (rect.left + rect.width / 2);
    const dy = clientY === undefined ? 0 : clientY - (rect.top + rect.height / 2);
    const k = z2 / v.zoom;
    this.show(z2, dx - (dx - v.panX) * k, dy - (dy - v.panY) * k);
  }

  private maybeDoubleTap(ev: PointerEvent): void {
    if (ev.pointerType === 'mouse' || this.host.isControlAt(ev.clientX, ev.clientY)) return;
    const now = performance.now();
    const near = Math.hypot(ev.clientX - this.lastTap.x, ev.clientY - this.lastTap.y) < 30;
    if (now - this.lastTap.t < DOUBLE_TAP_MS && near) {
      this.lastTap.t = 0;
      const v = this.host.getView();
      if (v.zoom >= 1.9) this.applyMode(true);
      else this.zoomBy(2.2 / v.zoom, ev.clientX, ev.clientY);
      return;
    }
    this.lastTap = { t: now, x: ev.clientX, y: ev.clientY };
  }
}
