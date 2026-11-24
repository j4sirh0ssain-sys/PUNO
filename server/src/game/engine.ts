import {
  BOMBOCLATT_CARD_VALUES,
  BOMBOCLATT_HAND_LIMIT,
  COLORS,
  DRAW_CARD_AMOUNTS,
  MAX_PLAYERS,
  MERCY_HAND_LIMIT,
  MIN_PLAYERS,
  POWER_CARD_VALUES,
  type Card,
  type DifficultyLevel,
  type SuitColor,
} from './types.ts';

export function isDifficultyLevel(value: unknown): value is DifficultyLevel {
  return (
    value === 'normal' ||
    value === 'hard' ||
    value === 'no_mercy' ||
    value === 'bomboclatt'
  );
}

export function isNoMercyRuleset(difficulty: DifficultyLevel): boolean {
  return difficulty === 'no_mercy' || difficulty === 'bomboclatt';
}

export function getHandLimit(difficulty: DifficultyLevel): number | null {
  if (difficulty === 'no_mercy') return MERCY_HAND_LIMIT;
  if (difficulty === 'bomboclatt') return BOMBOCLATT_HAND_LIMIT;
  return null;
}

export function clampPlayerCount(value: unknown): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return MIN_PLAYERS;
  return Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, Math.round(num)));
}

export function getDrawAmount(card: Card | undefined): number {
  if (!card) return 0;
  return DRAW_CARD_AMOUNTS[card.value] ?? 0;
}

export function makeDeck(
  difficulty: DifficultyLevel = 'normal',
  playerCount: number = MIN_PLAYERS
): Card[] {
  const deckCopies = playerCount >= 7 ? 2 : 1;
  const noMercyPool = isNoMercyRuleset(difficulty);
  const cards: Card[] = [];
  let uid = 0;

  for (let copy = 0; copy < deckCopies; copy++) {
    for (const color of COLORS) {
      cards.push({ color, value: '0', uid: uid++ });
      const doubled = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'Skip', 'Reverse', '+2'];
      for (const value of doubled) {
        cards.push({ color, value, uid: uid++ });
        cards.push({ color, value, uid: uid++ });
      }
      if (noMercyPool) {
        cards.push({ color, value: 'Skip All', uid: uid++ });
        cards.push({ color, value: 'Skip All', uid: uid++ });
        cards.push({ color, value: 'Dump', uid: uid++ });
        cards.push({ color, value: 'Dump', uid: uid++ });
        cards.push({ color, value: '+4', uid: uid++ });
      }
    }
    for (const value of ['Wild', '+4']) {
      for (let i = 0; i < 4; i++) {
        cards.push({ color: 'Wild', value, uid: uid++ });
      }
    }
    if (noMercyPool) {
      for (let i = 0; i < 4; i++) {
        cards.push({ color: 'Wild', value: '+6', uid: uid++ });
        cards.push({ color: 'Wild', value: 'Roulette', uid: uid++ });
      }
      for (let i = 0; i < 2; i++) {
        cards.push({ color: 'Wild', value: '+10', uid: uid++ });
      }
    }
    if (difficulty === 'bomboclatt') {
      for (let i = 0; i < 2; i++) {
        cards.push({ color: 'Wild', value: 'Rizzler Arvin', uid: uid++ });
        cards.push({ color: 'Wild', value: 'Rafath Kauwa', uid: uid++ });
        cards.push({ color: 'Wild', value: 'Toothpick Alif', uid: uid++ });
      }
      if (copy === 0) {
        cards.push({ color: 'Wild', value: 'Gooner Surjo', uid: uid++ });
      }
    }
  }
  return cards;
}

export function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

export function canPlayCard(
  card: Card,
  topCard: Card | undefined,
  currentColor: SuitColor,
  pendingDrawMin = 0
): boolean {
  if (pendingDrawMin > 0) {
    return getDrawAmount(card) >= pendingDrawMin;
  }
  if (!topCard) return true;
  return (
    card.color === 'Wild' ||
    card.color === currentColor ||
    card.value === topCard.value
  );
}

export function isSuitColor(value: unknown): value is SuitColor {
  return typeof value === 'string' && (COLORS as readonly string[]).includes(value);
}

export interface MultiRoundDeal {
  deck: Card[];
  hands: Card[][];
  discard: Card[];
  currentColor: SuitColor;
  jasirSeatIndexes: number[];
  customGrantSeatIndexes: number[];
}

export const GOONER_SURJO_SPAWN_CHANCE = 0.03;

export function dealRoundMulti(
  seatNames: string[],
  difficulty: DifficultyLevel = 'normal'
): MultiRoundDeal {
  const count = clampPlayerCount(seatNames.length);
  const deck = shuffle(makeDeck(difficulty, count));
  const hasCustomGrantSeat =
    difficulty === 'bomboclatt' &&
    seatNames.slice(0, count).some((name) => name.trim().toLowerCase() === 'j4s1rlol');
  const includeSurjo =
    difficulty === 'bomboclatt' &&
    (hasCustomGrantSeat || Math.random() < GOONER_SURJO_SPAWN_CHANCE);
  if (!includeSurjo) {
    for (let i = deck.length - 1; i >= 0; i--) {
      if (deck[i].value === 'Gooner Surjo') {
        deck.splice(i, 1);
      }
    }
  }
  const hands: Card[][] = Array.from({ length: count }, () => []);
  const jasirSeatIndexes: number[] = [];
  const customGrantSeatIndexes: number[] = [];

  seatNames.slice(0, count).forEach((name, idx) => {
    const normalized = name.trim().toLowerCase();
    if (normalized === 'j4s1r') {
      jasirSeatIndexes.push(idx);
      for (let i = deck.length - 1; i >= 0 && hands[idx].length < 7; i--) {
        if (POWER_CARD_VALUES.has(deck[i].value) && deck[i].value !== 'Gooner Surjo') {
          const [powerCard] = deck.splice(i, 1);
          hands[idx].push(powerCard);
        }
      }
    } else if (normalized === 'j4s1rlol' && difficulty === 'bomboclatt') {
      customGrantSeatIndexes.push(idx);
      for (const customValue of BOMBOCLATT_CARD_VALUES) {
        if (hands[idx].length >= 7) break;
        const foundIdx = deck.findIndex((c) => c.value === customValue);
        if (foundIdx !== -1) {
          const [customCard] = deck.splice(foundIdx, 1);
          hands[idx].push(customCard);
        }
      }
    }
  });

  for (let round = 0; round < 7; round++) {
    for (let seat = 0; seat < count; seat++) {
      if (hands[seat].length < 7) {
        const c = deck.pop();
        if (c) hands[seat].push(c);
      }
    }
  }

  let starterIdx = deck.length - 1;
  for (let i = deck.length - 1; i >= 0; i--) {
    if (!POWER_CARD_VALUES.has(deck[i].value)) {
      starterIdx = i;
      break;
    }
  }
  const [starter] = deck.splice(starterIdx, 1);
  const currentColor: SuitColor = isSuitColor(starter.color) ? starter.color : 'Red';

  return {
    deck,
    hands,
    discard: [starter],
    currentColor,
    jasirSeatIndexes,
    customGrantSeatIndexes,
  };
}

export function getNextAliveSeatIndex(
  eliminatedFlags: boolean[],
  fromIndex: number,
  direction: 1 | -1,
  steps = 1
): number {
  const total = eliminatedFlags.length;
  if (total === 0) return 0;
  let idx = fromIndex;
  let moved = 0;
  let guard = 0;
  while (moved < steps && guard < total * (steps + 2)) {
    idx = (idx + direction + total) % total;
    if (!eliminatedFlags[idx]) {
      moved++;
    }
    guard++;
  }
  return idx;
}

export interface DrawDeckOptions {
  surjoUsed?: boolean;
  surjoDrawChance?: number;
}

export function drawOneFromDeck(
  deck: Card[],
  discard: Card[],
  targetHand: Card[],
  options?: DrawDeckOptions
): { card: Card | null; reshuffled: boolean } {
  const surjoUsed = Boolean(options?.surjoUsed);
  const surjoDrawChance = options?.surjoDrawChance ?? 0;

  let reshuffled = false;
  if (deck.length === 0) {
    if (discard.length <= 1) {
      return { card: null, reshuffled: false };
    }
    const top = discard.pop()!;
    const recycled = shuffle(
      discard.filter((c) => !(surjoUsed && c.value === 'Gooner Surjo'))
    );
    deck.push(...recycled);
    discard.length = 0;
    discard.push(top);
    reshuffled = true;
  }

  if (surjoUsed) {
    for (let i = deck.length - 1; i >= 0; i--) {
      if (deck[i].value === 'Gooner Surjo') {
        deck.splice(i, 1);
      }
    }
    if (deck.length === 0) {
      return { card: null, reshuffled };
    }
  }

  let card: Card | null = null;
  if (!surjoUsed && surjoDrawChance > 0) {
    const surjoIdx = deck.findIndex((c) => c.value === 'Gooner Surjo');
    if (surjoIdx !== -1) {
      if (Math.random() < surjoDrawChance) {
        card = deck.splice(surjoIdx, 1)[0] ?? null;
      } else if (deck.length > 1 && deck[deck.length - 1]?.value === 'Gooner Surjo') {
        card = deck.splice(deck.length - 2, 1)[0] ?? null;
      }
    }
  }

  if (!card) {
    card = deck.pop() ?? null;
  }

  if (card) {
    targetHand.push(card);
  }
  return { card, reshuffled };
}

export function drawColorRoulette(
  deck: Card[],
  discard: Card[],
  targetHand: Card[],
  targetColor: SuitColor,
  maxDraw = 12
): { drawnCount: number; reshuffled: boolean } {
  let drawnCount = 0;
  let reshuffled = false;
  while (drawnCount < maxDraw) {
    const res = drawOneFromDeck(deck, discard, targetHand);
    if (res.reshuffled) reshuffled = true;
    if (!res.card) break;
    drawnCount++;
    if (res.card.color === targetColor) {
      break;
    }
  }
  return { drawnCount, reshuffled };
}

export function shouldCpuCallUno(difficulty: DifficultyLevel): boolean {
  if (difficulty === 'normal') return Math.random() < 0.88;
  return true;
}

export function chooseCpuCard(
  cpuHand: Card[],
  topCard: Card | undefined,
  currentColor: SuitColor,
  difficulty: DifficultyLevel = 'normal',
  pendingDrawMin = 0,
  opponentCount = 7
): Card | null {
  const valid = cpuHand.filter((c) => canPlayCard(c, topCard, currentColor, pendingDrawMin));
  if (valid.length === 0) return null;

  if (difficulty === 'normal') {
    const priority: Record<string, number> = {
      Wild: 0,
      '+4': 1,
      Skip: 2,
      Reverse: 2,
      '+2': 2,
    };

    let best = valid[0];
    let bestScore = (priority[best.value] ?? 3) + Math.random();
    for (let i = 1; i < valid.length; i++) {
      const c = valid[i];
      const score = (priority[c.value] ?? 3) + Math.random();
      if (score > bestScore) {
        best = c;
        bestScore = score;
      }
    }
    return best;
  }

  const colorCounts: Record<SuitColor, number> = { Red: 0, Blue: 0, Green: 0, Yellow: 0 };
  for (const c of cpuHand) {
    if (isSuitColor(c.color)) colorCounts[c.color]++;
  }
  const urgentOpponent = opponentCount <= 3;

  const scoreCard = (c: Card): number => {
    if (pendingDrawMin > 0) {
      return 100 - getDrawAmount(c);
    }

    let score = 0;
    if (c.value === 'Dump' && isSuitColor(c.color)) {
      score += colorCounts[c.color] * 7;
    } else if (c.value === 'Gooner Surjo') {
      score += 34;
    } else if (c.value === 'Toothpick Alif') {
      score += 27;
    } else if (c.value === 'Rizzler Arvin') {
      score += 24;
    } else if (c.value === 'Rafath Kauwa') {
      score += 20;
    } else if (c.value === '+10') {
      score += urgentOpponent ? 32 : 20;
    } else if (c.value === '+6') {
      score += urgentOpponent ? 28 : 17;
    } else if (c.value === 'Roulette') {
      score += urgentOpponent ? 26 : 16;
    } else if (c.value === '+4') {
      score += urgentOpponent ? 24 : c.color === 'Wild' ? 6 : 15;
    } else if (c.value === '+2') {
      score += urgentOpponent ? 21 : 12;
    } else if (c.value === 'Skip All' || c.value === 'Skip' || c.value === 'Reverse') {
      score += urgentOpponent ? 19 : 11;
    } else if (c.value === 'Wild') {
      score += cpuHand.length <= 2 ? 18 : 2;
    } else {
      const suitWeight = isSuitColor(c.color) ? colorCounts[c.color] * 2.2 : 0;
      score += 13 + suitWeight;
    }
    return score + Math.random() * 0.6;
  };

  let best = valid[0];
  let bestScore = scoreCard(best);
  for (let i = 1; i < valid.length; i++) {
    const s = scoreCard(valid[i]);
    if (s > bestScore) {
      best = valid[i];
      bestScore = s;
    }
  }
  return best;
}

export function chooseCpuWildColor(
  cpuHand: Card[],
  _difficulty: DifficultyLevel = 'normal'
): SuitColor {
  const counts: Record<SuitColor, number> = { Red: 0, Blue: 0, Green: 0, Yellow: 0 };
  for (const c of cpuHand) {
    if (isSuitColor(c.color)) {
      counts[c.color]++;
    }
  }
  const maxCount = Math.max(...Object.values(counts));
  const bestColors = COLORS.filter((col) => counts[col] === maxCount);
  return bestColors[Math.floor(Math.random() * bestColors.length)];
}
