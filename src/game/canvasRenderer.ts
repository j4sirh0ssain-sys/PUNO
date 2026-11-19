import { canPlayCard } from './engine.ts';
import { TABLE_THEMES, type TableTheme, type TableThemeId } from './themes.ts';
import {
  COLORS,
  PALETTE,
  type Card,
  type ClientGameView,
  type EffectEvent,
  type SuitColor,
} from './types.ts';

const BASE_W = 80;
const BASE_H = 114;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function parseColor(input: string): [number, number, number, number] {
  const trimmed = input.trim();
  if (trimmed.startsWith('#')) {
    const hex = trimmed.slice(1);
    if (hex.length === 3) {
      return [
        parseInt(hex[0] + hex[0], 16),
        parseInt(hex[1] + hex[1], 16),
        parseInt(hex[2] + hex[2], 16),
        1,
      ];
    }
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
      1,
    ];
  }
  const m = trimmed.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/i);
  if (m) {
    return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] !== undefined ? Number(m[4]) : 1];
  }
  return [255, 255, 255, 1];
}

function hexToRgb(hex: string): [number, number, number] {
  const [r, g, b] = parseColor(hex);
  return [r, g, b];
}

function mixHex(a: string, b: string, t: number): string {
  const k = clamp01(t);
  const [ar, ag, ab, aa] = parseColor(a);
  const [br, bg, bb, ba] = parseColor(b);
  const r = Math.round(ar + (br - ar) * k);
  const g = Math.round(ag + (bg - ag) * k);
  const bl = Math.round(ab + (bb - ab) * k);
  const alpha = aa + (ba - aa) * k;
  if (alpha < 0.999) {
    return `rgba(${r}, ${g}, ${bl}, ${alpha.toFixed(3)})`;
  }
  return `rgb(${r}, ${g}, ${bl})`;
}

function easeOut(t: number): number {
  const k = clamp01(t);
  return 1 - (1 - k) ** 3;
}

function easeOutBack(t: number): number {
  const k = clamp01(t);
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (k - 1) ** 3 + c1 * (k - 1) ** 2;
}

function smoothingAlpha(dt: number, rate: number): number {
  return 1 - Math.exp(-rate * dt);
}

class CardSprite {
  public card: Card | null;
  public uid: number;
  public x: number;
  public y: number;
  public tx: number;
  public ty: number;
  public a = 0;
  public ta = 0;
  public s: number;
  public ts: number;
  public vx = 0;
  public vy = 0;
  public va = 0;
  public vs = 0;
  public facing = 0;
  public tfacing = 0;
  public arriveFace = false;
  public delay = 0;
  public boost = 0;
  public hov = 0;
  public dim = 0;
  public tdim = 0;
  public glow = 0;
  public tglow = 0;
  public jx = 0;
  public jy = 0;
  public ja = 0;
  public seq: number;
  public isPile = false;

  constructor(card: Card | null, uid: number, x: number, y: number, s: number, seq: number) {
    this.card = card;
    this.uid = uid;
    this.x = x;
    this.tx = x;
    this.y = y;
    this.ty = y;
    this.s = s;
    this.ts = s;
    this.seq = seq;
  }

  public update(dt: number): void {
    this.boost -= dt;
    if (this.delay > 0) {
      this.delay -= dt;
      return;
    }
    this.tfacing = this.arriveFace ? 1 : 0;
    const k = 205;
    const c = 19.5;
    this.vx += ((this.tx - this.x) * k - this.vx * c) * dt;
    this.vy += ((this.ty - this.y) * k - this.vy * c) * dt;
    this.va += ((this.ta - this.a) * 160 - this.va * 15.5) * dt;
    this.vs += ((this.ts - this.s) * 235 - this.vs * 20) * dt;

    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.a += this.va * dt;
    this.s += this.vs * dt;

    const step = 4.8 * dt;
    if (Math.abs(this.tfacing - this.facing) <= step) {
      this.facing = this.tfacing;
    } else {
      this.facing += this.tfacing > this.facing ? step : -step;
    }

    const alpha = smoothingAlpha(dt, 10);
    this.dim += (this.tdim - this.dim) * alpha;
    this.glow += (this.tglow - this.glow) * alpha;
  }
}

type Particle =
  | {
      kind: 'spark';
      x: number;
      y: number;
      vx: number;
      vy: number;
      life: number;
      max: number;
      size: number;
      color: string;
      g: number;
    }
  | {
      kind: 'ring';
      x: number;
      y: number;
      r0: number;
      r1: number;
      life: number;
      max: number;
      color: string;
      w: number;
    }
  | {
      kind: 'conf';
      x: number;
      y: number;
      vx: number;
      vy: number;
      life: number;
      max: number;
      g: number;
      rot: number;
      vr: number;
      w: number;
      h: number;
      color: string;
    };

interface Banner {
  text: string;
  color: string;
  size: number;
  dur: number;
  dy: number;
  t0: number;
}

interface BokehOrb {
  fx: number;
  fy: number;
  r: number;
  sp: number;
  ph: number;
  color: SuitColor;
}

interface DustMote {
  fx: number;
  fy: number;
  r: number;
  vx: number;
  vy: number;
  ph: number;
}

export type CanvasHit =
  | { type: 'card'; index: number; uid: number }
  | { type: 'deck' }
  | null;

export class PunoCanvasEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private width = 1000;
  private height = 700;
  private dpr = 1;
  private cx = 500;
  private cy = 350;
  private tableRect: [number, number, number, number] = [44, 30, 956, 470];
  private pileDx = 78;
  private handScale = 1;
  private pileScale = 1.2;
  private opponentScale = 0.66;

  private t = 0;
  private seq = 0;
  private shake = 0;
  private tableFlash = 0;
  private tableFlashColor = '#ffffff';
  private winMilestone: 1 | 5 | 10 | null = null;
  private winBurstCooldown = 0;
  private theme: TableTheme = TABLE_THEMES.emerald;
  private glowRgb: [number, number, number] = hexToRgb(TABLE_THEMES.emerald.suitHex.Red);
  private targetColor: SuitColor = 'Red';
  private feltPattern: CanvasPattern | null = null;

  private sprites = new Map<number, CardSprite>();
  private particles: Particle[] = [];
  private banners: Banner[] = [];
  private bokeh: BokehOrb[];
  private motes: DustMote[];

  private view: ClientGameView | null = null;
  private lastRoundId = -1;
  private hoverCardIndex: number | null = null;
  private hoverDeck = false;
  private deckHoverAnim = 0;
  private pointerX = -999;
  private pointerY = -999;
  private reducedMotion = false;

  constructor(canvas: HTMLCanvasElement, initialTheme: TableThemeId = 'emerald') {
    this.canvas = canvas;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Could not initialize 2D canvas context.');
    }
    this.ctx = context;
    this.theme = TABLE_THEMES[initialTheme];
    this.glowRgb = hexToRgb(this.theme.suitHex.Red);
    this.reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let seed = 7;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    this.bokeh = Array.from({ length: 10 }, () => ({
      fx: rand(),
      fy: rand(),
      r: 70 + rand() * 95,
      sp: 0.14 + rand() * 0.24,
      ph: rand() * Math.PI * 2,
      color: COLORS[Math.floor(rand() * COLORS.length)],
    }));

    this.motes = Array.from({ length: 28 }, () => ({
      fx: rand(),
      fy: rand(),
      r: 1.1 + rand() * 2.0,
      vx: (rand() - 0.5) * 0.016,
      vy: -0.008 - rand() * 0.015,
      ph: rand() * Math.PI * 2,
    }));

    this.buildFeltPattern();
    this.resize(canvas.clientWidth || 1000, canvas.clientHeight || 700);
  }

  public setTheme(themeId: TableThemeId): void {
    this.theme = TABLE_THEMES[themeId];
    if (!this.reducedMotion) {
      this.tableFlash = 0.22;
      this.tableFlashColor = this.theme.accent;
    }
  }

  private buildFeltPattern(): void {
    const tile = document.createElement('canvas');
    tile.width = 64;
    tile.height = 64;
    const tctx = tile.getContext('2d');
    if (!tctx) return;
    let seed = 1337;
    const nextRand = () => {
      seed = (seed * 48271) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    for (let y = 0; y < 64; y += 2) {
      for (let x = 0; x < 64; x += 2) {
        const v = nextRand();
        tctx.fillStyle = v > 0.5 ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.035)';
        tctx.fillRect(x, y, 2, 2);
      }
    }
    this.feltPattern = this.ctx.createPattern(tile, 'repeat');
  }

  public resize(cssW: number, cssH: number): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = Math.max(320, Math.floor(cssW));
    this.height = Math.max(360, Math.floor(cssH));
    this.canvas.width = Math.floor(this.width * this.dpr);
    this.canvas.height = Math.floor(this.height * this.dpr);

    const compact = this.width < 680;
    const padX = compact ? 16 : Math.min(64, this.width * 0.055);
    const topY = compact ? 12 : 18;
    const bottomReserve = compact ? 174 : 196;

    const scaleBase = compact ? Math.max(0.72, this.width / 540) : Math.min(1.12, Math.max(0.84, this.width / 1120));
    this.handScale = scaleBase;
    this.pileScale = scaleBase * (compact ? 1.0 : 1.14);
    this.opponentScale = scaleBase * (compact ? 0.5 : 0.58);
    this.pileDx = compact ? 56 * scaleBase : 82 * scaleBase;

    this.cx = this.width / 2;
    this.tableRect = [padX, topY, this.width - padX, Math.max(topY + 210, this.height - bottomReserve)];

    const multiOpp = (this.view?.playerCount ?? 2) > 2;
    const oppBottom = multiOpp
      ? topY + (compact ? 62 : 76)
      : topY + (compact ? 28 : 34) + 5 + (BASE_H / 2) * this.opponentScale;
    const labelOffset = 84 * (this.pileScale / 1.2);
    const minCy = oppBottom + labelOffset + (compact ? 26 : 36);
    const midCy = (this.tableRect[1] + this.tableRect[3]) / 2 + (compact ? 6 : 8);
    this.cy = Math.max(midCy, minCy);
  }

  private deckPos(): [number, number] {
    return [this.cx - this.pileDx, this.cy];
  }

  private pilePos(): [number, number] {
    return [this.cx + this.pileDx, this.cy];
  }

  public syncView(view: ClientGameView, effects: EffectEvent[]): void {
    const roundChanged = view.roundId !== this.lastRoundId;
    const countChanged = (this.view?.playerCount ?? 2) !== view.playerCount;
    if (roundChanged) {
      this.sprites.clear();
      this.particles = [];
      this.banners = [];
      this.shake = 0;
      this.winMilestone = null;
      this.winBurstCooldown = 0;
      this.lastRoundId = view.roundId;
    }
    this.view = view;
    this.targetColor = view.currentColor;
    if (countChanged) {
      this.resize(this.width, this.height);
    }

    const [dx, dy] = this.deckPos();
    const keepIds = new Set<number>();
    const isFreshDeal = roundChanged || effects.some((e) => e.kind === 'deal');

    view.selfHand.forEach((card, idx) => {
      keepIds.add(card.uid);
      let sp = this.sprites.get(card.uid);
      if (!sp) {
        sp = new CardSprite(card, card.uid, dx, dy, this.pileScale, ++this.seq);
        sp.va += (Math.random() - 0.5) * 240;
        sp.vy -= 140;
        if (isFreshDeal) {
          sp.delay = Math.min(idx * 0.055, 0.9);
          sp.boost = sp.delay + 1.1;
        } else {
          sp.boost = 1.05;
        }
        this.sprites.set(card.uid, sp);
      } else {
        sp.card = card;
        sp.isPile = false;
      }
    });

    view.opponentCardIds.forEach((uid, idx) => {
      keepIds.add(uid);
      let sp = this.sprites.get(uid);
      if (!sp) {
        sp = new CardSprite(null, uid, dx, dy, this.pileScale, ++this.seq);
        sp.va += (Math.random() - 0.5) * 200;
        sp.vy += 120;
        if (isFreshDeal) {
          sp.delay = Math.min(idx * 0.06 + 0.03, 0.9);
          sp.boost = sp.delay + 1.1;
        } else {
          sp.boost = 1.05;
        }
        this.sprites.set(uid, sp);
      } else {
        sp.card = null;
        sp.hov = 0;
        sp.isPile = false;
      }
    });

    view.discardPile.forEach((card, idx) => {
      keepIds.add(card.uid);
      let sp = this.sprites.get(card.uid);
      if (!sp) {
        sp = new CardSprite(card, card.uid, dx, dy, this.pileScale, ++this.seq);
        sp.jx = (Math.random() - 0.5) * 14;
        sp.jy = (Math.random() - 0.5) * 10;
        sp.ja = (Math.random() - 0.5) * 28;
        if (isFreshDeal && idx === 0) {
          sp.delay = 0.65;
          sp.boost = 1.6;
        } else {
          sp.boost = 1.0;
          sp.vs += 5.2;
        }
        sp.hov = 0;
        sp.isPile = true;
        this.sprites.set(card.uid, sp);
      } else {
        sp.card = card;
        sp.hov = 0;
        if (!sp.isPile) {
          sp.seq = ++this.seq;
          sp.jx = (Math.random() - 0.5) * 14;
          sp.jy = (Math.random() - 0.5) * 10;
          sp.ja = (Math.random() - 0.5) * 28;
          sp.boost = 1.0;
          sp.vs += 5.5;
          sp.vy -= 180;
          sp.isPile = true;
          this.hoverCardIndex = null;
        }
      }
    });

    for (const uid of this.sprites.keys()) {
      if (!keepIds.has(uid)) {
        this.sprites.delete(uid);
      }
    }

    for (const eff of effects) {
      this.triggerEffect(eff);
    }
  }

  private triggerEffect(eff: EffectEvent): void {
    const [px, py] = this.pilePos();
    const [dx, dy] = this.deckPos();

    if (eff.kind === 'deal') {
      if (eff.isJasirBoost) {
        this.addBanner('7 POWER CARDS!', this.theme.accent, 0.65, 1.9, -75, 0.15);
        this.spawnBurst(this.cx, this.cy, this.theme.accent, 34, 320);
        this.spawnRing(this.cx, this.cy, this.theme.accent, 40, 260, 0.8, 5);
      } else if (eff.difficulty === 'no_mercy') {
        this.addBanner('NO MERCY!', '#f43f5e', 0.68, 1.15, -20, 0.5);
        this.spawnRing(this.cx, this.cy, '#f43f5e', 30, 220, 0.7, 4);
      } else {
        this.addBanner('GAME ON', this.theme.accent, 0.55, 0.95, -20, 0.55);
      }
      return;
    }

    if (eff.kind === 'reshuffle') {
      this.spawnRing(dx, dy, '#ffffff', 28, 165, 0.65, 4);
      this.spawnBurst(dx, dy, '#ffffff', 24, 230);
      this.addBanner('RESHUFFLE', '#ffffff', 0.52, 1.0, -110);
      return;
    }

    if (eff.kind === 'uno') {
      const text = eff.isSelf ? 'UNO!' : `${eff.whoName.toUpperCase()}: UNO!`;
      const col = eff.isSelf ? this.theme.accent : '#ff7b7b';
      this.addBanner(text, col, eff.isSelf ? 1.15 : 0.9, 1.25, -90, 0.2);
      if (eff.isSelf) {
        this.spawnBurst(this.cx, this.cy - 90, this.theme.accent, 32, 320);
        this.spawnRing(this.cx, this.cy - 90, this.theme.accent, 30, 210, 0.65, 4);
      }
      return;
    }

    if (eff.kind === 'uno_penalty') {
      const text = eff.isSelf ? 'NO UNO! +2 PENALTY' : `${eff.whoName.toUpperCase()}: NO UNO! +2`;
      this.addBanner(text, '#f43f5e', 0.72, 1.5, -80, 0.05);
      if (!this.reducedMotion) {
        this.shake = Math.max(this.shake, 10);
        this.tableFlash = 0.35;
        this.tableFlashColor = '#f43f5e';
      }
      this.spawnBurst(this.cx, this.cy - 40, '#f43f5e', 34, 330);
      this.spawnRing(this.cx, this.cy - 40, '#f43f5e', 24, 230, 0.75, 4.5);
      return;
    }

    if (eff.kind === 'roulette') {
      const col = this.theme.suitHex[eff.color];
      this.addBanner(`ROULETTE +${eff.drawnCount}!`, col, 0.85, 1.45, -75, 0.08);
      if (!this.reducedMotion) {
        this.shake = Math.max(this.shake, 11);
        this.tableFlash = 0.36;
        this.tableFlashColor = col;
      }
      this.spawnBurst(px, py, col, 40, 360);
      this.spawnRing(px, py, '#ffffff', 22, 260, 0.8, 4.5);
      return;
    }

    if (eff.kind === 'dump') {
      const col = this.theme.suitHex[eff.color];
      this.addBanner(`DISCARD ALL ×${eff.count}`, col, 0.78, 1.3, -65, 0.05);
      this.spawnBurst(px, py, col, 32, 310);
      this.spawnRing(px, py, col, 20, 220, 0.7, 4);
      return;
    }

    if (eff.kind === 'mercy_ko') {
      const text = eff.isSelfLoser ? 'MERCY KO · 25+ CARDS' : `${eff.loserName.toUpperCase()} KO!`;
      this.addBanner(text, '#f43f5e', 0.85, 1.7, -75, 0);
      if (!this.reducedMotion) {
        this.shake = Math.max(this.shake, 16);
        this.tableFlash = 0.55;
        this.tableFlashColor = '#f43f5e';
      }
      this.spawnBurst(this.cx, this.cy, '#f43f5e', 48, 390);
      this.spawnRing(this.cx, this.cy, '#f43f5e', 30, 340, 0.9, 6);
      return;
    }

    if (eff.kind === 'win') {
      const m = eff.milestone ?? null;
      this.winMilestone = m;
      this.winBurstCooldown = 0.9;
      const accent = this.theme.accent;
      const suitCols = COLORS.map((c) => this.theme.suitHex[c]);

      if (m === 10) {
        this.spawnConfetti(110);
        if (!this.reducedMotion) {
          this.shake = 12;
          this.tableFlash = 0.55;
          this.tableFlashColor = accent;
        }
        this.spawnRing(this.cx, this.cy, accent, 30, 380, 1.0, 7);
        this.spawnRing(this.cx, this.cy, '#ffffff', 20, 300, 0.8, 4.5);
        this.spawnBurst(this.cx, this.cy, accent, 55, 420, 220);
        for (let k = 0; k < 10; k++) {
          const ang = (k / 10) * Math.PI * 2;
          const dist = Math.min(this.width, this.height) * 0.28;
          setTimeout(() => {
            this.spawnBurst(
              this.cx + Math.cos(ang) * dist,
              this.cy + Math.sin(ang) * dist * 0.72,
              k % 2 === 0 ? accent : suitCols[k % 4],
              36,
              360,
              260
            );
            this.spawnRing(
              this.cx + Math.cos(ang) * dist,
              this.cy + Math.sin(ang) * dist * 0.72,
              '#ffffff',
              12,
              110,
              0.55,
              3
            );
          }, k * 90);
        }
      } else if (m === 5) {
        this.spawnConfetti(90);
        if (!this.reducedMotion) {
          this.shake = 8;
          this.tableFlash = 0.42;
          this.tableFlashColor = accent;
        }
        this.spawnRing(this.cx, this.cy, accent, 25, 320, 0.9, 6);
        this.spawnBurst(this.cx, this.cy, accent, 42, 370, 240);
        for (let k = 0; k < 5; k++) {
          const ang = -Math.PI / 2 + (k / 5) * Math.PI * 2;
          const dist = Math.min(this.width, this.height) * 0.25;
          setTimeout(() => {
            this.spawnBurst(
              this.cx + Math.cos(ang) * dist,
              this.cy + Math.sin(ang) * dist * 0.78,
              suitCols[k % 4],
              40,
              360,
              280
            );
            this.spawnRing(
              this.cx + Math.cos(ang) * dist,
              this.cy + Math.sin(ang) * dist * 0.78,
              accent,
              15,
              130,
              0.6,
              3.5
            );
          }, k * 110);
        }
      } else if (m === 1) {
        this.spawnConfetti(85);
        if (!this.reducedMotion) {
          this.tableFlash = 0.35;
          this.tableFlashColor = accent;
        }
        this.spawnRing(this.cx, this.cy, accent, 20, 290, 0.9, 5.5);
        this.spawnRing(this.cx, this.cy, '#ffffff', 15, 220, 0.7, 3.5);
        this.spawnBurst(this.cx, this.cy, accent, 40, 350, 240);
        for (let k = 0; k < 7; k++) {
          setTimeout(() => {
            this.spawnBurst(
              140 + Math.random() * (this.width - 280),
              110 + Math.random() * (this.height * 0.45),
              k % 2 === 0 ? accent : suitCols[k % 4],
              34,
              340
            );
          }, k * 120);
        }
      } else {
        this.spawnConfetti(75);
        this.spawnRing(this.cx, this.cy, accent, 25, 240, 0.75, 4.5);
        for (let k = 0; k < 5; k++) {
          setTimeout(() => {
            this.spawnBurst(
              120 + Math.random() * (this.width - 240),
              100 + Math.random() * (this.height * 0.45),
              suitCols[Math.floor(Math.random() * 4)],
              38,
              360
            );
          }, k * 130);
        }
      }
      return;
    }

    if (eff.kind === 'banner') {
      this.addBanner(
        eff.text,
        eff.color,
        eff.size ?? 0.9,
        eff.dur ?? 1.1,
        eff.dy ?? -20,
        eff.delay ?? 0
      );
      return;
    }

    if (eff.kind === 'impact') {
      const col = this.theme.suitHex[eff.activeColor];
      this.spawnBurst(px, py, col, 30, 300);
      this.spawnBurst(px, py, '#ffffff', 12, 215);
      this.spawnRing(px, py, col, 28, 180, 0.64, 5.5);

      if (!this.reducedMotion) {
        this.tableFlash = 0.25;
        this.tableFlashColor = col;
      }

      if (eff.card.value === 'Skip') {
        this.addBanner('SKIP!', col, 1.0);
        this.spawnRing(px, py, '#ffffff', 16, 215, 0.72, 3.5);
      } else if (eff.card.value === 'Skip All') {
        this.addBanner('SKIP ALL!', col, 1.05);
        this.spawnRing(px, py, '#ffffff', 16, 240, 0.75, 4);
        this.spawnRing(px, py, col, 28, 285, 0.85, 3);
      } else if (eff.card.value === 'Reverse') {
        this.addBanner('REVERSE!', col, 1.0);
        this.spawnRing(px, py, '#ffffff', 16, 215, 0.72, 3.5);
      } else if (eff.card.value === '+2') {
        this.addBanner('+2', col, 1.25);
        if (!this.reducedMotion) this.shake = Math.max(this.shake, 7.5);
        this.spawnRing(px, py, '#ffffff', 20, 230, 0.72, 4);
      } else if (eff.card.value === '+4') {
        this.addBanner('+4', col, 1.45);
        if (!this.reducedMotion) {
          this.shake = Math.max(this.shake, 14);
          this.tableFlash = 0.4;
        }
        this.spawnRing(px, py, '#ffffff', 20, 270, 0.85, 5);
        this.spawnRing(px, py, col, 35, 310, 0.95, 3.5);
      } else if (eff.card.value === '+6') {
        this.addBanner('+6!', '#fb923c', 1.55);
        if (!this.reducedMotion) {
          this.shake = Math.max(this.shake, 17);
          this.tableFlash = 0.48;
        }
        this.spawnBurst(px, py, '#fb923c', 42, 380);
        this.spawnRing(px, py, '#ffffff', 24, 300, 0.9, 5.5);
        this.spawnRing(px, py, col, 38, 350, 1.0, 4);
      } else if (eff.card.value === '+10') {
        this.addBanner('+10!!', '#f43f5e', 1.7);
        if (!this.reducedMotion) {
          this.shake = Math.max(this.shake, 22);
          this.tableFlash = 0.62;
          this.tableFlashColor = '#f43f5e';
        }
        this.spawnBurst(px, py, '#f43f5e', 60, 420);
        this.spawnBurst(px, py, '#fbbf24', 28, 340);
        this.spawnRing(px, py, '#ffffff', 24, 340, 0.95, 6);
        this.spawnRing(px, py, '#f43f5e', 44, 410, 1.05, 5);
      } else if (eff.card.value === 'Roulette') {
        this.addBanner(`ROULETTE · ${eff.activeColor.toUpperCase()}`, col, 0.95);
        this.spawnRing(px, py, col, 24, 280, 0.85, 5);
      } else if (eff.card.value === 'Wild') {
        this.addBanner(eff.activeColor.toUpperCase(), col, 1.05);
        this.spawnRing(px, py, col, 20, 240, 0.78, 5);
      }
    }
  }

  public wiggleCard(uid: number): void {
    const sp = this.sprites.get(uid);
    if (!sp) return;
    const dir = Math.random() < 0.5 ? -1 : 1;
    sp.vx += dir * 420;
    sp.va += dir * 220;
  }

  public setPointer(x: number, y: number): boolean {
    this.pointerX = x;
    this.pointerY = y;
    const hit = this.hitTest(x, y);
    if (hit?.type === 'card') {
      this.hoverCardIndex = hit.index;
      this.hoverDeck = false;
      return true;
    }
    if (hit?.type === 'deck') {
      this.hoverCardIndex = null;
      this.hoverDeck = true;
      return true;
    }
    this.hoverCardIndex = null;
    this.hoverDeck = false;
    return false;
  }

  public clearPointer(): void {
    this.pointerX = -999;
    this.pointerY = -999;
    this.hoverCardIndex = null;
    this.hoverDeck = false;
  }

  public hitTest(mx: number, my: number): CanvasHit {
    if (!this.view) return null;
    const isMyTurn = this.view.turn === this.view.selfRole;

    if (isMyTurn) {
      const [dx, dy] = this.deckPos();
      const dhw = (BASE_W / 2) * this.pileScale;
      const dhh = (BASE_H / 2) * this.pileScale;
      if (mx >= dx - dhw && mx <= dx + dhw && my >= dy - dhh && my <= dy + dhh) {
        return { type: 'deck' };
      }
    }

    const hand = this.view.selfHand;
    if (this.hoverCardIndex !== null && this.hoverCardIndex < hand.length) {
      const card = hand[this.hoverCardIndex];
      const sp = this.sprites.get(card.uid);
      if (sp && sp.delay <= 0) {
        const hw = (BASE_W / 2) * sp.s * 1.14;
        const hh = (BASE_H / 2) * sp.s * 1.14;
        if (Math.abs(mx - sp.x) <= hw && my >= sp.y - 34 - hh && my <= sp.y + hh) {
          return { type: 'card', index: this.hoverCardIndex, uid: card.uid };
        }
      }
    }

    for (let i = hand.length - 1; i >= 0; i--) {
      const card = hand[i];
      const sp = this.sprites.get(card.uid);
      if (!sp || sp.delay > 0) continue;
      const hw = (BASE_W / 2) * sp.s;
      const hh = (BASE_H / 2) * sp.s;
      if (Math.abs(mx - sp.x) <= hw && my >= sp.y - hh - 8 && my <= sp.y + hh) {
        return { type: 'card', index: i, uid: card.uid };
      }
    }

    return null;
  }

  private addBanner(text: string, color: string, size = 1, dur = 1.1, dy = -20, delay = 0): void {
    this.banners.push({ text, color, size, dur, dy, t0: this.t + delay });
  }

  private addParticle(p: Particle): void {
    if (this.particles.length < 420) {
      this.particles.push(p);
    }
  }

  private spawnBurst(x: number, y: number, color: string, n = 24, speed = 260, g = 320): void {
    if (this.reducedMotion) n = Math.min(n, 6);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = (0.3 + Math.random() * 0.7) * speed;
      const life = 0.45 + Math.random() * 0.55;
      this.addParticle({
        kind: 'spark',
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        life,
        max: life,
        size: 2 + Math.random() * 3.2,
        color,
        g,
      });
    }
  }

  private spawnRing(x: number, y: number, color: string, r0 = 20, r1 = 140, dur = 0.55, w = 5): void {
    this.addParticle({ kind: 'ring', x, y, r0, r1, life: dur, max: dur, color, w });
  }

  private spawnConfetti(n = 3): void {
    if (this.reducedMotion) return;
    const colors = [
      this.theme.suitHex.Red,
      this.theme.suitHex.Blue,
      this.theme.suitHex.Green,
      this.theme.suitHex.Yellow,
      this.theme.accent,
      '#ffffff',
    ];
    for (let i = 0; i < n; i++) {
      const life = 2.2 + Math.random() * 1.4;
      this.addParticle({
        kind: 'conf',
        x: Math.random() * this.width,
        y: -12,
        vx: (Math.random() - 0.5) * 140,
        vy: 120 + Math.random() * 140,
        life,
        max: life,
        g: 40,
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 14,
        w: 6 + Math.random() * 5,
        h: 4 + Math.random() * 3,
        color: colors[Math.floor(Math.random() * colors.length)],
      });
    }
  }

  private layoutSprites(): void {
    if (!this.view) return;
    const isMyTurn = this.view.turn === this.view.selfRole;
    const topCard = this.view.discardPile[this.view.discardPile.length - 1];

    const nSelf = this.view.selfHand.length;
    const compact = this.width < 680;
    const baseY = this.height - (compact ? 72 : 82);
    const maxSpan = Math.max(220, this.width - (compact ? 110 : 440));
    const stepSelf = nSelf > 1 ? Math.max(compact ? 16 : 20, Math.min(70 * this.handScale, maxSpan / (nSelf - 1))) : 0;
    const halfSelf = Math.max((nSelf - 1) / 2, 0.001);

    this.view.selfHand.forEach((card, i) => {
      const sp = this.sprites.get(card.uid);
      if (!sp) return;
      const t = i - (nSelf - 1) / 2;
      const u = nSelf > 1 ? t / halfSelf : 0;
      const playable =
        isMyTurn &&
        (this.view!.drawnUid === null || card.uid === this.view!.drawnUid) &&
        canPlayCard(card, topCard, this.view!.currentColor, this.view!.pendingDrawMin);

      const breath = playable && !this.reducedMotion ? Math.sin(this.t * 3.8 + i * 0.55) * 4.2 : 0;

      sp.arriveFace = true;
      sp.tx = this.cx + t * stepSelf;
      sp.ty = baseY + u * u * (compact ? 10 : 18) - (playable ? 17 : 0) + breath;
      sp.ta = u * Math.min(10, 1.8 * halfSelf + 0.5);
      sp.ts = this.handScale;
      sp.tdim = isMyTurn && !playable ? 0.54 : 0;
      sp.tglow = playable ? 1 : 0;
    });

    const nOpp = this.view.opponentCardIds.length;
    const stepOpp = nOpp > 1 ? Math.min(36 * (this.opponentScale / 0.58), (compact ? 190 : 350) / (nOpp - 1)) : 0;
    const halfOpp = Math.max((nOpp - 1) / 2, 0.001);
    this.view.opponentCardIds.forEach((uid, i) => {
      const sp = this.sprites.get(uid);
      if (!sp) return;
      const t = i - (nOpp - 1) / 2;
      const u = nOpp > 1 ? t / halfOpp : 0;
      const sway = !this.reducedMotion ? Math.sin(this.t * 2.0 + i * 0.4) * 1.1 : 0;
      sp.arriveFace = false;
      sp.hov = 0;
      sp.tx = this.cx + t * stepOpp;
      sp.ty = this.tableRect[1] + (compact ? 28 : 34) + (1 - u * u) * 5 + sway;
      sp.ta = -u * 5;
      sp.ts = this.opponentScale;
      sp.tdim = 0;
      sp.tglow = 0;
    });

    const [px, py] = this.pilePos();
    for (const card of this.view.discardPile) {
      const sp = this.sprites.get(card.uid);
      if (!sp) continue;
      sp.arriveFace = true;
      sp.tx = px + sp.jx;
      sp.ty = py + sp.jy;
      sp.ta = sp.ja;
      sp.ts = this.pileScale;
      sp.tdim = 0;
      sp.tglow = 0;
    }
  }

  public step(rawDt: number): void {
    const dt = Math.min(rawDt, 0.05);
    this.t += dt;
    this.layoutSprites();

    if (!this.reducedMotion) {
      for (const m of this.motes) {
        m.fx = (m.fx + m.vx * dt + 1) % 1;
        m.fy = (m.fy + m.vy * dt + 1) % 1;
      }
    }

    const [dx, dy] = this.deckPos();
    const steps = this.reducedMotion ? 1 : Math.max(1, Math.ceil(dt / (1 / 120)));
    const stepDt = dt / steps;

    for (const sp of this.sprites.values()) {
      if (sp.delay > 0) {
        sp.x = dx;
        sp.y = dy;
      }
      if (this.reducedMotion) {
        sp.delay = 0;
        sp.x += (sp.tx - sp.x) * 0.45;
        sp.y += (sp.ty - sp.y) * 0.45;
        sp.a += (sp.ta - sp.a) * 0.45;
        sp.s += (sp.ts - sp.s) * 0.45;
        sp.facing = sp.arriveFace ? 1 : 0;
        sp.dim = sp.tdim;
        sp.glow = sp.tglow;
      } else {
        for (let k = 0; k < steps; k++) {
          sp.update(stepDt);
        }
        if (sp.boost > 0 && sp.delay <= 0) {
          const speed = Math.hypot(sp.vx, sp.vy);
          if (speed > 340 && Math.random() < 0.78) {
            let col = sp.facing > 0.5 && sp.card ? this.theme.suitHex[sp.card.color] : '#ffffff';
            if (sp.card?.color === 'Wild') {
              col = this.theme.suitHex[COLORS[Math.floor(Math.random() * 4)]];
            }
            this.addParticle({
              kind: 'spark',
              x: sp.x + (Math.random() - 0.5) * 14,
              y: sp.y + (Math.random() - 0.5) * 14,
              vx: (Math.random() - 0.5) * 55,
              vy: (Math.random() - 0.5) * 55,
              life: 0.4,
              max: 0.4,
              size: 2.2 + Math.random() * 2.6,
              color: col,
              g: 0,
            });
          }
        }
      }
    }

    if (this.view) {
      this.view.selfHand.forEach((card, idx) => {
        const sp = this.sprites.get(card.uid);
        if (!sp) return;
        const targetHov = idx === this.hoverCardIndex ? 1 : 0;
        sp.hov += (targetHov - sp.hov) * smoothingAlpha(dt, 16);
      });
    }
    const targetDeckHov = this.hoverDeck ? 1 : 0;
    this.deckHoverAnim += (targetDeckHov - this.deckHoverAnim) * smoothingAlpha(dt, 14);

    const nextParticles: Particle[] = [];
    for (const p of this.particles) {
      p.life -= dt;
      if (p.life <= 0) continue;
      if (p.kind !== 'ring') {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += p.g * dt;
        const drag = Math.max(0, 1 - 1.4 * dt);
        p.vx *= drag;
        if (p.kind === 'conf') {
          p.rot += p.vr * dt;
        }
        if (p.y > this.height + 30) continue;
      }
      nextParticles.push(p);
    }
    this.particles = nextParticles;

    const tgt = hexToRgb(this.theme.suitHex[this.targetColor]);
    const k = smoothingAlpha(dt, 5);
    this.glowRgb = [
      this.glowRgb[0] + (tgt[0] - this.glowRgb[0]) * k,
      this.glowRgb[1] + (tgt[1] - this.glowRgb[1]) * k,
      this.glowRgb[2] + (tgt[2] - this.glowRgb[2]) * k,
    ];

    this.shake = Math.max(0, this.shake - dt * 30);
    this.tableFlash = Math.max(0, this.tableFlash - dt * 1.1);

    if (this.view?.winner && this.view.winner === this.view.selfRole) {
      const confChance = this.winMilestone === 10 ? 0.85 : this.winMilestone === 5 ? 0.7 : 0.5;
      if (Math.random() < confChance) {
        this.spawnConfetti(this.winMilestone === 10 ? 2 : 1);
      }
      if (!this.reducedMotion) {
        this.winBurstCooldown -= dt;
        if (this.winBurstCooldown <= 0) {
          this.winBurstCooldown = this.winMilestone === 10 ? 0.55 : this.winMilestone === 5 ? 0.8 : 1.25;
          const bx = 100 + Math.random() * Math.max(120, this.width - 200);
          const by = 80 + Math.random() * Math.max(100, this.height * 0.5);
          const col =
            Math.random() < 0.45
              ? this.theme.accent
              : this.theme.suitHex[COLORS[Math.floor(Math.random() * 4)]];
          this.spawnBurst(bx, by, col, this.winMilestone ? 30 : 22, 290, 260);
          this.spawnRing(bx, by, col, 10, 95, 0.55, 2.5);
        }
      }
    }

    if (this.pointerX >= 0 && this.pointerY >= 0) {
      this.setPointer(this.pointerX, this.pointerY);
    }

    this.render();
  }

  private get glowHex(): string {
    return `rgb(${Math.round(this.glowRgb[0])}, ${Math.round(this.glowRgb[1])}, ${Math.round(this.glowRgb[2])})`;
  }

  private render(): void {
    const ctx = this.ctx;
    const th = this.theme;
    ctx.save();
    ctx.scale(this.dpr, this.dpr);

    const bgGrad = ctx.createLinearGradient(0, 0, 0, this.height);
    bgGrad.addColorStop(0, th.bgTop);
    bgGrad.addColorStop(0.55, th.bgMid);
    bgGrad.addColorStop(1, th.bgBottom);
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, this.width, this.height);

    const spot = ctx.createRadialGradient(
      this.cx,
      this.cy,
      this.width * 0.05,
      this.cx,
      this.cy,
      Math.max(this.width, this.height) * 0.72
    );
    spot.addColorStop(0, 'rgba(255, 246, 224, 0.055)');
    spot.addColorStop(0.55, 'rgba(0, 0, 0, 0)');
    spot.addColorStop(1, 'rgba(0, 0, 0, 0.48)');
    ctx.fillStyle = spot;
    ctx.fillRect(0, 0, this.width, this.height);

    if (this.view?.winner && this.view.winner === this.view.selfRole && !this.reducedMotion) {
      const rayCount = this.winMilestone === 10 ? 14 : this.winMilestone === 5 ? 10 : 8;
      const rayAlpha = this.winMilestone === 10 ? 0.13 : this.winMilestone ? 0.09 : 0.05;
      const maxR = Math.max(this.width, this.height) * 0.85;
      ctx.save();
      ctx.translate(this.cx, this.height * 0.45);
      ctx.rotate(this.t * (this.winMilestone === 10 ? 0.32 : 0.18));
      ctx.fillStyle = th.accent;
      ctx.globalAlpha = rayAlpha;
      for (let i = 0; i < rayCount; i++) {
        const a0 = (i / rayCount) * Math.PI * 2;
        const a1 = a0 + Math.PI / (rayCount * 1.4);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(a0) * maxR, Math.sin(a0) * maxR);
        ctx.lineTo(Math.cos(a1) * maxR, Math.sin(a1) * maxR);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }

    for (const b of this.bokeh) {
      const bx = this.width * b.fx + Math.sin(this.t * b.sp + b.ph) * 44;
      const by = this.height * b.fy + Math.cos(this.t * b.sp * 0.8 + b.ph) * 32;
      ctx.fillStyle = mixHex(th.bgMid, th.suitHex[b.color], 0.06);
      ctx.beginPath();
      ctx.arc(bx, by, b.r, 0, Math.PI * 2);
      ctx.fill();
    }

    if (this.shake > 0.5) {
      const sx = Math.sin(this.t * 48) * this.shake;
      const sy = Math.sin(this.t * 41 + 1.7) * this.shake;
      ctx.translate(sx, sy);
    }

    this.drawTable(ctx);
    this.drawDustMotes(ctx);
    this.drawPiles(ctx);
    this.drawMultiOpponents(ctx);
    this.drawCards(ctx);
    this.drawParticles(ctx);
    this.drawBanners(ctx);

    ctx.restore();
  }

  private drawDustMotes(ctx: CanvasRenderingContext2D): void {
    if (this.reducedMotion) return;
    for (const m of this.motes) {
      const alpha = 0.09 + 0.16 * (0.5 + 0.5 * Math.sin(this.t * 2.3 + m.ph));
      ctx.fillStyle = `rgba(255, 250, 232, ${alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(m.fx * this.width, m.fy * this.height, m.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawTable(ctx: CanvasRenderingContext2D): void {
    const th = this.theme;
    const [l, t, r, b] = this.tableRect;
    const mx = (l + r) / 2;
    const my = (t + b) / 2;
    const rx = (r - l) / 2;
    const ry = (b - t) / 2;
    const g = this.glowHex;
    const pulse = 0.5 + 0.5 * Math.sin(this.t * 2.2);

    const glowLayers: Array<[number, number]> = [
      [50, 0.05],
      [36, 0.09],
      [23, 0.14],
      [14, 0.2],
    ];
    for (const [grow, amt] of glowLayers) {
      ctx.fillStyle = mixHex(th.bgMid, g, amt * (0.8 + 0.4 * pulse));
      ctx.beginPath();
      ctx.ellipse(mx, my, rx + grow, ry + grow, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = 'rgba(2, 4, 8, 0.65)';
    ctx.beginPath();
    ctx.ellipse(mx, my + 12, rx + 12, ry + 12, 0, 0, Math.PI * 2);
    ctx.fill();

    const railGrad = ctx.createLinearGradient(0, t - 10, 0, b + 10);
    railGrad.addColorStop(0, th.railLight);
    railGrad.addColorStop(0.5, th.railDark);
    railGrad.addColorStop(1, '#120a07');
    ctx.fillStyle = railGrad;
    ctx.beginPath();
    ctx.ellipse(mx, my, rx + 12, ry + 12, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.lineWidth = 2;
    ctx.strokeStyle = mixHex(th.railTrim, g, 0.28 + 0.2 * pulse);
    ctx.beginPath();
    ctx.ellipse(mx, my, rx + 5, ry + 5, 0, 0, Math.PI * 2);
    ctx.stroke();

    // Active-turn sweeping rim beam along the outer rail
    const isMyTurn = Boolean(this.view && this.view.turn === this.view.selfRole);
    if (isMyTurn && !this.reducedMotion) {
      const beamStart = (this.t * 1.35) % (Math.PI * 2);
      ctx.save();
      ctx.lineWidth = 3;
      ctx.strokeStyle = th.accent;
      ctx.globalAlpha = 0.65;
      ctx.beginPath();
      ctx.ellipse(mx, my, rx + 5, ry + 5, 0, beamStart, beamStart + 0.65);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(mx, my, rx + 5, ry + 5, 0, beamStart + Math.PI, beamStart + Math.PI + 0.65);
      ctx.stroke();
      ctx.restore();
    }

    const feltGrad = ctx.createRadialGradient(mx, my - ry * 0.14, rx * 0.05, mx, my, rx);
    feltGrad.addColorStop(0, th.feltCenter);
    feltGrad.addColorStop(0.62, th.feltMid);
    feltGrad.addColorStop(1, th.feltEdge);
    ctx.fillStyle = feltGrad;
    ctx.beginPath();
    ctx.ellipse(mx, my, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();

    // Impact spotlight flash on felt
    if (this.tableFlash > 0.01) {
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(mx, my, rx, ry, 0, 0, Math.PI * 2);
      ctx.clip();
      ctx.globalAlpha = this.tableFlash * 0.35;
      ctx.fillStyle = this.tableFlashColor;
      ctx.fillRect(l, t, r - l, b - t);
      ctx.restore();
    }

    if (this.feltPattern) {
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(mx, my, rx, ry, 0, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = this.feltPattern;
      ctx.fillRect(l, t, r - l, b - t);
      ctx.restore();
    }

    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.beginPath();
    ctx.ellipse(mx, my, rx - 1, ry - 1, 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.lineWidth = 1.25;
    ctx.strokeStyle = mixHex(th.feltMid, th.railTrim, 0.32);
    ctx.beginPath();
    ctx.ellipse(mx, my, Math.max(20, rx - 18), Math.max(20, ry - 18), 0, 0, Math.PI * 2);
    ctx.stroke();

    // Rotating orbital arcs + orbiting sparkles around discard pile
    const [px, py] = this.pilePos();
    const arcR = 90 * (this.pileScale / 1.2);
    const dir = this.view?.direction ?? 1;
    ctx.lineWidth = 3;
    ctx.strokeStyle = g;
    for (let i = 0; i < 3; i++) {
      const startDeg = (this.t * 78 * dir + i * 120 + 3600) % 360;
      const start = (startDeg * Math.PI) / 180;
      const extent = (62 * Math.PI) / 180;
      ctx.beginPath();
      ctx.arc(px, py, arcR, start, start + extent);
      ctx.stroke();

      const tipAngle = dir === 1 ? start + extent : start;
      const sx = px + Math.cos(tipAngle) * arcR;
      const sy = py + Math.sin(tipAngle) * arcR;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(sx, sy, 2.3, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.lineWidth = 2;
    ctx.strokeStyle = mixHex(th.feltMid, g, 0.55);
    const outerStart = ((-this.t * 45 * dir) * Math.PI) / 180;
    ctx.beginPath();
    ctx.arc(px, py, arcR + 10, outerStart, outerStart + (34 * Math.PI) / 180);
    ctx.stroke();
  }

  private drawMultiOpponents(ctx: CanvasRenderingContext2D): void {
    const view = this.view;
    if (!view || view.playerCount <= 2 || !view.seats || view.seats.length <= 2) return;

    const total = view.seats.length;
    const oppSeats = [];
    for (let offset = 1; offset < total; offset++) {
      oppSeats.push(view.seats[(view.selfIndex + offset) % total]);
    }
    const nOpp = oppSeats.length;
    const compact = this.width < 680;
    const [l, t, r, b] = this.tableRect;
    const mx = (l + r) / 2;
    const spanX = Math.max(120, (r - l) / 2 - (compact ? 42 : 76));
    const dropY = Math.max(40, (b - t) * (compact ? 0.25 : 0.34));
    const miniScale = compact
      ? nOpp >= 6
        ? 0.24
        : 0.3
      : nOpp >= 7
        ? 0.32
        : nOpp >= 4
          ? 0.37
          : 0.42;
    const minDeg = nOpp >= 6 ? -170 : -148;
    const maxDeg = nOpp >= 6 ? -10 : -32;

    oppSeats.forEach((seat, k) => {
      const frac = nOpp > 1 ? k / (nOpp - 1) : 0.5;
      const deg = minDeg + frac * (maxDeg - minDeg);
      const rad = (deg * Math.PI) / 180;

      const seatX = mx + Math.cos(rad) * spanX;
      const stagger = compact && nOpp >= 6 && k % 2 === 1 ? 14 : 0;
      const seatY = t + (compact ? 30 : 38) + (1 - Math.abs(Math.sin(rad))) * dropY + stagger;
      const isTurn = view.turnIndex === seat.index && view.turn !== 'over';

      if (!seat.eliminated) {
        const shownCards = Math.min(seat.cardCount, nOpp >= 7 ? 3 : 4);
        const step = (compact ? 7 : 10) * (miniScale / 0.36);
        for (let c = 0; c < shownCards; c++) {
          const off = c - (shownCards - 1) / 2;
          const cx = seatX + off * step;
          const cy = seatY + Math.abs(off) * 1.4;
          const ang = off * 7;
          this.drawCard(
            ctx,
            null,
            cx,
            cy,
            ang,
            miniScale,
            0,
            seat.connected ? 0 : 0.45,
            isTurn && c === shownCards - 1 ? 0.8 : 0,
            this.theme.accent,
            0,
            false
          );
        }
      }

      // Seat nameplate below mini hand
      const plateY = seatY + (BASE_H / 2) * miniScale + (compact ? 12 : 14);
      const plateW = compact ? (nOpp >= 6 ? 68 : 84) : nOpp >= 7 ? 94 : 112;
      const plateH = compact ? 20 : 22;

      ctx.save();
      ctx.fillStyle = isTurn
        ? mixHex(this.theme.surface, this.theme.accent, 0.22)
        : 'rgba(9, 15, 22, 0.84)';
      ctx.strokeStyle = seat.eliminated
        ? '#64748b'
        : isTurn
          ? this.theme.accent
          : seat.cardCount === 1
            ? '#f43f5e'
            : this.theme.surfaceBorder;
      ctx.lineWidth = isTurn ? 1.8 : 1.1;
      this.roundRectPath(ctx, seatX - plateW / 2, plateY - plateH / 2, plateW, plateH, 8);
      ctx.fill();
      ctx.stroke();

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const fontPx = compact ? (nOpp >= 6 ? 9 : 10) : 11;
      ctx.font = `700 ${fontPx}px "Plus Jakarta Sans", sans-serif`;

      const statusText = seat.eliminated
        ? 'KO'
        : !seat.connected
          ? 'WAIT'
          : seat.cardCount === 1
            ? 'UNO!'
            : String(seat.cardCount);
      const maxChars = compact && nOpp >= 6 ? 5 : 8;
      const shortName =
        seat.name.length > maxChars ? `${seat.name.slice(0, maxChars - 1)}…` : seat.name;
      const label = `${shortName} · ${statusText}`;

      ctx.fillStyle = seat.eliminated
        ? '#94a3b8'
        : seat.cardCount === 1
          ? '#fda4af'
          : isTurn
            ? this.theme.accent
            : '#eef4f2';
      ctx.fillText(label, seatX, plateY + 0.5, plateW - 10);
      ctx.restore();
    });

    // Subtle direction indicator between piles when 3+ players are active
    const [dx] = this.deckPos();
    const [px, py] = this.pilePos();
    const midX = (dx + px) / 2;
    const dirY = py + 84 * (this.pileScale / 1.2) + 28;
    if (dirY < this.height - 230) {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '700 11px "Plus Jakarta Sans", sans-serif';
      ctx.fillStyle = 'rgba(225, 236, 234, 0.72)';
      ctx.fillText(view.direction === 1 ? '↻ CLOCKWISE' : '↺ COUNTER-CW', midX, dirY);
      ctx.restore();
    }
  }

  private drawPiles(ctx: CanvasRenderingContext2D): void {
    const [dx, dy] = this.deckPos();
    const [px, py] = this.pilePos();
    const s = this.pileScale;
    const labelOffset = 84 * (s / 1.2);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(235, 240, 238, 0.65)';
    ctx.font = `700 ${Math.round(11 * (s / 1.2))}px "Plus Jakarta Sans", sans-serif`;
    ctx.fillText('DRAW PILE', dx, dy - labelOffset);
    ctx.fillText('DISCARD', px, py - labelOffset);

    const view = this.view;
    const isMyTurn = view && view.turn === view.selfRole;
    const topCard = view?.discardPile[view.discardPile.length - 1];
    const mustDraw =
      Boolean(isMyTurn) &&
      view!.drawnUid === null &&
      !view!.selfHand.some((c) =>
        canPlayCard(c, topCard, view!.currentColor, view!.pendingDrawMin)
      );

    if (mustDraw && !this.reducedMotion) {
      const ripplePhase = (this.t * 0.95) % 1;
      const rippleR = (54 + ripplePhase * 36) * (s / 1.2);
      ctx.strokeStyle = this.theme.accent;
      ctx.globalAlpha = (1 - ripplePhase) * 0.6;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(dx, dy, rippleR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    const deckCount = view?.deckCount ?? 0;
    const hov = isMyTurn ? this.deckHoverAnim : 0;

    if (deckCount > 0) {
      const layers = Math.min(5, Math.max(1, Math.floor(deckCount / 6) + 1));
      for (let i = layers - 1; i >= 0; i--) {
        let glow = 0;
        let swayY = 0;
        let swayA = 0;
        if (i === 0) {
          const pulseGlow = mustDraw ? (0.5 + 0.5 * Math.sin(this.t * 5)) * 0.95 : 0;
          glow = Math.max(hov * 0.9, pulseGlow);
          if (mustDraw && !this.reducedMotion) {
            swayY = Math.sin(this.t * 4.2) * 3.5;
            swayA = Math.sin(this.t * 3.1) * 2.2;
          }
        }
        this.drawCard(
          ctx,
          null,
          dx - i * 1.3,
          dy - i * 1.7 - hov * 7 + swayY,
          swayA,
          s,
          0,
          0,
          glow,
          this.theme.accent,
          hov * 7,
          false
        );
      }
    } else {
      ctx.strokeStyle = 'rgba(255,255,255,0.28)';
      ctx.lineWidth = 2;
      this.roundRectPath(ctx, dx - 40 * s, dy - 57 * s, 80 * s, 114 * s, 10 * s);
      ctx.stroke();
    }

    ctx.fillStyle = 'rgba(235, 240, 238, 0.72)';
    ctx.font = `500 ${Math.round(11 * (s / 1.2))}px "JetBrains Mono", monospace`;
    ctx.fillText(`${deckCount} cards`, dx, dy + 82 * (s / 1.2));

    // Active color indicator beneath discard pile
    const activeCol = view?.currentColor ?? 'Red';
    const colHex = this.theme.suitHex[activeCol];
    const cyInd = py + 84 * (s / 1.2);

    ctx.fillStyle = 'rgba(8, 15, 20, 0.85)';
    ctx.strokeStyle = mixHex('#304b56', colHex, 0.72);
    ctx.lineWidth = 1.5;
    this.roundRectPath(ctx, px - 58, cyInd - 15, 116, 30, 15);
    ctx.fill();
    ctx.stroke();

    const r = 6.5 + Math.sin(this.t * 4.4) * 1.2;
    ctx.fillStyle = colHex;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(px - 36, cyInd, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = PALETTE.ink;
    ctx.textAlign = 'left';
    ctx.font = `700 12px "Plus Jakarta Sans", sans-serif`;
    ctx.fillText(activeCol.toUpperCase(), px - 22, cyInd + 0.5);
  }

  private drawCards(ctx: CanvasRenderingContext2D): void {
    if (!this.view) return;
    const pile: CardSprite[] = [];
    const opp: CardSprite[] = [];
    const self: CardSprite[] = [];

    for (const c of this.view.discardPile) {
      const sp = this.sprites.get(c.uid);
      if (sp) {
        sp.hov = 0;
        pile.push(sp);
      }
    }
    for (const uid of this.view.opponentCardIds) {
      const sp = this.sprites.get(uid);
      if (sp) {
        sp.hov = 0;
        opp.push(sp);
      }
    }
    for (const c of this.view.selfHand) {
      const sp = this.sprites.get(c.uid);
      if (sp) self.push(sp);
    }

    const topPileUid = this.view.discardPile[this.view.discardPile.length - 1]?.uid;

    const normal: CardSprite[] = [...pile, ...opp];
    const handNormal: CardSprite[] = [];
    const boosted: CardSprite[] = [];
    for (const sp of self) {
      if (sp.boost > 0) boosted.push(sp);
      else handNormal.push(sp);
    }
    for (let i = normal.length - 1; i >= 0; i--) {
      if (normal[i].boost > 0) {
        boosted.push(normal.splice(i, 1)[0]);
      }
    }

    handNormal.sort((a, b) => (a.hov > 0.02 ? 1 : 0) - (b.hov > 0.02 ? 1 : 0));
    boosted.sort((a, b) => a.seq - b.seq);

    for (const sp of [...normal, ...handNormal, ...boosted]) {
      const lift = sp.isPile ? 0 : sp.hov * 32;
      const s = sp.isPile ? sp.s : sp.s * (1 + 0.15 * sp.hov);
      const a = sp.isPile ? sp.a : sp.a * (1 - 0.85 * sp.hov);
      const glow = Math.max(
        sp.glow * (0.62 + 0.38 * Math.sin(this.t * 4.5 + sp.seq)),
        sp.hov * 0.98
      );
      const showSheen = sp.uid === topPileUid || sp.hov > 0.2;
      this.drawCard(
        ctx,
        sp.card,
        sp.x,
        sp.y - lift,
        a,
        s,
        sp.facing,
        sp.dim * (1 - sp.hov),
        glow,
        this.theme.accent,
        lift,
        showSheen
      );
    }
  }

  private roundRectPath(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number
  ): void {
    const rad = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.lineTo(x + w - rad, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
    ctx.lineTo(x + w, y + h - rad);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
    ctx.lineTo(x + rad, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
    ctx.lineTo(x, y + rad);
    ctx.quadraticCurveTo(x, y, x + rad, y);
    ctx.closePath();
  }

  private drawDiamondPath(ctx: CanvasRenderingContext2D, rx: number, ry: number): void {
    ctx.beginPath();
    ctx.moveTo(0, -ry);
    ctx.lineTo(rx, 0);
    ctx.lineTo(0, ry);
    ctx.lineTo(-rx, 0);
    ctx.closePath();
  }

  private drawPolygonPath(ctx: CanvasRenderingContext2D, sides: number, r: number, rotOffset = 0): void {
    ctx.beginPath();
    for (let i = 0; i < sides; i++) {
      const ang = (i * Math.PI * 2) / sides + rotOffset;
      const px = Math.cos(ang) * r;
      const py = Math.sin(ang) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  private drawCard(
    ctx: CanvasRenderingContext2D,
    card: Card | null,
    x: number,
    y: number,
    angleDeg: number,
    s: number,
    facing: number,
    dim: number,
    glow: number,
    glowColor: string,
    lift: number,
    showSheen: boolean
  ): void {
    const th = this.theme;
    const design = th.cardDesign;
    const fx = Math.max(Math.abs(facing * 2 - 1), 0.03);
    const isFace = facing > 0.5 && card !== null;
    const tone = (col: string) => (dim > 0.01 ? mixHex(col, '#080c12', dim) : col);

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((angleDeg * Math.PI) / 180);
    ctx.scale(s * fx, s);

    // Ambient shadow (hard ink offset shadow for retro comic cards)
    const so = 5 + lift * 0.25;
    if (design === 'comic') {
      ctx.fillStyle = 'rgba(10, 12, 22, 0.82)';
      this.roundRectPath(ctx, -37.5, -54.5 + so, 80, 114, 9);
      ctx.fill();
    } else {
      ctx.fillStyle = 'rgba(2, 5, 10, 0.45)';
      this.roundRectPath(ctx, -41.5, -58.5 + so, 83, 117, 10.5);
      ctx.fill();
    }

    // Playable halo glow
    if (glow > 0.03) {
      const gAlpha = clamp01(glow);
      ctx.fillStyle = mixHex(th.feltMid, glowColor, 0.42 * gAlpha);
      this.roundRectPath(ctx, -46, -63, 92, 126, 14);
      ctx.fill();
      ctx.fillStyle = mixHex(th.feltMid, glowColor, 0.85 * gAlpha);
      this.roundRectPath(ctx, -43, -60, 86, 120, 12);
      ctx.fill();
    }

    // Outer card frame
    ctx.fillStyle = tone(th.cardFrame);
    ctx.strokeStyle = dim < 0.01 ? tone(th.cardFrameOutline) : tone('#64748b');
    ctx.lineWidth =
      design === 'comic'
        ? 2.4
        : design === 'obsidian' || design === 'sunburst'
          ? 1.8
          : 1.5;
    this.roundRectPath(ctx, -40, -57, 80, 114, 9);
    ctx.fill();
    ctx.stroke();

    if (!isFace || !card) {
      this.drawCardBack(ctx, th, fx, tone);
      ctx.restore();
      return;
    }

    const base = th.suitHex[card.color];

    if (design === 'obsidian') {
      // Cyber Eclipse: matte dark body, glowing suit frame, diagonal tech corners (TR/BL), hex crest
      ctx.fillStyle = tone('#0d131d');
      this.roundRectPath(ctx, -35, -52, 70, 104, 6);
      ctx.fill();

      ctx.strokeStyle = card.color === 'Wild' ? tone('#38bdf8') : tone(base);
      ctx.lineWidth = 2;
      this.roundRectPath(ctx, -34, -51, 68, 102, 5.5);
      ctx.stroke();

      // Tech corner chevrons in top-right and bottom-left so corner indices stay unobstructed
      ctx.fillStyle = card.color === 'Wild' ? tone('#38bdf8') : tone(base);
      ctx.beginPath();
      ctx.moveTo(34, -37);
      ctx.lineTo(19, -51);
      ctx.lineTo(34, -51);
      ctx.closePath();
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(-34, 37);
      ctx.lineTo(-19, 51);
      ctx.lineTo(-34, 51);
      ctx.closePath();
      ctx.fill();

      if (card.color === 'Wild') {
        ctx.save();
        this.drawPolygonPath(ctx, 6, 26.5, -Math.PI / 6);
        ctx.clip();
        const quadColors: SuitColor[] = ['Red', 'Blue', 'Green', 'Yellow'];
        for (let i = 0; i < 4; i++) {
          ctx.fillStyle = tone(th.suitHex[quadColors[i]]);
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.arc(0, 0, 32, (i * Math.PI) / 2, ((i + 1) * Math.PI) / 2);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
        ctx.strokeStyle = tone('#ffffff');
        ctx.lineWidth = 2;
        this.drawPolygonPath(ctx, 6, 26.5, -Math.PI / 6);
        ctx.stroke();
      } else {
        ctx.fillStyle = tone('#101927');
        ctx.strokeStyle = tone(base);
        ctx.lineWidth = 2.4;
        this.drawPolygonPath(ctx, 6, 26.5, -Math.PI / 6);
        ctx.fill();
        ctx.stroke();
      }
    } else if (design === 'sunburst') {
      // Pharaoh's Vault: jet onyx interior, gold filigree, sunburst octagon center
      ctx.fillStyle = tone('#110f0a');
      this.roundRectPath(ctx, -35, -52, 70, 104, 6);
      ctx.fill();

      ctx.strokeStyle = tone('#d4a63a');
      ctx.lineWidth = 1.5;
      this.roundRectPath(ctx, -33.5, -50.5, 67, 101, 4.5);
      ctx.stroke();

      // Sunburst rays behind octagon
      ctx.strokeStyle = tone(card.color === 'Wild' ? '#d4a63a' : mixHex(base, '#d4a63a', 0.45));
      ctx.lineWidth = 1.2;
      for (let i = 0; i < 8; i++) {
        const ang = (i * Math.PI) / 4;
        ctx.beginPath();
        ctx.moveTo(Math.cos(ang) * 27.5, Math.sin(ang) * 27.5);
        ctx.lineTo(Math.cos(ang) * 33, Math.sin(ang) * 33);
        ctx.stroke();
      }

      if (card.color === 'Wild') {
        ctx.save();
        this.drawPolygonPath(ctx, 8, 26.5, Math.PI / 8);
        ctx.clip();
        const quadColors: SuitColor[] = ['Red', 'Blue', 'Green', 'Yellow'];
        for (let i = 0; i < 4; i++) {
          ctx.fillStyle = tone(th.suitHex[quadColors[i]]);
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.arc(0, 0, 32, (i * Math.PI) / 2, ((i + 1) * Math.PI) / 2);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
        ctx.strokeStyle = tone('#fde08d');
        ctx.lineWidth = 2.2;
        this.drawPolygonPath(ctx, 8, 26.5, Math.PI / 8);
        ctx.stroke();
      } else {
        ctx.fillStyle = tone(mixHex(base, '#110f0a', 0.72));
        ctx.strokeStyle = tone(base);
        ctx.lineWidth = 2.3;
        this.drawPolygonPath(ctx, 8, 26.5, Math.PI / 8);
        ctx.fill();
        ctx.stroke();
      }
    } else if (design === 'crest') {
      // Kyoto Dusk: silky suit interior, soft porcelain corner arcs (TR/BL), circular seal crest
      ctx.fillStyle = tone(base);
      this.roundRectPath(ctx, -35, -52, 70, 104, 6);
      ctx.fill();

      if (card.color !== 'Wild') {
        ctx.fillStyle = tone(mixHex(base, '#ffffff', 0.14));
        this.roundRectPath(ctx, -35, -52, 70, 52, 6);
        ctx.fill();
      }

      // Corner circular arcs on top-right & bottom-left so corner indices stay crisp
      ctx.strokeStyle = tone('rgba(255, 245, 249, 0.36)');
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(35, -52, 16, Math.PI * 0.5, Math.PI);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(-35, 52, 16, Math.PI * 1.5, Math.PI * 2);
      ctx.stroke();

      if (card.color === 'Wild') {
        const quadColors: SuitColor[] = ['Red', 'Blue', 'Green', 'Yellow'];
        for (let i = 0; i < 4; i++) {
          ctx.fillStyle = tone(th.suitHex[quadColors[i]]);
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.arc(0, 0, 26.5, (i * Math.PI) / 2, ((i + 1) * Math.PI) / 2);
          ctx.closePath();
          ctx.fill();
        }
        ctx.strokeStyle = tone('#ffffff');
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.arc(0, 0, 26.5, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.fillStyle = tone(th.cardCenterBg);
        ctx.strokeStyle = tone(mixHex(base, '#ffffff', 0.45));
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, 26.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    } else if (design === 'prism') {
      // Nordic Aurora: frosted ice sheen, diagonal crystal facet, sharp prism diamond
      ctx.fillStyle = tone(base);
      this.roundRectPath(ctx, -35, -52, 70, 104, 6);
      ctx.fill();

      ctx.fillStyle = tone('rgba(255, 255, 255, 0.16)');
      ctx.beginPath();
      ctx.moveTo(-35, -52);
      ctx.lineTo(35, -52);
      ctx.lineTo(-35, 28);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = tone('rgba(255, 255, 255, 0.32)');
      ctx.lineWidth = 1.2;
      this.roundRectPath(ctx, -32.5, -49.5, 65, 99, 4.5);
      ctx.stroke();

      if (card.color === 'Wild') {
        ctx.save();
        this.drawDiamondPath(ctx, 29, 39);
        ctx.clip();
        const quadColors: SuitColor[] = ['Red', 'Blue', 'Green', 'Yellow'];
        for (let i = 0; i < 4; i++) {
          ctx.fillStyle = tone(th.suitHex[quadColors[i]]);
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.arc(0, 0, 44, (i * Math.PI) / 2, ((i + 1) * Math.PI) / 2);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
        ctx.strokeStyle = tone('#ffffff');
        ctx.lineWidth = 2;
        this.drawDiamondPath(ctx, 29, 39);
        ctx.stroke();
      } else {
        ctx.fillStyle = tone(th.cardCenterBg);
        ctx.strokeStyle = tone('rgba(255,255,255,0.75)');
        ctx.lineWidth = 1.8;
        this.drawDiamondPath(ctx, 29, 39);
        ctx.fill();
        ctx.stroke();
      }
    } else if (design === 'deco') {
      // Velvet Noir: gold double-pinstripe + art-deco diamond
      ctx.fillStyle = tone(base);
      this.roundRectPath(ctx, -35, -52, 70, 104, 6);
      ctx.fill();

      if (card.color !== 'Wild') {
        ctx.fillStyle = tone(mixHex(base, '#ffffff', 0.12));
        this.roundRectPath(ctx, -35, -52, 70, 32, 6);
        ctx.fill();
      }

      ctx.strokeStyle = tone('#f0d086');
      ctx.lineWidth = 1.2;
      this.roundRectPath(ctx, -32.5, -49.5, 65, 99, 4);
      ctx.stroke();

      ctx.fillStyle = tone('#f0d086');
      for (const [cx, cy] of [
        [27, -23],
        [-27, 23],
      ]) {
        ctx.save();
        ctx.translate(cx, cy);
        this.drawDiamondPath(ctx, 2.3, 3.2);
        ctx.fill();
        ctx.restore();
      }

      if (card.color === 'Wild') {
        ctx.save();
        this.drawDiamondPath(ctx, 30, 41);
        ctx.clip();
        const quadColors: SuitColor[] = ['Red', 'Blue', 'Green', 'Yellow'];
        for (let i = 0; i < 4; i++) {
          ctx.fillStyle = tone(th.suitHex[quadColors[i]]);
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.arc(0, 0, 46, (i * Math.PI) / 2 - Math.PI / 4, ((i + 1) * Math.PI) / 2 - Math.PI / 4);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
        ctx.strokeStyle = tone('#f6e2a8');
        ctx.lineWidth = 2.2;
        this.drawDiamondPath(ctx, 30, 41);
        ctx.stroke();
      } else {
        ctx.fillStyle = tone(th.cardCenterBg);
        ctx.strokeStyle = tone('#e8c474');
        ctx.lineWidth = 1.8;
        this.drawDiamondPath(ctx, 30, 41);
        ctx.fill();
        ctx.stroke();
      }
    } else if (design === 'comic') {
      // Retro Toon: thick ink outlines, halftone corner dots, hard offset shadow oval
      ctx.fillStyle = tone(base);
      this.roundRectPath(ctx, -35, -52, 70, 104, 6);
      ctx.fill();

      ctx.strokeStyle = tone('#141414');
      ctx.lineWidth = 2;
      this.roundRectPath(ctx, -35, -52, 70, 104, 6);
      ctx.stroke();

      // Comic halftone corner dots (TR & BL so corner indices stay crisp)
      ctx.fillStyle = tone('rgba(255, 255, 255, 0.24)');
      for (const [bx, by] of [
        [20, -45],
        [27, -45],
        [27, -38],
        [-20, 45],
        [-27, 45],
        [-27, 38],
      ]) {
        ctx.beginPath();
        ctx.arc(bx, by, 2.1, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.save();
      ctx.rotate((24 * Math.PI) / 180);
      // Hard offset ink shadow behind oval
      ctx.fillStyle = tone('#141414');
      ctx.beginPath();
      ctx.ellipse(2.6, 3.2, 28, 41, 0, 0, Math.PI * 2);
      ctx.fill();

      if (card.color === 'Wild') {
        const quadColors: SuitColor[] = ['Red', 'Blue', 'Green', 'Yellow'];
        for (let i = 0; i < 4; i++) {
          ctx.fillStyle = tone(th.suitHex[quadColors[i]]);
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.ellipse(0, 0, 28, 41, 0, (i * Math.PI) / 2, ((i + 1) * Math.PI) / 2);
          ctx.closePath();
          ctx.fill();
        }
        ctx.strokeStyle = tone('#141414');
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.ellipse(0, 0, 28, 41, 0, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.fillStyle = tone(th.cardCenterBg);
        ctx.beginPath();
        ctx.ellipse(0, 0, 28, 41, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = tone('#141414');
        ctx.lineWidth = 2.4;
        ctx.stroke();
      }
      ctx.restore();
    } else {
      // Monte Carlo Classic: glossy oval medallion
      ctx.fillStyle = tone(base);
      this.roundRectPath(ctx, -35, -52, 70, 104, 6);
      ctx.fill();

      if (card.color !== 'Wild') {
        ctx.fillStyle = tone(mixHex(base, '#ffffff', 0.16));
        this.roundRectPath(ctx, -35, -52, 70, 34, 6);
        ctx.fill();
        ctx.fillStyle = tone(mixHex(base, '#000000', 0.12));
        this.roundRectPath(ctx, -35, 24, 70, 28, 6);
        ctx.fill();
      }

      ctx.strokeStyle = tone('rgba(255, 255, 255, 0.24)');
      ctx.lineWidth = 1;
      this.roundRectPath(ctx, -32.5, -49.5, 65, 99, 4.5);
      ctx.stroke();

      if (card.color === 'Wild') {
        ctx.save();
        ctx.rotate((28 * Math.PI) / 180);
        const quadColors: SuitColor[] = ['Red', 'Blue', 'Green', 'Yellow'];
        for (let i = 0; i < 4; i++) {
          ctx.fillStyle = tone(th.suitHex[quadColors[i]]);
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.ellipse(0, 0, 28, 43, 0, (i * Math.PI) / 2, ((i + 1) * Math.PI) / 2);
          ctx.closePath();
          ctx.fill();
        }
        ctx.strokeStyle = tone('#ffffff');
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(0, 0, 28, 43, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      } else {
        ctx.save();
        ctx.rotate((28 * Math.PI) / 180);
        ctx.fillStyle = tone(th.cardCenterBg);
        ctx.beginPath();
        ctx.ellipse(0, 0, 28, 43, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = tone(mixHex(base, '#ffffff', 0.35));
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.restore();
      }
    }

    const drawOpticalText = (
      txt: string,
      tx: number,
      ty: number,
      fill: string,
      shadowFill: string,
      shX: number,
      shY: number
    ) => {
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      const m = ctx.measureText(txt);
      const hasMetrics =
        typeof m.actualBoundingBoxLeft === 'number' &&
        typeof m.actualBoundingBoxRight === 'number' &&
        typeof m.actualBoundingBoxAscent === 'number' &&
        typeof m.actualBoundingBoxDescent === 'number' &&
        m.actualBoundingBoxAscent + m.actualBoundingBoxDescent > 0;
      if (hasMetrics) {
        const cxOff = (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2;
        const cyOff = (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
        const drawX = tx - cxOff;
        const drawY = ty + cyOff;
        ctx.fillStyle = shadowFill;
        ctx.fillText(txt, drawX + shX, drawY + shY);
        ctx.fillStyle = fill;
        ctx.fillText(txt, drawX, drawY);
      } else {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = shadowFill;
        ctx.fillText(txt, tx + shX, ty + shY);
        ctx.fillStyle = fill;
        ctx.fillText(txt, tx, ty);
      }
    };

    const darkFace = design === 'obsidian' || design === 'sunburst';
    const compactEmblem = design === 'obsidian' || design === 'sunburst' || design === 'crest';
    const diamondEmblem = design === 'deco' || design === 'prism';
    const symbolColor = darkFace
      ? tone(card.color === 'Wild' ? '#ffffff' : base)
      : tone(base);

    let corner = card.value;
    if (card.color === 'Wild') {
      if (card.value === '+10') {
        corner = '+10';
        if (fx >= 0.35) {
          const wildSize = compactEmblem ? 19 : diamondEmblem ? 21 : 25;
          ctx.font = `italic 800 ${wildSize}px "Outfit", sans-serif`;
          drawOpticalText('+10', 0, 0, '#fef08a', tone('#0c111a'), 1.8, 2.2);
        }
      } else if (card.value === '+6') {
        corner = '+6';
        if (fx >= 0.35) {
          const wildSize = compactEmblem ? 23 : diamondEmblem ? 25 : 29;
          ctx.font = `italic 800 ${wildSize}px "Outfit", sans-serif`;
          drawOpticalText('+6', 0, 0, '#ffffff', tone('#0c111a'), 1.8, 2.2);
        }
      } else if (card.value === 'Roulette') {
        corner = 'CLR';
        if (fx >= 0.25) {
          const wheelR = compactEmblem ? 13 : 15;
          const quadColors: SuitColor[] = ['Red', 'Blue', 'Green', 'Yellow'];
          ctx.save();
          for (let i = 0; i < 4; i++) {
            ctx.fillStyle = tone(th.suitHex[quadColors[i]]);
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.arc(0, 0, wheelR, (i * Math.PI) / 2, ((i + 1) * Math.PI) / 2);
            ctx.closePath();
            ctx.fill();
          }
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(0, 0, wheelR, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = '#0f172a';
          ctx.beginPath();
          ctx.arc(0, 0, wheelR * 0.36, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.moveTo(0, -wheelR - 4);
          ctx.lineTo(-4, -wheelR + 2);
          ctx.lineTo(4, -wheelR + 2);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
      } else {
        corner = card.value === '+4' ? '+4' : 'W';
        if (card.value === '+4' && fx >= 0.35) {
          const wildSize = compactEmblem ? 25 : diamondEmblem ? 27 : 31;
          ctx.font = `italic 800 ${wildSize}px "Outfit", sans-serif`;
          drawOpticalText('+4', 0, 0, '#ffffff', tone('#0c111a'), 1.8, 2.2);
        }
      }
    } else if (card.value === 'Skip') {
      corner = '⊘';
      if (fx >= 0.25) {
        const rSkip = compactEmblem ? 12.5 : 14.5;
        ctx.strokeStyle = symbolColor;
        ctx.lineWidth = compactEmblem ? 4.8 : 5.5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(0, 0, rSkip, 0, Math.PI * 2);
        ctx.stroke();
        const diag = rSkip * 0.68;
        ctx.beginPath();
        ctx.moveTo(-diag, diag);
        ctx.lineTo(diag, -diag);
        ctx.stroke();
      }
    } else if (card.value === 'Skip All') {
      corner = '⊘⊘';
      if (fx >= 0.25) {
        const rOuter = compactEmblem ? 14 : 16;
        const rInner = compactEmblem ? 8 : 9.5;
        ctx.strokeStyle = symbolColor;
        ctx.lineWidth = compactEmblem ? 3.4 : 3.8;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(0, 0, rOuter, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, 0, rInner, 0, Math.PI * 2);
        ctx.stroke();
        const diag = rOuter * 0.72;
        ctx.beginPath();
        ctx.moveTo(-diag, diag);
        ctx.lineTo(diag, -diag);
        ctx.stroke();
      }
    } else if (card.value === 'Dump') {
      corner = 'ALL';
      if (fx >= 0.25) {
        const scD = compactEmblem ? 0.85 : 1;
        ctx.save();
        ctx.scale(scD, scD);
        ctx.strokeStyle = symbolColor;
        ctx.fillStyle = symbolColor;
        ctx.lineWidth = 2.4;
        ctx.lineJoin = 'round';
        this.roundRectPath(ctx, -11, -12, 13, 17, 2.2);
        ctx.stroke();
        ctx.fillStyle = darkFace ? tone('#101927') : tone(th.cardCenterBg);
        this.roundRectPath(ctx, -4, -6, 13, 17, 2.2);
        ctx.fill();
        ctx.stroke();
        // Downward arrow
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(2.5, -2);
        ctx.lineTo(2.5, 7);
        ctx.stroke();
        ctx.fillStyle = symbolColor;
        ctx.beginPath();
        ctx.moveTo(2.5, 10.5);
        ctx.lineTo(-2, 5);
        ctx.lineTo(7, 5);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    } else if (card.value === 'Reverse') {
      corner = '↻';
      if (fx >= 0.25) {
        const revScale = compactEmblem ? 0.84 : 1;
        ctx.save();
        ctx.scale(revScale, revScale);
        ctx.strokeStyle = symbolColor;
        ctx.fillStyle = symbolColor;
        ctx.lineWidth = 4.5;
        ctx.lineCap = 'round';
        for (const sign of [1, -1]) {
          ctx.save();
          ctx.scale(sign, sign);
          ctx.beginPath();
          ctx.moveTo(-11, 7);
          ctx.lineTo(9, -13);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(13, -17);
          ctx.lineTo(2, -14);
          ctx.lineTo(10, -6);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
        ctx.restore();
      }
    } else if (fx >= 0.35) {
      const isTwoCharDraw = card.value === '+2' || card.value === '+4';
      const fontSize = isTwoCharDraw
        ? compactEmblem
          ? 23
          : diamondEmblem
            ? 25
            : 29
        : compactEmblem
          ? 33
          : diamondEmblem
            ? 35
            : 42;
      ctx.font = `italic 800 ${fontSize}px "Outfit", sans-serif`;
      drawOpticalText(card.value, 0, 0, symbolColor, tone('rgba(0,0,0,0.35)'), 1.8, 2.2);
    }

    if (fx >= 0.35) {
      const isThreeChar = corner.length >= 3;
      const isTwoChar = corner.length === 2;
      const cornerFontPx = isThreeChar ? 9.5 : isTwoChar ? 11.5 : 13;
      ctx.font = `italic 800 ${cornerFontPx}px "Outfit", sans-serif`;
      const cornerColor = darkFace
        ? tone(card.color === 'Wild' ? th.accent : mixHex(base, '#ffffff', 0.35))
        : '#ffffff';
      const shadowCol = tone('rgba(0,0,0,0.45)');
      const cxPos = isThreeChar ? 21.5 : isTwoChar ? 23.5 : 25.5;
      const cyPos = isThreeChar ? 41.2 : 40.5;

      drawOpticalText(corner, -cxPos, -cyPos, cornerColor, shadowCol, 1.0, 1.3);

      ctx.save();
      ctx.translate(cxPos, cyPos);
      ctx.rotate(Math.PI);
      drawOpticalText(corner, 0, 0, cornerColor, shadowCol, -1.0, -1.3);
      ctx.restore();
    }

    if (showSheen && !this.reducedMotion && dim < 0.1) {
      const sweep = ((this.t * 0.72) % 3.0) - 0.9;
      if (sweep >= -0.6 && sweep <= 1.2) {
        ctx.save();
        this.roundRectPath(ctx, -35, -52, 70, 104, 6);
        ctx.clip();
        const xOff = sweep * 110 - 55;
        const grad = ctx.createLinearGradient(xOff - 22, -55, xOff + 22, 55);
        grad.addColorStop(0, 'rgba(255,255,255,0)');
        grad.addColorStop(0.5, 'rgba(255,255,255,0.26)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(-40, -57, 80, 114);
        ctx.restore();
      }
    }

    ctx.restore();
  }

  private drawCardBack(
    ctx: CanvasRenderingContext2D,
    th: TableTheme,
    fx: number,
    tone: (col: string) => string
  ): void {
    ctx.fillStyle = tone(th.cardBackBg);
    this.roundRectPath(ctx, -35, -52, 70, 104, 6);
    ctx.fill();

    ctx.strokeStyle = tone('rgba(255, 255, 255, 0.14)');
    ctx.lineWidth = 1;
    this.roundRectPath(ctx, -32, -49, 64, 98, 4.5);
    ctx.stroke();

    if (th.cardDesign === 'obsidian') {
      ctx.fillStyle = tone(th.cardBackMedallionShadow);
      this.drawPolygonPath(ctx, 6, 26, -Math.PI / 6);
      ctx.fill();

      ctx.fillStyle = tone(th.cardBackMedallion);
      ctx.strokeStyle = tone(th.cardBackBorder);
      ctx.lineWidth = 1.6;
      this.drawPolygonPath(ctx, 6, 23, -Math.PI / 6);
      ctx.fill();
      ctx.stroke();
    } else if (th.cardDesign === 'sunburst') {
      ctx.fillStyle = tone(th.cardBackMedallionShadow);
      this.drawPolygonPath(ctx, 8, 27, Math.PI / 8);
      ctx.fill();

      ctx.fillStyle = tone(th.cardBackMedallion);
      ctx.strokeStyle = tone(th.cardBackBorder);
      ctx.lineWidth = 1.6;
      this.drawPolygonPath(ctx, 8, 24, Math.PI / 8);
      ctx.fill();
      ctx.stroke();
    } else if (th.cardDesign === 'crest') {
      ctx.fillStyle = tone(th.cardBackMedallionShadow);
      ctx.beginPath();
      ctx.arc(0, 2, 26, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = tone(th.cardBackMedallion);
      ctx.strokeStyle = tone(th.cardBackBorder);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(0, 0, 25, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (th.cardDesign === 'deco' || th.cardDesign === 'prism') {
      ctx.fillStyle = tone(th.cardBackMedallionShadow);
      this.drawDiamondPath(ctx, 27, 41);
      ctx.fill();

      ctx.fillStyle = tone(th.cardBackMedallion);
      ctx.strokeStyle = tone(th.cardBackBorder);
      ctx.lineWidth = 1.5;
      this.drawDiamondPath(ctx, 25, 38);
      ctx.fill();
      ctx.stroke();
    } else if (th.cardDesign === 'comic') {
      ctx.strokeStyle = tone('#141414');
      ctx.lineWidth = 2;
      this.roundRectPath(ctx, -35, -52, 70, 104, 6);
      ctx.stroke();

      ctx.save();
      ctx.rotate((24 * Math.PI) / 180);
      ctx.fillStyle = tone('#141414');
      ctx.beginPath();
      ctx.ellipse(3, 3.5, 29, 43, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = tone(th.cardBackMedallion);
      ctx.strokeStyle = tone(th.cardBackBorder);
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.ellipse(0, 0, 29, 43, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    } else {
      ctx.save();
      ctx.rotate((28 * Math.PI) / 180);
      ctx.fillStyle = tone(th.cardBackMedallionShadow);
      ctx.beginPath();
      ctx.ellipse(0, 2.5, 29, 44, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = tone(th.cardBackMedallion);
      ctx.strokeStyle = tone(th.cardBackBorder);
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.ellipse(0, 0, 29, 44, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    if (fx >= 0.35) {
      ctx.save();
      ctx.rotate(th.cardDesign === 'classic' || th.cardDesign === 'comic' ? (-24 * Math.PI) / 180 : 0);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = 'italic 800 16px "Outfit", sans-serif';
      ctx.fillStyle = tone(th.cardBackMedallionShadow);
      ctx.fillText('PUNO', 1.4, 2);
      ctx.fillStyle = tone(
        th.cardDesign === 'obsidian' || th.cardDesign === 'prism' ? '#ffffff' : '#ffd84d'
      );
      ctx.fillText('PUNO', 0, 0);
      ctx.restore();
    }
  }

  private drawParticles(ctx: CanvasRenderingContext2D): void {
    const bg = this.theme.feltMid;
    for (const p of this.particles) {
      const f = clamp01(p.life / p.max);
      if (p.kind === 'spark') {
        ctx.fillStyle = mixHex(bg, p.color, Math.min(1, f * 1.4));
        const r = Math.max(0.6, p.size * (0.4 + 0.6 * f));
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.kind === 'ring') {
        const e = easeOut(1 - f);
        const r = p.r0 + (p.r1 - p.r0) * e;
        ctx.strokeStyle = mixHex(bg, p.color, f);
        ctx.lineWidth = Math.max(1, p.w * f);
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        const h = p.h * (0.4 + 0.6 * Math.abs(Math.cos(p.rot * 1.3)));
        ctx.fillStyle = mixHex(bg, p.color, Math.min(1, f * 3));
        ctx.fillRect(-p.w / 2, -h / 2, p.w, h);
        ctx.restore();
      }
    }
  }

  private drawBanners(ctx: CanvasRenderingContext2D): void {
    const keep: Banner[] = [];
    for (const b of this.banners) {
      const age = this.t - b.t0;
      if (age < 0) {
        keep.push(b);
        continue;
      }
      if (age > b.dur) continue;
      keep.push(b);

      const p = age / b.dur;
      const sc = p < 0.22 ? easeOutBack(p / 0.22) : 1 + 0.05 * (p - 0.22);
      const fade = p < 0.7 ? 1 : 1 - (p - 0.7) / 0.3;
      const fontPx = Math.max(12, Math.round(58 * sc * b.size * (this.width < 680 ? 0.72 : 1)));
      const x = this.cx;
      const y = this.cy + b.dy - p * 34;

      ctx.save();
      ctx.globalAlpha = fade;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `italic 800 ${fontPx}px "Outfit", sans-serif`;
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillText(b.text, x + 3, y + 4);
      ctx.fillStyle = b.color;
      ctx.fillText(b.text, x, y);
      ctx.restore();
    }
    this.banners = keep;
  }
}
