export const COLORS = ['Red', 'Blue', 'Green', 'Yellow'] as const;
export type SuitColor = (typeof COLORS)[number];
export type CardColor = SuitColor | 'Wild';

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 10;

export type DifficultyLevel = 'chill' | 'normal' | 'hard' | 'no_mercy';

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
}

export interface JoinRoomPayload {
  roomId: string;
  token: string;
  clientId: string;
  name: string;
}

export interface PlayCardPayload {
  uid: number;
  chosenColor?: SuitColor;
}

export interface RestartPayload {
  difficulty?: DifficultyLevel;
}

export interface StartGamePayload {
  fillCpus?: boolean;
}

export interface RenamePayload {
  name: string;
}

export interface KickPlayerPayload {
  seatIndex: number;
}

export interface ServerStatePayload {
  view: ClientGameView;
  effects: EffectEvent[];
}
