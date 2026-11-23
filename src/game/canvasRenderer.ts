import { canPlayCard, getHandLimit } from './engine.ts';
import { TABLE_THEMES, type TableTheme, type TableThemeId } from './themes.ts';
import {
  BOMBOCLATT_CARD_VALUES,
  COLORS,
  getBomboclattCardArtUrl,
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
    }
  | {
      kind: 'feather';
      x: number;
      y: number;
      vx: number;
      vy: number;
      life: number;
      max: number;
      g: number;
      rot: number;
      vr: number;
      swayPh: number;
      swayAmp: number;
      size: number;
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

export interface CanvasLayoutMetrics {
  hudTop: number;
  compact: boolean;
}

interface TransientCard {
  sprite: CardSprite;
  originX: number;
  originY: number;
  life: number;
  burstColor?: string;
  arriveRing?: boolean;
}

interface MultiOppSlot {
  seat: ClientGameView['seats'][number];
  seatX: number;
  seatY: number;
  plateY: number;
  miniScale: number;
  nOpp: number;
}

export class PunoCanvasEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private onLayout?: (metrics: CanvasLayoutMetrics) => void;
  private width = 1000;
  private height = 700;
  private dpr = 1;
  private cx = 500;
  private cy = 350;
  private tableRect: [number, number, number, number] = [28, 10, 972, 578];
  private pileDx = 96;
  private handScale = 1;
  private pileScale = 1.1;
  private discardScale = 1.03;
  private discardLift = 0;
  private opponentScale = 0.56;

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
  private transientSprites: TransientCard[] = [];
  private prevSeatCounts = new Map<number, number>();
  private particles: Particle[] = [];
  private banners: Banner[] = [];
  private bokeh: BokehOrb[];
  private motes: DustMote[];

  private view: ClientGameView | null = null;
  private lastRoundId = -1;
  private lastTurnPhase: ClientGameView['turn'] | null = null;
  private hoverCardIndex: number | null = null;
  private hoverDeck = false;
  private deckHoverAnim = 0;
  private pointerX = -999;
  private pointerY = -999;
  private reducedMotion = false;
  private bomboclattImages = new Map<string, HTMLImageElement>();

  constructor(
    canvas: HTMLCanvasElement,
    initialTheme: TableThemeId = 'emerald',
    onLayout?: (metrics: CanvasLayoutMetrics) => void
  ) {
    this.canvas = canvas;
    this.onLayout = onLayout;
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

    if (typeof Image !== 'undefined') {
      for (const value of BOMBOCLATT_CARD_VALUES) {
        const url = getBomboclattCardArtUrl(value);
        if (url) {
          const img = new Image();
          img.decoding = 'async';
          img.src = url;
          this.bomboclattImages.set(value, img);
        }
      }
    }

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
    const padX = compact ? 10 : Math.min(28, this.width * 0.024);
    const topY = compact ? 8 : 10;
    const bottomReserve = compact ? 106 : 122;

    const scaleBase = compact
      ? Math.max(0.7, Math.min(0.86, this.width / 500))
      : Math.min(1.16, Math.max(0.84, this.width / 1080));
    this.handScale = scaleBase;
    this.pileScale = scaleBase * (compact ? 0.96 : 1.1);
    this.discardScale = this.pileScale * 0.94;
    this.discardLift = 0;
    this.opponentScale = scaleBase * (compact ? 0.48 : 0.56);
    this.pileDx = compact
      ? Math.max(58, Math.min(78, this.width * 0.175))
      : Math.min(126, Math.max(88, this.width * 0.095));

    this.cx = this.width / 2;
    this.tableRect = [
      padX,
      topY,
      this.width - padX,
      Math.max(topY + 240, this.height - bottomReserve),
    ];

    const multiOpp = (this.view?.playerCount ?? 2) > 2;
    const oppBottom = multiOpp
      ? topY + (compact ? 64 : 84)
      : topY + (compact ? 28 : 34) + 5 + (BASE_H / 2) * this.opponentScale;

    const pileHalfH = (BASE_H / 2) * this.pileScale;
    const topLabelClear = compact ? 24 : 30;
    const minCy = oppBottom + pileHalfH + topLabelClear;

    const handBaseY = this.height - (compact ? 58 : 70);
    const handTop = handBaseY - (BASE_H / 2) * this.handScale - (compact ? 24 : 30);
    const hudHeight = compact ? 74 : 82;
    const pileBottomPad = pileHalfH + (compact ? 40 : 46);
    const maxCy = Math.max(minCy, handTop - hudHeight - pileBottomPad);
    const idealCy = (this.tableRect[1] + this.tableRect[3]) * 0.46;
    this.cy = Math.min(maxCy, Math.max(minCy, idealCy));

    const hudTop = Math.round(this.cy + pileHalfH + (compact ? 38 : 44));
    this.onLayout?.({ hudTop, compact });
  }

  private deckPos(): [number, number] {
    return [this.cx - this.pileDx, this.cy];
  }

  private pilePos(): [number, number] {
    return [this.cx + this.pileDx, this.cy - this.discardLift];
  }

  private getMultiOppSlots(view: ClientGameView): MultiOppSlot[] {
    if (view.playerCount <= 2 || !view.seats || view.seats.length <= 2) return [];
    const total = view.seats.length;
    const oppSeats = [];
    for (let offset = 1; offset < total; offset++) {
      oppSeats.push(view.seats[(view.selfIndex + offset) % total]);
    }
    const nOpp = oppSeats.length;
    const compact = this.width < 680;
    const [l, t, r, b] = this.tableRect;
    const mx = (l + r) / 2;
    const spanX = Math.max(130, (r - l) / 2 - (compact ? 38 : 68));
    const dropY = Math.min(compact ? 56 : 86, Math.max(28, (b - t) * (compact ? 0.14 : 0.18)));
    const miniScale = compact
      ? nOpp >= 6
        ? 0.24
        : 0.3
      : nOpp >= 7
        ? 0.32
        : nOpp >= 4
          ? 0.37
          : 0.42;
    const minDeg = nOpp >= 6 ? -168 : -148;
    const maxDeg = nOpp >= 6 ? -12 : -32;

    return oppSeats.map((seat, k) => {
      const frac = nOpp > 1 ? k / (nOpp - 1) : 0.5;
      const deg = minDeg + frac * (maxDeg - minDeg);
      const rad = (deg * Math.PI) / 180;
      const seatX = mx + Math.cos(rad) * spanX;
      const stagger = compact && nOpp >= 6 && k % 2 === 1 ? 14 : 0;
      const seatY = t + (compact ? 30 : 38) + (1 - Math.abs(Math.sin(rad))) * dropY + stagger;
      const plateY = seatY + (BASE_H / 2) * miniScale + (compact ? 12 : 14);
      return { seat, seatX, seatY, plateY, miniScale, nOpp };
    });
  }

  private getSeatPos(seatIndex: number): [number, number] {
    const view = this.view;
    const compact = this.width < 680;
    if (!view || seatIndex === view.selfIndex) {
      return [this.cx, this.height - (compact ? 58 : 70)];
    }
    if (view.playerCount <= 2) {
      return [this.cx, this.tableRect[1] + (compact ? 28 : 34)];
    }
    const slot = this.getMultiOppSlots(view).find((s) => s.seat.index === seatIndex);
    if (slot) {
      return [slot.seatX, slot.seatY];
    }
    return [this.cx, this.tableRect[1] + (compact ? 30 : 38)];
  }

  private spawnTransientFlight(
    card: Card | null,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    startScale: number,
    targetScale: number,
    delay: number,
    arriveFace: boolean,
    burstColor?: string,
    arriveRing = false
  ): void {
    if (this.reducedMotion) return;
    const sp = new CardSprite(card, -(++this.seq), fromX, fromY, startScale, this.seq);
    sp.tx = toX;
    sp.ty = toY;
    sp.ts = targetScale;
    sp.ta = (Math.random() - 0.5) * 18;
    sp.va = (Math.random() - 0.5) * 220;
    sp.arriveFace = arriveFace;
    sp.facing = arriveFace ? 0.35 : 0;
    sp.delay = delay;
    sp.boost = delay + 0.95;
    sp.isPile = false;
    this.transientSprites.push({
      sprite: sp,
      originX: fromX,
      originY: fromY,
      life: delay + 0.65,
      burstColor,
      arriveRing,
    });
  }

  private spawnSeatDealWave(view: ClientGameView): void {
    if (this.reducedMotion || view.playerCount <= 2) return;
    const [dx, dy] = this.deckPos();
    const slots = this.getMultiOppSlots(view);
    const cardsPerSeat = Math.min(4, Math.max(2, Math.floor(14 / Math.max(2, slots.length)) + 1));
    slots.forEach((slot, k) => {
      if (slot.seat.eliminated || slot.seat.cardCount <= 0) return;
      for (let c = 0; c < cardsPerSeat; c++) {
        const delay = Math.min(0.85, c * 0.09 + k * 0.045);
        this.spawnTransientFlight(
          null,
          dx,
          dy,
          slot.seatX,
          slot.seatY,
          this.pileScale * 0.85,
          slot.miniScale,
          delay,
          false,
          c === cardsPerSeat - 1 ? this.theme.accent : undefined,
          false
        );
      }
    });
  }

  public syncView(view: ClientGameView, effects: EffectEvent[]): void {
    const roundChanged = view.roundId !== this.lastRoundId;
    const leftWaiting = this.lastTurnPhase === 'waiting' && view.turn !== 'waiting';
    const countChanged = (this.view?.playerCount ?? 2) !== view.playerCount;
    if (roundChanged) {
      this.sprites.clear();
      this.transientSprites = [];
      this.prevSeatCounts.clear();
      this.particles = [];
      this.banners = [];
      this.shake = 0;
      this.winMilestone = null;
      this.winBurstCooldown = 0;
      this.lastRoundId = view.roundId;
    }
    this.lastTurnPhase = view.turn;
    this.view = view;
    this.targetColor = view.currentColor;
    if (countChanged) {
      this.resize(this.width, this.height);
    }

    const [dx, dy] = this.deckPos();
    const [px, py] = this.pilePos();
    const keepIds = new Set<number>();
    const hasDealEffect = effects.some((e) => e.kind === 'deal');
    const isFreshDeal = roundChanged || leftWaiting || hasDealEffect;

    // Identify which seat played onto discard (from effects or seat card-count delta)
    let actorSeatIndex: number | undefined;
    for (const eff of effects) {
      if (eff.kind === 'impact' && typeof eff.seatIndex === 'number') {
        actorSeatIndex = eff.seatIndex;
        break;
      }
      if (eff.kind === 'dump' && typeof eff.seatIndex === 'number') {
        actorSeatIndex = eff.seatIndex;
        break;
      }
    }
    if (actorSeatIndex === undefined && !isFreshDeal && this.prevSeatCounts.size > 0) {
      for (const s of view.seats) {
        const prev = this.prevSeatCounts.get(s.index);
        if (prev !== undefined && s.cardCount < prev) {
          actorSeatIndex = s.index;
          break;
        }
      }
    }

    if ((leftWaiting || hasDealEffect) && !roundChanged) {
      // Re-cascade existing lobby sprites smoothly from the deck when match starts
      for (const sp of this.sprites.values()) {
        sp.x = dx;
        sp.y = dy;
        sp.vx = 0;
        sp.vy = 0;
        sp.s = this.pileScale;
      }
    }

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
        if (leftWaiting || hasDealEffect) {
          sp.delay = Math.min(idx * 0.055, 0.9);
          sp.boost = sp.delay + 1.1;
        }
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
        if (leftWaiting || hasDealEffect) {
          sp.delay = Math.min(idx * 0.06 + 0.03, 0.9);
          sp.boost = sp.delay + 1.1;
        }
      }
    });

    view.discardPile.forEach((card, idx) => {
      keepIds.add(card.uid);
      let sp = this.sprites.get(card.uid);
      if (!sp) {
        const fromOpponentSeat =
          !isFreshDeal &&
          actorSeatIndex !== undefined &&
          actorSeatIndex !== view.selfIndex;
        const [startX, startY] = fromOpponentSeat ? this.getSeatPos(actorSeatIndex!) : [dx, dy];
        const startScale = fromOpponentSeat
          ? view.playerCount > 2
            ? 0.44
            : this.opponentScale
          : this.discardScale;

        sp = new CardSprite(card, card.uid, startX, startY, startScale, ++this.seq);
        sp.jx = (Math.random() - 0.5) * 12;
        sp.jy = (Math.random() - 0.5) * 8;
        sp.ja = (Math.random() - 0.5) * 24;
        if (isFreshDeal && idx === 0) {
          sp.delay = 0.6;
          sp.boost = 1.6;
        } else {
          sp.facing = fromOpponentSeat ? 0.15 : 0.4;
          sp.boost = 1.1;
          sp.vs += 5.5;
          if (fromOpponentSeat) {
            sp.vy -= 120;
            sp.va += (Math.random() - 0.5) * 180;
          }
        }
        sp.hov = 0;
        sp.isPile = true;
        this.sprites.set(card.uid, sp);
      } else {
        sp.card = card;
        sp.hov = 0;
        if (!sp.isPile) {
          sp.seq = ++this.seq;
          sp.jx = (Math.random() - 0.5) * 12;
          sp.jy = (Math.random() - 0.5) * 8;
          sp.ja = (Math.random() - 0.5) * 24;
          sp.boost = 1.05;
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

    // Spawn 3-10P deal cascade or opponent draw flights
    if (isFreshDeal) {
      this.spawnSeatDealWave(view);
    } else if (view.playerCount > 2) {
      const explicitDrawn = new Set<number>();
      for (const eff of effects) {
        if (eff.kind === 'seat_draw' && eff.seatIndex !== view.selfIndex) {
          explicitDrawn.add(eff.seatIndex);
          const [sx, sy] = this.getSeatPos(eff.seatIndex);
          const slotScale =
            this.getMultiOppSlots(view).find((s) => s.seat.index === eff.seatIndex)?.miniScale ??
            0.35;
          const n = Math.min(Math.max(1, eff.count), 10);
          for (let i = 0; i < n; i++) {
            this.spawnTransientFlight(
              null,
              dx,
              dy,
              sx,
              sy,
              this.pileScale * 0.85,
              slotScale,
              i * 0.065,
              false,
              i === n - 1 ? this.theme.accent : undefined,
              i === n - 1
            );
          }
        }
      }

      // Fallback diff-based flights if a draw state lacked seat_draw
      if (this.prevSeatCounts.size > 0) {
        for (const s of view.seats) {
          if (s.index === view.selfIndex || explicitDrawn.has(s.index)) continue;
          const prev = this.prevSeatCounts.get(s.index);
          if (prev !== undefined && s.cardCount > prev) {
            const diff = Math.min(s.cardCount - prev, 10);
            const [sx, sy] = this.getSeatPos(s.index);
            const slotScale =
              this.getMultiOppSlots(view).find((sl) => sl.seat.index === s.index)?.miniScale ??
              0.35;
            for (let i = 0; i < diff; i++) {
              this.spawnTransientFlight(
                null,
                dx,
                dy,
                sx,
                sy,
                this.pileScale * 0.85,
                slotScale,
                i * 0.065,
                false,
                i === diff - 1 ? this.theme.accent : undefined,
                i === diff - 1
              );
            }
          }
        }
      }
    }

    // Also launch extra flying cards for opponent Dump in 3-10P
    for (const eff of effects) {
      if (
        eff.kind === 'dump' &&
        typeof eff.seatIndex === 'number' &&
        eff.seatIndex !== view.selfIndex &&
        eff.count > 1
      ) {
        const [sx, sy] = this.getSeatPos(eff.seatIndex);
        const colHex = this.theme.suitHex[eff.color];
        const extras = Math.min(eff.count - 1, 6);
        for (let i = 0; i < extras; i++) {
          this.spawnTransientFlight(
            null,
            sx,
            sy,
            px + (Math.random() - 0.5) * 10,
            py + (Math.random() - 0.5) * 8,
            0.42,
            this.discardScale,
            i * 0.05,
            false,
            colHex,
            false
          );
        }
      }
    }

    this.prevSeatCounts.clear();
    for (const s of view.seats) {
      this.prevSeatCounts.set(s.index, s.cardCount);
    }

    for (const eff of effects) {
      this.triggerEffect(eff);
    }
  }

  private triggerEffect(eff: EffectEvent): void {
    const [px, py] = this.pilePos();
    const [dx, dy] = this.deckPos();

    if (eff.kind === 'seat_draw') {
      return;
    }

    if (eff.kind === 'deal') {
      if (eff.isJasirBoost) {
        this.addBanner('7 POWER CARDS!', this.theme.accent, 0.65, 1.9, -75, 0.15);
        this.spawnBurst(this.cx, this.cy, this.theme.accent, 34, 320);
        this.spawnRing(this.cx, this.cy, this.theme.accent, 40, 260, 0.8, 5);
      } else if (eff.difficulty === 'bomboclatt') {
        this.addBanner('BOMBOCLATT!', '#d946ef', 0.72, 1.35, -20, 0.45);
        this.spawnRing(this.cx, this.cy, '#d946ef', 32, 240, 0.75, 4.5);
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
      const [ux, uy] =
        typeof eff.seatIndex === 'number' ? this.getSeatPos(eff.seatIndex) : [this.cx, this.cy - 90];
      this.spawnBurst(ux, uy, col, eff.isSelf ? 32 : 24, 300);
      this.spawnRing(ux, uy, col, 22, 175, 0.65, 4);
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
      const [ux, uy] =
        typeof eff.seatIndex === 'number' ? this.getSeatPos(eff.seatIndex) : [this.cx, this.cy - 40];
      this.spawnBurst(ux, uy, '#f43f5e', 34, 330);
      this.spawnRing(ux, uy, '#f43f5e', 24, 210, 0.75, 4.5);
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
      if (typeof eff.seatIndex === 'number') {
        const [rx, ry] = this.getSeatPos(eff.seatIndex);
        this.spawnBurst(rx, ry, col, 22, 260);
        this.spawnRing(rx, ry, col, 18, 130, 0.7, 3.5);
      }
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
      const limit = getHandLimit(this.view?.difficulty ?? 'no_mercy') ?? 25;
      const text = eff.isSelfLoser ? `MERCY KO · ${limit}+ CARDS` : `${eff.loserName.toUpperCase()} KO!`;
      this.addBanner(text, '#f43f5e', 0.85, 1.7, -75, 0);
      if (!this.reducedMotion) {
        this.shake = Math.max(this.shake, 16);
        this.tableFlash = 0.55;
        this.tableFlashColor = '#f43f5e';
      }
      this.spawnBurst(this.cx, this.cy, '#f43f5e', 48, 390);
      this.spawnRing(this.cx, this.cy, '#f43f5e', 30, 340, 0.9, 6);
      if (typeof eff.seatIndex === 'number') {
        const [kx, ky] = this.getSeatPos(eff.seatIndex);
        this.spawnBurst(kx, ky, '#f43f5e', 34, 310);
        this.spawnRing(kx, ky, '#f43f5e', 20, 160, 0.8, 4.5);
      }
      return;
    }

    if (eff.kind === 'crow_feathers') {
      this.spawnCrowFeathers(56);
      this.addBanner('KAAAW! RAFATH KAUWA', '#e2e8f0', 0.74, 1.6, -78, 0.05);
      if (!this.reducedMotion) {
        this.tableFlash = 0.26;
        this.tableFlashColor = '#334155';
      }
      this.spawnRing(px, py, '#94a3b8', 22, 230, 0.75, 4);
      if (typeof eff.targetIndex === 'number') {
        const [tx, ty] = this.getSeatPos(eff.targetIndex);
        this.spawnBurst(tx, ty, '#94a3b8', 20, 210);
        this.spawnRing(tx, ty, '#ef4444', 16, 125, 0.65, 3);
      }
      return;
    }

    if (eff.kind === 'rizz_line') {
      const col = eff.accepted === false ? '#94a3b8' : '#f472b6';
      const label =
        eff.accepted === true
          ? 'RIZZ! +1 CARD'
          : eff.accepted === false
            ? 'CURVED!'
            : 'RIZZLER ARVIN!';
      this.addBanner(label, col, 0.82, 1.4, -75, 0.05);
      if (!this.reducedMotion) {
        this.tableFlash = 0.24;
        this.tableFlashColor = col;
      }
      this.spawnBurst(px, py, col, 32, 300);
      this.spawnRing(px, py, col, 20, 220, 0.75, 4);
      if (
        eff.accepted === true &&
        typeof eff.targetIndex === 'number' &&
        typeof eff.seatIndex === 'number'
      ) {
        const [vx, vy] = this.getSeatPos(eff.targetIndex);
        const [tx, ty] = this.getSeatPos(eff.seatIndex);
        this.spawnTransientFlight(null, vx, vy, tx, ty, 0.44, 0.44, 0.05, false, '#f472b6', true);
      } else if (typeof eff.targetIndex === 'number') {
        const [tx, ty] = this.getSeatPos(eff.targetIndex);
        this.spawnBurst(tx, ty, col, 24, 240);
        this.spawnRing(tx, ty, col, 18, 130, 0.65, 3.5);
      }
      return;
    }

    if (eff.kind === 'surjo_ko') {
      const label = eff.isSelfLoser
        ? 'GOONER SURJO KO!'
        : `${eff.targetName.toUpperCase()} ELIMINATED!`;
      this.addBanner(label, '#38bdf8', 0.88, 1.8, -75, 0);
      if (!this.reducedMotion) {
        this.shake = Math.max(this.shake, 18);
        this.tableFlash = 0.56;
        this.tableFlashColor = '#38bdf8';
      }
      this.spawnBurst(this.cx, this.cy, '#38bdf8', 46, 380);
      this.spawnBurst(this.cx, this.cy, '#ffffff', 30, 320);
      this.spawnRing(this.cx, this.cy, '#ffffff', 28, 340, 0.9, 6);
      if (typeof eff.targetIndex === 'number') {
        const [kx, ky] = this.getSeatPos(eff.targetIndex);
        this.spawnBurst(kx, ky, '#38bdf8', 36, 320);
        this.spawnBurst(kx, ky, '#ffffff', 24, 260);
        this.spawnRing(kx, ky, '#ffffff', 20, 175, 0.85, 5);
      }
      return;
    }

    if (eff.kind === 'steal_power') {
      const label = eff.stolenCard
        ? `STOLEN: ${eff.stolenCard.value.toUpperCase()}!`
        : 'TOOTHPICK ALIF!';
      this.addBanner(label, '#fbbf24', 0.78, 1.5, -75, 0.05);
      if (!this.reducedMotion) {
        this.tableFlash = 0.28;
        this.tableFlashColor = '#fbbf24';
      }
      this.spawnBurst(px, py, '#fbbf24', 30, 300);
      this.spawnRing(px, py, '#fbbf24', 20, 220, 0.72, 4);
      if (typeof eff.victimIndex === 'number' && typeof eff.thiefIndex === 'number') {
        const [vx, vy] = this.getSeatPos(eff.victimIndex);
        const [tx, ty] = this.getSeatPos(eff.thiefIndex);
        this.spawnBurst(vx, vy, '#fbbf24', 22, 220);
        this.spawnTransientFlight(
          eff.stolenCard ?? null,
          vx,
          vy,
          tx,
          ty,
          0.46,
          0.5,
          0.05,
          Boolean(eff.stolenCard),
          '#fbbf24',
          true
        );
      }
      return;
    }

    if (eff.kind === 'win') {
      const m = eff.milestone ?? null;
      this.winMilestone = m;
      this.winBurstCooldown = 0.85;
      const accent = this.theme.accent;
      const suitCols = COLORS.map((c) => this.theme.suitHex[c]);
      const isWinnerSelf = !this.view || eff.winnerRole === this.view.selfRole;
      const winnerLabel = isWinnerSelf
        ? 'YOU WIN!'
        : `${(eff.winnerName || 'WINNER').toUpperCase()} WINS!`;

      this.addBanner(winnerLabel, accent, 1.35, 1.85, -34);

      if (typeof eff.winnerIndex === 'number') {
        const [wx, wy] = this.getSeatPos(eff.winnerIndex);
        this.spawnBurst(wx, wy, accent, 38, 340, 220);
        this.spawnRing(wx, wy, accent, 16, 175, 0.75, 4.5);
        this.spawnRing(wx, wy, '#ffffff', 10, 120, 0.55, 3);
      }

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
            if (this.view?.turn !== 'over') return;
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
            if (this.view?.turn !== 'over') return;
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
            if (this.view?.turn !== 'over') return;
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
        this.spawnConfetti(85);
        if (!this.reducedMotion) {
          this.shake = Math.max(this.shake, 5.5);
          this.tableFlash = 0.32;
          this.tableFlashColor = accent;
        }
        this.spawnRing(this.cx, this.cy, accent, 25, 280, 0.85, 5);
        this.spawnRing(this.cx, this.cy, '#ffffff', 14, 210, 0.7, 3.2);
        this.spawnBurst(this.cx, this.cy, accent, 38, 340, 230);
        for (let k = 0; k < 6; k++) {
          setTimeout(() => {
            if (this.view?.turn !== 'over') return;
            const bx = 120 + Math.random() * Math.max(120, this.width - 240);
            const by = 100 + Math.random() * Math.max(120, this.height * 0.45);
            const col = suitCols[Math.floor(Math.random() * 4)];
            this.spawnBurst(bx, by, col, 38, 360);
            this.spawnRing(bx, by, '#ffffff', 10, 105, 0.52, 2.8);
          }, k * 120);
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

  private spawnCrowFeathers(n = 56): void {
    const count = this.reducedMotion ? 10 : n;
    const featherColors = ['#090d16', '#111827', '#1e293b', '#334155'];
    for (let i = 0; i < count; i++) {
      const life = 2.8 + Math.random() * 2.0;
      this.addParticle({
        kind: 'feather',
        x: Math.random() * this.width,
        y: -25 - Math.random() * 140,
        vx: (Math.random() - 0.5) * 85,
        vy: 72 + Math.random() * 82,
        life,
        max: life,
        g: 9,
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 4.5,
        swayPh: Math.random() * Math.PI * 2,
        swayAmp: 36 + Math.random() * 48,
        size: 13 + Math.random() * 11,
        color: featherColors[Math.floor(Math.random() * featherColors.length)],
      });
    }
  }

  private layoutSprites(): void {
    if (!this.view) return;
    const isMyTurn = this.view.turn === this.view.selfRole;
    const topCard = this.view.discardPile[this.view.discardPile.length - 1];

    const nSelf = this.view.selfHand.length;
    const compact = this.width < 680;
    const baseY = this.height - (compact ? 58 : 70);
    const maxSpan = Math.max(220, this.width - (compact ? 100 : 420));
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
      sp.ty = baseY + u * u * (compact ? 10 : 16) - (playable ? 16 : 0) + breath;
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
      sp.ts = this.discardScale;
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

    // Step transient seat-to-seat flying card animations (3-10P draws, deals, dumps)
    if (this.transientSprites.length > 0) {
      const keepTrans: TransientCard[] = [];
      for (const tc of this.transientSprites) {
        const sp = tc.sprite;
        tc.life -= dt;
        if (sp.delay > 0) {
          sp.x = tc.originX;
          sp.y = tc.originY;
        }
        for (let k = 0; k < steps; k++) {
          sp.update(stepDt);
        }
        if (sp.delay <= 0 && Math.random() < 0.6) {
          this.addParticle({
            kind: 'spark',
            x: sp.x + (Math.random() - 0.5) * 10,
            y: sp.y + (Math.random() - 0.5) * 10,
            vx: (Math.random() - 0.5) * 40,
            vy: (Math.random() - 0.5) * 40,
            life: 0.28,
            max: 0.28,
            size: 1.8 + Math.random() * 2.0,
            color: tc.burstColor ?? '#ffffff',
            g: 0,
          });
        }
        const dist = Math.hypot(sp.tx - sp.x, sp.ty - sp.y);
        if (tc.life <= 0 || (sp.delay <= 0 && dist < 12)) {
          if (tc.burstColor) {
            this.spawnBurst(sp.tx, sp.ty, tc.burstColor, 10, 150, 180);
          }
          if (tc.arriveRing) {
            this.spawnRing(sp.tx, sp.ty, tc.burstColor ?? this.theme.accent, 8, 52, 0.45, 2.5);
          }
        } else {
          keepTrans.push(tc);
        }
      }
      this.transientSprites = keepTrans;
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
        } else if (p.kind === 'feather') {
          p.x += Math.sin(this.t * 3.4 + p.swayPh) * p.swayAmp * dt;
          p.rot += p.vr * dt + Math.cos(this.t * 3.4 + p.swayPh) * 0.7 * dt;
        }
        if (p.y > this.height + 40) continue;
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

    if (this.view?.turn === 'over' && this.view.winner) {
      const confChance = this.winMilestone === 10 ? 0.85 : this.winMilestone === 5 ? 0.7 : 0.55;
      if (Math.random() < confChance) {
        this.spawnConfetti(this.winMilestone === 10 ? 2 : 1);
      }
      if (!this.reducedMotion) {
        this.winBurstCooldown -= dt;
        if (this.winBurstCooldown <= 0) {
          this.winBurstCooldown = this.winMilestone === 10 ? 0.55 : this.winMilestone === 5 ? 0.8 : 1.15;
          const bx = 100 + Math.random() * Math.max(120, this.width - 200);
          const by = 80 + Math.random() * Math.max(100, this.height * 0.5);
          const col =
            Math.random() < 0.45
              ? this.theme.accent
              : this.theme.suitHex[COLORS[Math.floor(Math.random() * 4)]];
          this.spawnBurst(bx, by, col, this.winMilestone ? 30 : 24, 290, 260);
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

    if (this.view?.turn === 'over' && this.view.winner && !this.reducedMotion) {
      const rayCount = this.winMilestone === 10 ? 14 : this.winMilestone === 5 ? 10 : 8;
      const rayAlpha = this.winMilestone === 10 ? 0.13 : this.winMilestone ? 0.09 : 0.065;
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
    this.drawColorIndicator(ctx);
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
    const arcR = (BASE_H / 2) * this.discardScale + 14;
    const dir = this.view?.direction ?? 1;
    ctx.lineWidth = 2.6;
    ctx.strokeStyle = g;
    for (let i = 0; i < 3; i++) {
      const startDeg = (this.t * 78 * dir + i * 120 + 3600) % 360;
      const start = (startDeg * Math.PI) / 180;
      const extent = (56 * Math.PI) / 180;
      ctx.beginPath();
      ctx.arc(px, py, arcR, start, start + extent);
      ctx.stroke();

      const tipAngle = dir === 1 ? start + extent : start;
      const sx = px + Math.cos(tipAngle) * arcR;
      const sy = py + Math.sin(tipAngle) * arcR;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(sx, sy, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.lineWidth = 1.6;
    ctx.strokeStyle = mixHex(th.feltMid, g, 0.52);
    const outerStart = ((-this.t * 45 * dir) * Math.PI) / 180;
    ctx.beginPath();
    ctx.arc(px, py, arcR + 8, outerStart, outerStart + (32 * Math.PI) / 180);
    ctx.stroke();
  }

  private drawMultiOpponents(ctx: CanvasRenderingContext2D): void {
    const view = this.view;
    if (!view || view.playerCount <= 2 || !view.seats || view.seats.length <= 2) return;

    const slots = this.getMultiOppSlots(view);
    const compact = this.width < 680;
    const [dx] = this.deckPos();
    const [px] = this.pilePos();

    slots.forEach(({ seat, seatX, seatY, plateY, miniScale, nOpp }, k) => {
      const isTurn = view.turnIndex === seat.index && view.turn !== 'over';
      const bob = isTurn && !this.reducedMotion ? Math.sin(this.t * 4.2 + k) * 2.5 : 0;

      if (isTurn && !seat.eliminated && !this.reducedMotion) {
        const pulse = 0.5 + 0.5 * Math.sin(this.t * 5.2);
        ctx.save();
        ctx.strokeStyle = this.theme.accent;
        ctx.globalAlpha = 0.3 + pulse * 0.4;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(seatX, seatY + bob, (BASE_H / 2) * miniScale + 10 + pulse * 4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      if (!seat.eliminated) {
        const shownCards = Math.min(seat.cardCount, nOpp >= 7 ? 3 : 4);
        const step = (compact ? 7 : 10) * (miniScale / 0.36);
        for (let c = 0; c < shownCards; c++) {
          const off = c - (shownCards - 1) / 2;
          const cx = seatX + off * step;
          const cy = seatY + Math.abs(off) * 1.4 + bob;
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
            isTurn && c === shownCards - 1 ? 0.85 : 0,
            this.theme.accent,
            0,
            false
          );
        }
      }

      // Seat nameplate below mini hand
      const plateW = compact ? (nOpp >= 6 ? 68 : 84) : nOpp >= 7 ? 94 : 112;
      const plateH = compact ? 20 : 22;

      ctx.save();
      ctx.fillStyle = isTurn
        ? mixHex(this.theme.surface, this.theme.accent, 0.24)
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

    // Direction indicator cleanly centered between DRAW PILE and DISCARD top labels
    const midX = (dx + px) / 2;
    const dirY = this.cy - (BASE_H / 2) * this.pileScale - (compact ? 14 : 18);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${compact ? 10 : 11}px "Plus Jakarta Sans", sans-serif`;
    ctx.fillStyle = 'rgba(225, 236, 234, 0.72)';
    ctx.fillText(view.direction === 1 ? '↻ CW' : '↺ CCW', midX, dirY);
    ctx.restore();
  }

  private drawPiles(ctx: CanvasRenderingContext2D): void {
    const [dx, dy] = this.deckPos();
    const [px, py] = this.pilePos();
    const s = this.pileScale;
    const ds = this.discardScale;
    const compact = this.width < 680;
    const topLabelY = this.cy - (BASE_H / 2) * s - (compact ? 14 : 18);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(235, 240, 238, 0.68)';
    ctx.font = `700 ${compact ? 10 : 11}px "Plus Jakarta Sans", sans-serif`;
    ctx.fillText('DRAW PILE', dx, topLabelY);
    ctx.fillText('DISCARD', px, topLabelY);

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
      const rippleR = (52 + ripplePhase * 34) * (s / 1.1);
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

    // Subtle slot ring beneath discard pile when empty or during initial flight
    if (!view || view.discardPile.length === 0) {
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.lineWidth = 1.8;
      this.roundRectPath(ctx, px - 40 * ds, py - 57 * ds, 80 * ds, 114 * ds, 10 * ds);
      ctx.stroke();
    }

    // Symmetrical deck count pill matching the Current Color pill baseline
    const badgeY = this.cy + (BASE_H / 2) * s + (compact ? 20 : 24);
    const countW = compact ? 88 : 98;
    const countH = compact ? 24 : 28;
    ctx.save();
    ctx.fillStyle = 'rgba(8, 15, 20, 0.78)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.lineWidth = 1.2;
    this.roundRectPath(ctx, dx - countW / 2, badgeY - countH / 2, countW, countH, countH / 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(235, 240, 238, 0.86)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${compact ? 10.5 : 11.5}px "JetBrains Mono", monospace`;
    ctx.fillText(`${deckCount} cards`, dx, badgeY + 0.5);
    ctx.restore();
  }

  private drawColorIndicator(ctx: CanvasRenderingContext2D): void {
    const [px] = this.pilePos();
    const s = this.pileScale;
    const compact = this.width < 680;
    const view = this.view;

    const activeCol = view?.currentColor ?? 'Red';
    const colHex = this.theme.suitHex[activeCol];
    const cyInd = this.cy + (BASE_H / 2) * s + (compact ? 20 : 24);
    const pillW = compact ? 104 : 118;
    const pillH = compact ? 24 : 28;

    ctx.save();
    ctx.fillStyle = 'rgba(8, 15, 20, 0.9)';
    ctx.strokeStyle = mixHex('#304b56', colHex, 0.82);
    ctx.lineWidth = 1.6;
    this.roundRectPath(ctx, px - pillW / 2, cyInd - pillH / 2, pillW, pillH, pillH / 2);
    ctx.fill();
    ctx.stroke();

    const r = (compact ? 5.2 : 6.2) + (this.reducedMotion ? 0 : Math.sin(this.t * 4.4) * 0.9);
    ctx.fillStyle = colHex;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(px - pillW / 2 + (compact ? 18 : 21), cyInd, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = PALETTE.ink;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${compact ? 10.5 : 11.5}px "Plus Jakarta Sans", sans-serif`;
    ctx.fillText(activeCol.toUpperCase(), px - pillW / 2 + (compact ? 30 : 35), cyInd + 0.5);
    ctx.restore();
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

    // Draw transient seat-to-seat flying cards cleanly in flight
    for (const tc of this.transientSprites) {
      const sp = tc.sprite;
      if (sp.delay > 0) continue;
      this.drawCard(
        ctx,
        sp.card,
        sp.x,
        sp.y,
        sp.a,
        sp.s,
        sp.facing,
        0,
        0.55,
        this.theme.accent,
        4,
        false
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

    const isBomboclattCard = (BOMBOCLATT_CARD_VALUES as readonly string[]).includes(card.value);
    const base = th.suitHex[card.color];

    if (isBomboclattCard) {
      this.drawBomboclattCardInterior(ctx, card, dim);
    } else if (design === 'obsidian') {
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
    if (isBomboclattCard) {
      corner =
        card.value === 'Rizzler Arvin'
          ? 'RIZZ'
          : card.value === 'Rafath Kauwa'
            ? 'KAUWA'
            : card.value === 'Gooner Surjo'
              ? 'SURJO'
              : 'ALIF';
    } else if (card.color === 'Wild') {
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

    if (fx >= 0.35 && !isBomboclattCard) {
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

  private drawBomboclattCardInterior(
    ctx: CanvasRenderingContext2D,
    card: Card,
    dim = 0
  ): void {
    const img = this.bomboclattImages.get(card.value);
    ctx.save();
    this.roundRectPath(ctx, -40, -57, 80, 114, 9);
    ctx.clip();

    if (img && img.complete && img.naturalWidth > 0) {
      const crop =
        card.value === 'Gooner Surjo'
          ? { mx: 0.078, my: 0.048 }
          : card.value === 'Rafath Kauwa'
            ? { mx: 0.025, my: 0.02 }
            : { mx: 0.012, my: 0.012 };
      const sx = img.naturalWidth * crop.mx;
      const sy = img.naturalHeight * crop.my;
      const sw = img.naturalWidth * (1 - crop.mx * 2);
      const sh = img.naturalHeight * (1 - crop.my * 2);
      ctx.drawImage(img, sx, sy, sw, sh, -40, -57, 80, 114);
    } else {
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(-40, -57, 80, 114);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#f8fafc';
      ctx.font = '800 8px "Outfit", sans-serif';
      ctx.fillText(card.value.toUpperCase(), 0, 0);
    }

    if (dim > 0.01) {
      ctx.fillStyle = `rgba(8, 12, 18, ${(dim * 0.72).toFixed(3)})`;
      ctx.fillRect(-40, -57, 80, 114);
    }

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.lineWidth = 1.2;
    this.roundRectPath(ctx, -39.4, -56.4, 78.8, 112.8, 8.6);
    ctx.stroke();
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
      } else if (p.kind === 'feather') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.globalAlpha = Math.min(1, f * 2.5);
        const len = p.size;
        const wid = p.size * 0.36;
        ctx.fillStyle = p.color;
        ctx.strokeStyle = 'rgba(226, 232, 240, 0.55)';
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.moveTo(0, -len);
        ctx.quadraticCurveTo(wid, -len * 0.25, wid * 0.7, len * 0.15);
        ctx.lineTo(wid * 0.28, len * 0.22);
        ctx.lineTo(wid * 0.55, len * 0.58);
        ctx.lineTo(0, len);
        ctx.lineTo(-wid * 0.55, len * 0.58);
        ctx.lineTo(-wid * 0.24, len * 0.18);
        ctx.lineTo(-wid * 0.72, len * 0.1);
        ctx.quadraticCurveTo(-wid, -len * 0.25, 0, -len);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = 'rgba(241, 245, 249, 0.7)';
        ctx.lineWidth = 1.05;
        ctx.beginPath();
        ctx.moveTo(0, -len * 0.85);
        ctx.lineTo(0, len * 1.18);
        ctx.stroke();
        ctx.restore();
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
