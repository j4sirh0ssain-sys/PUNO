export const COLORS = ['Red', 'Blue', 'Green', 'Yellow'] as const;
export type SuitColor = (typeof COLORS)[number];
export type CardColor = SuitColor | 'Wild';

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 10;

export type DifficultyLevel = 'chill' | 'normal' | 'hard' | 'no_mercy';

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
    id: 'chill',
    label: 'Casual',
    tier: 'Tier 1',
    summary: 'Relaxed CPU · Classic 108-card deck',
    accent: '#34d399',
    level: 1,
  },
  {
    id: 'normal',
    label: 'Standard',
    tier: 'Tier 2',
    summary: 'Balanced CPU · Classic UNO rules',
    accent: '#38bdf8',
    level: 2,
  },
  {
    id: 'hard',
    label: 'Ruthless',
    tier: 'Tier 3',
    summary: 'Tactical CPU · Action chaining & sharp color traps',
    accent: '#fb923c',
    level: 3,
  },
  {
    id: 'no_mercy',
    label: 'No Mercy',
    tier: 'Deadly',
    summary: '+6, +10, Color Roulette, Skip All, Dump & 25-card Mercy KO',
    accent: '#f43f5e',
    level: 4,
  },
];

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
]);

export const DRAW_CARD_AMOUNTS: Record<string, number> = {
  '+2': 2,
  '+4': 4,
  '+6': 6,
  '+10': 10,
};

export const MERCY_HAND_LIMIT = 25;

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
  cardCount: number;
  unoArmed: boolean;
  eliminated: boolean;
  score: number;
}

export type EffectEvent =
  | {
      kind: 'impact';
      card: Card;
      activeColor: SuitColor;
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
    }
  | {
      kind: 'uno_penalty';
      whoName: string;
      isSelf: boolean;
    }
  | {
      kind: 'roulette';
      whoName: string;
      color: SuitColor;
      drawnCount: number;
    }
  | {
      kind: 'dump';
      whoName: string;
      color: SuitColor;
      count: number;
    }
  | {
      kind: 'mercy_ko';
      loserName: string;
      isSelfLoser: boolean;
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
    }
  | {
      type: 'play';
      uid: number;
      chosenColor?: SuitColor;
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
    };
