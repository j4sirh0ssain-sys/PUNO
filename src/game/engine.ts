import {
  COLORS,
  DRAW_CARD_AMOUNTS,
  POWER_CARD_VALUES,
  type Card,
  type DifficultyLevel,
  type SuitColor,
} from './types.ts';

export function isDifficultyLevel(value: unknown): value is DifficultyLevel {
  return value === 'chill' || value === 'normal' || value === 'hard' || value === 'no_mercy';
}

export function getDrawAmount(card: Card | undefined): number {
  if (!card) return 0;
  return DRAW_CARD_AMOUNTS[card.value] ?? 0;
}

export function makeDeck(difficulty: DifficultyLevel = 'normal'): Card[] {
  const cards: Card[] = [];
  let uid = 0;
  for (const color of COLORS) {
    cards.push({ color, value: '0', uid: uid++ });
    const doubled = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'Skip', 'Reverse', '+2'];
    for (const value of doubled) {
      cards.push({ color, value, uid: uid++ });
      cards.push({ color, value, uid: uid++ });
    }
    if (difficulty === 'no_mercy') {
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
  if (difficulty === 'no_mercy') {
    for (let i = 0; i < 4; i++) {
      cards.push({ color: 'Wild', value: '+6', uid: uid++ });
      cards.push({ color: 'Wild', value: 'Roulette', uid: uid++ });
    }
    for (let i = 0; i < 2; i++) {
      cards.push({ color: 'Wild', value: '+10', uid: uid++ });
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

export interface RoundDeal {
  deck: Card[];
  hostHand: Card[];
  guestHand: Card[];
  discard: Card[];
  currentColor: SuitColor;
  jasirBoost: boolean;
}

export function dealRound(
  hostName: string,
  difficulty: DifficultyLevel = 'normal'
): RoundDeal {
  const deck = shuffle(makeDeck(difficulty));
  const hostHand: Card[] = [];
  const guestHand: Card[] = [];

  const jasirBoost = hostName.trim().toLowerCase() === 'j4s1r';
  if (jasirBoost) {
    for (let i = deck.length - 1; i >= 0 && hostHand.length < 7; i--) {
      if (POWER_CARD_VALUES.has(deck[i].value)) {
        const [powerCard] = deck.splice(i, 1);
        hostHand.push(powerCard);
      }
    }
  }

  for (let i = 0; i < 7; i++) {
    if (!jasirBoost) {
      const h = deck.pop();
      if (h) hostHand.push(h);
    }
    const g = deck.pop();
    if (g) guestHand.push(g);
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
    hostHand,
    guestHand,
    discard: [starter],
    currentColor,
    jasirBoost,
  };
}

export function drawOneFromDeck(
  deck: Card[],
  discard: Card[],
  targetHand: Card[]
): { card: Card | null; reshuffled: boolean } {
  let reshuffled = false;
  if (deck.length === 0) {
    if (discard.length <= 1) {
      return { card: null, reshuffled: false };
    }
    const top = discard.pop()!;
    const recycled = shuffle([...discard]);
    deck.push(...recycled);
    discard.length = 0;
    discard.push(top);
    reshuffled = true;
  }
  const card = deck.pop() ?? null;
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
  if (difficulty === 'chill') return Math.random() < 0.7;
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

  if (difficulty === 'chill') {
    const nonWild = valid.filter((c) => c.color !== 'Wild');
    const pool = nonWild.length > 0 ? nonWild : valid;
    return pool[Math.floor(Math.random() * pool.length)];
  }

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

  // Hard & No Mercy tactical scoring
  const colorCounts: Record<SuitColor, number> = { Red: 0, Blue: 0, Green: 0, Yellow: 0 };
  for (const c of cpuHand) {
    if (isSuitColor(c.color)) colorCounts[c.color]++;
  }
  const urgentOpponent = opponentCount <= 3;

  const scoreCard = (c: Card): number => {
    if (pendingDrawMin > 0) {
      // Save +10 unless needed; prefer lowest sufficient draw card
      return 100 - getDrawAmount(c);
    }

    let score = 0;
    if (c.value === 'Dump' && isSuitColor(c.color)) {
      score += colorCounts[c.color] * 7;
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
      // Play matching suit numbers from the largest suit first
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
  difficulty: DifficultyLevel = 'normal'
): SuitColor {
  if (difficulty === 'chill') {
    return COLORS[Math.floor(Math.random() * COLORS.length)];
  }
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
