export const COLORS = ['Red', 'Blue', 'Green', 'Yellow'] as const;
export type SuitColor = (typeof COLORS)[number];
export type CardColor = SuitColor | 'Wild';

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 10;

export type DifficultyLevel = 'normal' | 'hard' | 'no_mercy' | 'bomboclatt';

export interface DifficultyInfo {
  id: DifficultyLevel;
  label: string;
  tier: string;
  summary: string;
  accent: string;
  level: 1 | 2 | 3 | 4;
}

export const DIFFICULTY_LIST: DifficultyInfo[] = [
  {
    id: 'normal',
    label: 'Standard',
    tier: 'Tier 1',
    summary: 'Balanced CPU · Classic UNO rules',
    accent: '#38bdf8',
    level: 1,
  },
  {
    id: 'hard',
    label: 'Ruthless',
    tier: 'Tier 2',
    summary: 'Tactical CPU · Action chaining & sharp color traps',
    accent: '#fb923c',
    level: 2,
  },
  {
    id: 'no_mercy',
    label: 'No Mercy',
    tier: 'Deadly',
    summary: '+6, +10, Color Roulette, Skip All, Dump & 25-card Mercy KO',
    accent: '#f43f5e',
    level: 3,
  },
  {
    id: 'bomboclatt',
    label: 'Bomboclatt',
    tier: 'Chaotic',
    summary: 'All No Mercy cards + Rizzler Arvin, Rafath Kauwa, Gooner Surjo & Toothpick Alif · 50-card KO limit',
    accent: '#d946ef',
    level: 4,
  },
];

export const BOMBOCLATT_CARD_VALUES = [
  'Rizzler Arvin',
  'Rafath Kauwa',
  'Gooner Surjo',
  'Toothpick Alif',
] as const;

export type BomboclattCardValue = (typeof BOMBOCLATT_CARD_VALUES)[number];

export const BOMBOCLATT_CARD_ART: Record<BomboclattCardValue, string> = {
  'Rizzler Arvin': 'assets/aistudio/Rizzler_Arvin_a59e81ef.jpeg',
  'Rafath Kauwa': 'assets/aistudio/Kauwa_Rafath_d6d8d77e.jpeg',
  'Gooner Surjo': 'assets/aistudio/Gooner_Surjo_7bf92deb.jpeg',
  'Toothpick Alif': 'assets/aistudio/Toothpick_Alif_f4a60960.jpeg',
};

export function getBomboclattCardArtUrl(value: string): string | null {
  const rel = BOMBOCLATT_CARD_ART[value as BomboclattCardValue];
  if (!rel) return null;
  const base = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  return `${normalizedBase}${rel}`;
}

export const RIZZ_PICKUP_LINES = [
  'Did you get hurt bcuz you just fell from heaven',
  'Are you from tennessee bcuz youre the only 10 I see',
  'Are a keyboard bcuz youre my type',
] as const;

export const POWER_CARD_VALUES = new Set([
  'Skip',
  'Reverse',
  '+2',
  'Wild',
  '+4',
  'Skip All',
  'Dump',
  '+6',
  '+10',
  'Roulette',
  ...BOMBOCLATT_CARD_VALUES,
]);

export const DRAW_CARD_AMOUNTS: Record<string, number> = {
  '+2': 2,
  '+4': 4,
  '+6': 6,
  '+10': 10,
};

export const MERCY_HAND_LIMIT = 25;
export const BOMBOCLATT_HAND_LIMIT = 50;

export const COLOR_HEX: Record<CardColor, string> = {
  Red: '#ee3f4f',
  Blue: '#2f86f0',
  Green: '#16b07a',
  Yellow: '#f6c030',
  Wild: '#1c2133',
};

export const PALETTE = {
  bgTop: '#101329',
  bgMid: '#191d3a',
  bgBottom: '#2b2850',
  table: '#153d4b',
  tableEdge: '#36a89d',
  ink: '#f4f4ed',
  muted: '#9fb3b0',
  gold: '#f5c84b',
  cardWhite: '#f8f6ea',
  cardBack: '#20233c',
} as const;

export interface Card {
  color: CardColor;
  value: string;
  uid: number;
}

export type PlayerRole = 'host' | 'guest';

export type TurnPhase = 'waiting' | 'dealing' | 'host' | 'guest' | 'busy' | 'over';

export type GameMode = 'solo' | 'multiplayer';

export interface SeatInfo {
  index: number;
  name: string;
  isCpu: boolean;
  connected: boolean;
  occupied?: boolean;
  cardCount: number;
  unoArmed: boolean;
  eliminated: boolean;
  score: number;
  kickVotes?: number;
  kickVotesRequired?: number;
  votedToKickBySelf?: boolean;
}

export interface PendingRizzPrompt {
  promptId: string;
  fromIndex: number;
  fromName: string;
  line: string;
}

export interface PeekTargetInfo {
  targetIndex: number;
  targetName: string;
  cards: Card[];
  expiresAt: number;
}

export type EffectEvent =
  | {
      kind: 'impact';
      card: Card;
      activeColor: SuitColor;
      seatIndex?: number;
    }
  | {
      kind: 'seat_draw';
      seatIndex: number;
      count: number;
    }
  | {
      kind: 'banner';
      text: string;
      color: string;
      size?: number;
      dur?: number;
      dy?: number;
      delay?: number;
    }
  | {
      kind: 'reshuffle';
    }
  | {
      kind: 'uno';
      whoName: string;
      isSelf: boolean;
      seatIndex?: number;
    }
  | {
      kind: 'uno_penalty';
      whoName: string;
      isSelf: boolean;
      seatIndex?: number;
    }
  | {
      kind: 'roulette';
      whoName: string;
      color: SuitColor;
      drawnCount: number;
      seatIndex?: number;
    }
  | {
      kind: 'dump';
      whoName: string;
      color: SuitColor;
      count: number;
      seatIndex?: number;
    }
  | {
      kind: 'mercy_ko';
      loserName: string;
      isSelfLoser: boolean;
      seatIndex?: number;
    }
  | {
      kind: 'rizz_line';
      fromName: string;
      targetName: string;
      line: string;
      accepted?: boolean;
      seatIndex?: number;
      targetIndex?: number;
    }
  | {
      kind: 'crow_feathers';
      whoName: string;
      targetName: string;
      seatIndex?: number;
      targetIndex?: number;
    }
  | {
      kind: 'surjo_ko';
      whoName: string;
      targetName: string;
      isSelfLoser: boolean;
      seatIndex?: number;
      targetIndex?: number;
    }
  | {
      kind: 'steal_power';
      thiefName: string;
      victimName: string;
      stolenCard?: Card;
      thiefIndex?: number;
      victimIndex?: number;
    }
  | {
      kind: 'win';
      winnerRole: PlayerRole;
      winnerIndex?: number;
      winnerName?: string;
      milestone?: 1 | 5 | 10;
    }
  | {
      kind: 'deal';
      isJasirBoost: boolean;
      difficulty?: DifficultyLevel;
    };

export interface ClientGameView {
  roomId: string;
  mode: GameMode;
  difficulty: DifficultyLevel;
  playerCount: number;
  selfIndex: number;
  turnIndex: number | null;
  direction: 1 | -1;
  seats: SeatInfo[];
  selfRole: PlayerRole;
  selfName: string;
  opponentName: string;
  opponentConnected: boolean;
  selfHand: Card[];
  opponentCardIds: number[];
  opponentCount: number;
  discardPile: Card[];
  deckCount: number;
  currentColor: SuitColor;
  turn: TurnPhase;
  drawnUid: number | null;
  pendingDrawStack: number;
  pendingDrawMin: number;
  selfUnoArmed: boolean;
  opponentUnoArmed: boolean;
  winner: PlayerRole | null;
  winnerIndex: number | null;
  winnerName: string | null;
  score: {
    self: number;
    opponent: number;
  };
  message: string;
  roundId: number;
  hostIndex?: number;
  turnDeadlineAt?: number | null;
  turnDurationMs?: number;
  serverNow?: number;
  pendingRizzPrompt?: PendingRizzPrompt | null;
  peekTarget?: PeekTargetInfo | null;
}

export type ServerWsMessage =
  | {
      type: 'state';
      view: ClientGameView;
      effects: EffectEvent[];
    }
  | {
      type: 'error';
      message: string;
    }
  | {
      type: 'pong';
      ts?: number;
    };

export type ClientWsAction =
  | {
      type: 'join';
      roomId: string;
      token: string;
      clientId: string;
      name: string;
    }
  | {
      type: 'start_now';
      fillCpus?: boolean;
    }
  | {
      type: 'play';
      uid: number;
      chosenColor?: SuitColor;
    }
  | {
      type: 'rizz_response';
      promptId: string;
      accept: boolean;
      cardUid?: number;
    }
  | {
      type: 'draw';
    }
  | {
      type: 'pass';
    }
  | {
      type: 'call_uno';
    }
  | {
      type: 'restart';
      difficulty?: DifficultyLevel;
    }
  | {
      type: 'rename';
      name: string;
    }
  | {
      type: 'kick_player';
      seatIndex: number;
    }
  | {
      type: 'vote_kick';
      seatIndex: number;
    }
  | {
      type: 'ping';
      ts?: number;
    };
