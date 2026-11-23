import crypto from 'node:crypto';
import type http from 'node:http';
import cors from 'cors';
import express, { type Express } from 'express';
import { Server as SocketIOServer, type Socket } from 'socket.io';
import {
  canPlayCard,
  chooseCpuCard,
  chooseCpuWildColor,
  clampPlayerCount,
  dealRoundMulti,
  drawColorRoulette,
  drawOneFromDeck,
  getDrawAmount,
  getHandLimit,
  getNextAliveSeatIndex,
  isDifficultyLevel,
  isNoMercyRuleset,
  isSuitColor,
  shouldCpuCallUno,
} from './game/engine.ts';
import {
  POWER_CARD_VALUES,
  RIZZ_PICKUP_LINES,
  type Card,
  type ClientGameView,
  type DifficultyLevel,
  type EffectEvent,
  type JoinRoomPayload,
  type KickPlayerPayload,
  type PlayCardPayload,
  type PlayerRole,
  type RenamePayload,
  type RestartPayload,
  type RizzResponsePayload,
  type SeatInfo,
  type ServerStatePayload,
  type StartGamePayload,
  type SuitColor,
  type TurnPhase,
} from './game/types.ts';

const ROOM_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const DEFAULT_GITHUB_PAGES_ORIGIN = 'https://j4sirh0ssain-sys.github.io';
const DEFAULT_TURN_TIMEOUT_MS = 25_000;
const RIZZ_PROMPT_TIMEOUT_MS = 20_000;
const RAFATH_PEEK_DURATION_MS = 7_500;

interface ServerSeat {
  index: number;
  clientId: string | null;
  name: string;
  socketId: string | null;
  hasConnectedOnce: boolean;
  isCpu: boolean;
  hand: Card[];
  unoArmed: boolean;
  eliminated: boolean;
  score: number;
}

interface PendingRizzState {
  promptId: string;
  fromIndex: number;
  targetIndex: number;
  line: string;
  nextTurnIndex: number;
  chosenColor: SuitColor;
  timer: NodeJS.Timeout | null;
}

interface PeekState {
  viewerIndex: number;
  targetIndex: number;
  targetName: string;
  cards: Card[];
  expiresAt: number;
}

interface RoomState {
  roomId: string;
  token: string;
  difficulty: DifficultyLevel;
  playerCount: number;
  hostIndex: number;
  seats: ServerSeat[];
  deck: Card[];
  discard: Card[];
  currentColor: SuitColor;
  turn: TurnPhase;
  turnIndex: number;
  direction: 1 | -1;
  drawnUid: number | null;
  pendingDrawStack: number;
  pendingDrawMin: number;
  winner: PlayerRole | null;
  winnerIndex: number | null;
  winnerName: string | null;
  message: string;
  roundId: number;
  turnSeq: number;
  cpuTimer: NodeJS.Timeout | null;
  turnTimer: NodeJS.Timeout | null;
  turnDeadlineAt: number | null;
  pendingRizz: PendingRizzState | null;
  peekState: PeekState | null;
  goonerSurjoUsed: boolean;
  kickedClientIds: Set<string>;
  kickVotes: Map<number, Set<string>>;
  createdAt: number;
  lastActivityAt: number;
}

function normalizeOrigin(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed === '*') return '*';
  try {
    return new URL(trimmed).origin;
  } catch {
    return trimmed.replace(/\/+$/, '');
  }
}

export function buildAllowedOrigins(): Set<string> {
  const allowed = new Set<string>([DEFAULT_GITHUB_PAGES_ORIGIN]);

  const rawLists = [
    process.env.CORS_ORIGINS,
    process.env.FRONTEND_URL,
    process.env.APP_URL,
  ];

  for (const list of rawLists) {
    if (!list) continue;
    for (const entry of list.split(',')) {
      const normalized = normalizeOrigin(entry);
      if (normalized) allowed.add(normalized);
    }
  }

  return allowed;
}

export function isOriginAllowed(
  originHeader: string | undefined,
  allowedOrigins: Set<string>,
  hostHeader?: string
): boolean {
  if (!originHeader) return true;
  if (allowedOrigins.has('*')) return true;

  const normalized = normalizeOrigin(originHeader);
  if (!normalized) return false;
  if (allowedOrigins.has(normalized)) return true;

  if (hostHeader) {
    try {
      const originUrl = new URL(normalized);
      if (originUrl.host === hostHeader) return true;
    } catch {
      // ignore invalid URL
    }
  }

  if (process.env.NODE_ENV !== 'production') {
    try {
      const originUrl = new URL(normalized);
      if (
        originUrl.hostname === 'localhost' ||
        originUrl.hostname === '127.0.0.1' ||
        originUrl.hostname.endsWith('.run.app')
      ) {
        return true;
      }
    } catch {
      // ignore
    }
  }

  return false;
}

function sanitizeName(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  const cleaned = raw.replace(/\s+/g, ' ').trim().slice(0, 18);
  return cleaned || fallback;
}

function sanitizeRoomCode(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
}

export function attachMultiplayerServer(
  app: Express,
  server: http.Server,
  options: { exposeRootHealth?: boolean; turnTimeoutMs?: number } = {}
): SocketIOServer {
  const rooms = new Map<string, RoomState>();
  const allowedOrigins = buildAllowedOrigins();
  const turnTimeoutMs =
    typeof options.turnTimeoutMs === 'number' && options.turnTimeoutMs > 0
      ? options.turnTimeoutMs
      : DEFAULT_TURN_TIMEOUT_MS;

  const corsMiddleware = cors((req, callback) => {
    const origin = req.headers.origin;
    const host = req.headers.host;
    if (isOriginAllowed(origin, allowedOrigins, host)) {
      callback(null, {
        origin: true,
        methods: ['GET', 'POST', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization'],
        credentials: false,
      });
    } else {
      callback(new Error(`Origin not allowed by CORS: ${origin ?? 'unknown'}`));
    }
  });

  app.use(corsMiddleware);
  app.options('*', corsMiddleware);
  app.use(express.json());

  const io = new SocketIOServer(server, {
    cors: {
      origin: (origin, callback) => {
        if (isOriginAllowed(origin, allowedOrigins)) {
          callback(null, true);
        } else {
          callback(new Error(`Origin not allowed by CORS: ${origin ?? 'unknown'}`));
        }
      },
      methods: ['GET', 'POST'],
      credentials: false,
    },
    allowRequest: (req, callback) => {
      const origin = req.headers.origin;
      const host = req.headers.host;
      callback(null, isOriginAllowed(origin, allowedOrigins, host));
    },
    transports: ['polling', 'websocket'],
    pingInterval: 20_000,
    pingTimeout: 25_000,
  });

  function generateRoomCode(): string {
    for (let attempt = 0; attempt < 24; attempt++) {
      let code = '';
      for (let i = 0; i < 6; i++) {
        code += ROOM_CODE_ALPHABET[crypto.randomInt(ROOM_CODE_ALPHABET.length)];
      }
      if (!rooms.has(code)) return code;
    }
    return crypto.randomBytes(4).toString('hex').toUpperCase();
  }

  function createRoom(
    hostNameRaw?: unknown,
    difficultyRaw?: unknown,
    playerCountRaw?: unknown,
    hostClientIdRaw?: unknown
  ): RoomState {
    const roomId = generateRoomCode();
    const token = crypto.randomBytes(16).toString('base64url');
    const hostName = sanitizeName(hostNameRaw, 'Host');
    const difficulty: DifficultyLevel = isDifficultyLevel(difficultyRaw) ? difficultyRaw : 'normal';
    const playerCount = clampPlayerCount(playerCountRaw);
    const hostClientId =
      typeof hostClientIdRaw === 'string' &&
      hostClientIdRaw.trim().length > 0 &&
      hostClientIdRaw.trim().length <= 100
        ? hostClientIdRaw.trim()
        : null;

    const seatNames = Array.from({ length: playerCount }, (_, idx) =>
      idx === 0 ? hostName : `Player ${idx + 1}`
    );
    const dealt = dealRoundMulti(seatNames, difficulty);

    const seats: ServerSeat[] = seatNames.map((name, idx) => ({
      index: idx,
      clientId: idx === 0 ? hostClientId : null,
      name,
      socketId: null,
      hasConnectedOnce: false,
      isCpu: false,
      hand: dealt.hands[idx] ?? [],
      unoArmed: false,
      eliminated: false,
      score: 0,
    }));

    const room: RoomState = {
      roomId,
      token,
      difficulty,
      playerCount,
      hostIndex: 0,
      seats,
      deck: dealt.deck,
      discard: dealt.discard,
      currentColor: dealt.currentColor,
      turn: 'waiting',
      turnIndex: 0,
      direction: 1,
      drawnUid: null,
      pendingDrawStack: 0,
      pendingDrawMin: 0,
      winner: null,
      winnerIndex: null,
      winnerName: null,
      message:
        playerCount === 2
          ? `Share room code ${roomId} or the QR invite link.`
          : `Waiting for players (0/${playerCount} ready) — code ${roomId}.`,
      roundId: 1,
      turnSeq: 0,
      cpuTimer: null,
      turnTimer: null,
      turnDeadlineAt: null,
      pendingRizz: null,
      peekState: null,
      goonerSurjoUsed: false,
      kickedClientIds: new Set<string>(),
      kickVotes: new Map<number, Set<string>>(),
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    };
    rooms.set(roomId, room);
    return room;
  }

  function getSeatConnected(seat: ServerSeat): boolean {
    if (seat.isCpu) return true;
    if (seat.clientId === null || seat.socketId === null) return false;
    const sock = io.sockets.sockets.get(seat.socketId);
    return Boolean(sock && sock.connected);
  }

  function getAliveSeats(room: RoomState): ServerSeat[] {
    return room.seats.filter((s) => !s.eliminated);
  }

  function advanceTurn(room: RoomState, steps = 1): number {
    const flags = room.seats.map((s) => s.eliminated);
    return getNextAliveSeatIndex(flags, room.turnIndex, room.direction, steps);
  }

  function buildView(room: RoomState, seatIndex: number): ClientGameView {
    const selfSeat = room.seats[seatIndex] ?? room.seats[0];
    const selfRole: PlayerRole = seatIndex === 0 ? 'host' : 'guest';
    const nextIndex = (seatIndex + 1) % room.seats.length;
    const primaryOpp = room.seats[nextIndex] ?? room.seats[0];

    const humanCount = room.seats.filter((s) => !s.isCpu && s.clientId !== null).length;
    const kickVotesRequired =
      humanCount >= 3 ? Math.floor(humanCount / 2) + 1 : 2;
    const selfClientId = selfSeat.clientId;

    const seatInfos: SeatInfo[] = room.seats.map((s) => {
      const voterSet = room.kickVotes.get(s.index);
      return {
        index: s.index,
        name: s.name,
        isCpu: s.isCpu,
        connected: getSeatConnected(s),
        occupied: s.clientId !== null && !s.isCpu,
        cardCount: s.hand.length,
        unoArmed: s.unoArmed,
        eliminated: s.eliminated,
        score: s.score,
        kickVotes: voterSet ? voterSet.size : 0,
        kickVotesRequired,
        votedToKickBySelf: Boolean(selfClientId && voterSet?.has(selfClientId)),
      };
    });

    let viewTurn: TurnPhase;
    if (
      room.turn === 'waiting' ||
      room.turn === 'over' ||
      room.turn === 'dealing' ||
      room.turn === 'busy'
    ) {
      viewTurn = room.turn;
    } else if (room.turnIndex === seatIndex) {
      viewTurn = selfRole;
    } else {
      viewTurn = selfRole === 'host' ? 'guest' : 'host';
    }

    let viewWinner: PlayerRole | null = null;
    if (room.winnerIndex !== null) {
      viewWinner =
        room.winnerIndex === seatIndex ? selfRole : selfRole === 'host' ? 'guest' : 'host';
    }

    const bestOppScore = room.seats.reduce(
      (max, s) => (s.index === seatIndex ? max : Math.max(max, s.score)),
      0
    );

    const nowMs = Date.now();
    return {
      roomId: room.roomId,
      mode: 'multiplayer',
      difficulty: room.difficulty,
      playerCount: room.playerCount,
      selfIndex: seatIndex,
      turnIndex: room.turn === 'host' || room.turn === 'guest' ? room.turnIndex : null,
      direction: room.direction,
      seats: seatInfos,
      selfRole,
      selfName: selfSeat.name,
      opponentName: primaryOpp.name,
      opponentConnected:
        room.playerCount === 2
          ? getSeatConnected(primaryOpp)
          : room.seats.some((s) => s.index !== seatIndex && getSeatConnected(s)),
      selfHand: selfSeat.hand,
      opponentCardIds: room.playerCount === 2 ? primaryOpp.hand.map((c) => c.uid) : [],
      opponentCount: primaryOpp.hand.length,
      discardPile: room.discard.slice(-5),
      deckCount: room.deck.length,
      currentColor: room.currentColor,
      turn: viewTurn,
      drawnUid: room.drawnUid,
      pendingDrawStack: room.pendingDrawStack,
      pendingDrawMin: room.pendingDrawMin,
      selfUnoArmed: selfSeat.unoArmed,
      opponentUnoArmed: primaryOpp.unoArmed,
      winner: viewWinner,
      winnerIndex: room.winnerIndex,
      winnerName: room.winnerName,
      score: {
        self: selfSeat.score,
        opponent: bestOppScore,
      },
      message: room.message,
      roundId: room.roundId,
      hostIndex: room.hostIndex,
      turnDeadlineAt: room.turnDeadlineAt,
      turnDurationMs: turnTimeoutMs,
      serverNow: nowMs,
      pendingRizzPrompt:
        room.pendingRizz && room.pendingRizz.targetIndex === seatIndex
          ? {
              promptId: room.pendingRizz.promptId,
              fromIndex: room.pendingRizz.fromIndex,
              fromName: room.seats[room.pendingRizz.fromIndex]?.name ?? 'Player',
              line: room.pendingRizz.line,
            }
          : null,
      peekTarget:
        room.peekState &&
        room.peekState.viewerIndex === seatIndex &&
        nowMs < room.peekState.expiresAt
          ? {
              targetIndex: room.peekState.targetIndex,
              targetName: room.peekState.targetName,
              cards: room.peekState.cards,
              expiresAt: room.peekState.expiresAt,
            }
          : null,
    };
  }

  function sendError(socket: Socket, message: string): void {
    socket.emit('game_error', { message });
  }

  function broadcastRoom(
    room: RoomState,
    perSeatEffects?: (seatIndex: number) => EffectEvent[]
  ): void {
    room.lastActivityAt = Date.now();
    for (const seat of room.seats) {
      if (seat.socketId && io.sockets.sockets.has(seat.socketId)) {
        const payload: ServerStatePayload = {
          view: buildView(room, seat.index),
          effects: perSeatEffects ? perSeatEffects(seat.index) : [],
        };
        io.to(seat.socketId).emit('state', payload);
      }
    }
  }

  function clearCpuTimer(room: RoomState): void {
    if (room.cpuTimer) {
      clearTimeout(room.cpuTimer);
      room.cpuTimer = null;
    }
  }

  function clearTurnTimer(room: RoomState): void {
    if (room.turnTimer) {
      clearTimeout(room.turnTimer);
      room.turnTimer = null;
    }
    room.turnDeadlineAt = null;
  }

  function clearPendingRizz(room: RoomState): void {
    if (room.pendingRizz?.timer) {
      clearTimeout(room.pendingRizz.timer);
    }
    room.pendingRizz = null;
  }

  function recycleHandToDeck(room: RoomState, hand: Card[]): void {
    if (hand.length === 0) return;
    const filtered = hand.splice(0, hand.length).filter(
      (c) => !(room.goonerSurjoUsed && c.value === 'Gooner Surjo')
    );
    if (filtered.length > 0) {
      room.deck.unshift(...filtered);
    }
  }

  function drawWithUniqueSurjoGuard(
    room: RoomState,
    targetHand: Card[]
  ): { card: Card | null; reshuffled: boolean } {
    return drawOneFromDeck(room.deck, room.discard, targetHand, {
      surjoUsed: room.goonerSurjoUsed,
      surjoDrawChance: room.difficulty === 'bomboclatt' ? 0.05 : 0,
    });
  }

  function handleTurnTimeout(
    room: RoomState,
    expectedRound: number,
    expectedSeatIndex: number,
    expectedTurnSeq: number
  ): void {
    if (
      room.roundId !== expectedRound ||
      room.turnSeq !== expectedTurnSeq ||
      room.winnerIndex !== null ||
      (room.turn !== 'host' && room.turn !== 'guest') ||
      room.turnIndex !== expectedSeatIndex
    ) {
      return;
    }

    const timedOutSeat = room.seats[expectedSeatIndex];
    if (!timedOutSeat || timedOutSeat.eliminated || timedOutSeat.isCpu) return;

    clearTurnTimer(room);
    timedOutSeat.unoArmed = false;
    room.drawnUid = null;

    if (room.pendingDrawStack > 0) {
      const stackCount = room.pendingDrawStack;
      const effs: EffectEvent[] = [
        { kind: 'banner', text: 'TIME UP!', color: '#fb923c', size: 0.65, dur: 0.9 },
      ];
      for (let i = 0; i < stackCount; i++) {
        const res = drawWithUniqueSurjoGuard(room, timedOutSeat.hand);
        if (res.reshuffled) effs.push({ kind: 'reshuffle' });
      }
      effs.push({ kind: 'seat_draw', seatIndex: timedOutSeat.index, count: stackCount });
      room.pendingDrawStack = 0;
      room.pendingDrawMin = 0;

      if (handleMercyKnockout(room, timedOutSeat, effs)) return;

      room.turnIndex = advanceTurn(room, 1);
      room.turn = room.turnIndex === 0 ? 'host' : 'guest';
      const nextSeat = room.seats[room.turnIndex];
      room.message = `${timedOutSeat.name} timed out (+${stackCount} cards) — ${nextSeat.name}'s turn.`;
      scheduleCpuIfNeeded(room);
      broadcastRoom(room, () => effs);
      return;
    }

    room.turnIndex = advanceTurn(room, 1);
    room.turn = room.turnIndex === 0 ? 'host' : 'guest';
    const nextSeat = room.seats[room.turnIndex];
    room.message = `${timedOutSeat.name} timed out — ${nextSeat.name}'s turn.`;
    scheduleCpuIfNeeded(room);
    broadcastRoom(room, () => [
      { kind: 'banner', text: 'TIME UP!', color: '#fb923c', size: 0.65, dur: 0.9 },
    ]);
  }

  function scheduleCpuIfNeeded(room: RoomState): void {
    clearCpuTimer(room);
    clearTurnTimer(room);
    if (room.winnerIndex !== null || (room.turn !== 'host' && room.turn !== 'guest')) return;
    const activeSeat = room.seats[room.turnIndex];
    if (!activeSeat || activeSeat.eliminated) return;

    room.turnSeq += 1;
    const expectedRound = room.roundId;
    const expectedSeatIndex = activeSeat.index;
    const expectedTurnSeq = room.turnSeq;

    if (activeSeat.isCpu) {
      room.cpuTimer = setTimeout(() => {
        if (
          room.roundId !== expectedRound ||
          room.winnerIndex !== null ||
          room.turnIndex !== expectedSeatIndex ||
          !activeSeat.isCpu ||
          activeSeat.eliminated
        ) {
          return;
        }
        executeCpuTurn(room, activeSeat);
      }, 800);
      return;
    }

    room.turnDeadlineAt = Date.now() + turnTimeoutMs;
    room.turnTimer = setTimeout(() => {
      handleTurnTimeout(room, expectedRound, expectedSeatIndex, expectedTurnSeq);
    }, turnTimeoutMs);
  }

  function finishRoundWithWinner(
    room: RoomState,
    winnerSeat: ServerSeat,
    message: string,
    extraEffectsForSeat?: (seatIdx: number) => EffectEvent[]
  ): void {
    clearCpuTimer(room);
    clearTurnTimer(room);
    clearPendingRizz(room);
    room.peekState = null;
    room.pendingDrawStack = 0;
    room.pendingDrawMin = 0;
    room.winner = winnerSeat.index === 0 ? 'host' : 'guest';
    room.winnerIndex = winnerSeat.index;
    room.winnerName = winnerSeat.name;
    room.turn = 'over';
    winnerSeat.score += 1;
    room.message = message;
    broadcastRoom(room, (seatIdx) => {
      const extra = extraEffectsForSeat ? extraEffectsForSeat(seatIdx) : [];
      return [
        ...extra,
        {
          kind: 'win',
          winnerRole:
            winnerSeat.index === seatIdx
              ? seatIdx === 0
                ? 'host'
                : 'guest'
              : seatIdx === 0
                ? 'guest'
                : 'host',
          winnerIndex: winnerSeat.index,
          winnerName: winnerSeat.name,
        },
      ];
    });
  }

  function handleMercyKnockout(
    room: RoomState,
    loserSeat: ServerSeat,
    baseEffects: EffectEvent[]
  ): boolean {
    const limit = getHandLimit(room.difficulty);
    if (!limit || loserSeat.hand.length < limit) {
      return false;
    }
    loserSeat.eliminated = true;
    recycleHandToDeck(room, loserSeat.hand);
    const alive = getAliveSeats(room);
    if (alive.length <= 1) {
      const survivor = alive[0] ?? room.seats[0];
      finishRoundWithWinner(
        room,
        survivor,
        `KNOCKOUT! ${loserSeat.name} hit ${limit}+ cards — ${survivor.name} wins!`,
        (seatIdx) => [
          ...baseEffects,
          {
            kind: 'mercy_ko',
            loserName: loserSeat.name,
            isSelfLoser: loserSeat.index === seatIdx,
            seatIndex: loserSeat.index,
          },
        ]
      );
      return true;
    }

    if (room.turnIndex === loserSeat.index) {
      room.turnIndex = advanceTurn(room, 1);
    }
    room.turn = room.turnIndex === 0 ? 'host' : 'guest';
    const nextSeat = room.seats[room.turnIndex];
    room.message = `KNOCKOUT! ${loserSeat.name} hit ${limit}+ cards! ${nextSeat.name}'s turn.`;
    scheduleCpuIfNeeded(room);
    broadcastRoom(room, (seatIdx) => [
      ...baseEffects,
      {
        kind: 'mercy_ko',
        loserName: loserSeat.name,
        isSelfLoser: loserSeat.index === seatIdx,
        seatIndex: loserSeat.index,
      },
    ]);
    return true;
  }

  function resolveRizzPrompt(
    room: RoomState,
    promptId: string,
    accept: boolean,
    chosenCardUid?: number
  ): void {
    const pending = room.pendingRizz;
    if (!pending || pending.promptId !== promptId) return;
    if (pending.timer) {
      clearTimeout(pending.timer);
      pending.timer = null;
    }
    room.pendingRizz = null;

    const fromSeat = room.seats[pending.fromIndex];
    const targetSeat = room.seats[pending.targetIndex];
    const effects: EffectEvent[] = [];

    if (accept && fromSeat && targetSeat && !targetSeat.eliminated && targetSeat.hand.length > 0) {
      const requestedIdx =
        typeof chosenCardUid === 'number'
          ? targetSeat.hand.findIndex((c) => c.uid === chosenCardUid)
          : -1;
      const pickIdx =
        requestedIdx !== -1 ? requestedIdx : Math.floor(Math.random() * targetSeat.hand.length);
      const [gifted] = targetSeat.hand.splice(pickIdx, 1);
      fromSeat.hand.push(gifted);
      effects.push({
        kind: 'rizz_line',
        fromName: fromSeat.name,
        targetName: targetSeat.name,
        line: pending.line,
        accepted: true,
        seatIndex: fromSeat.index,
        targetIndex: targetSeat.index,
      });

      if (targetSeat.hand.length === 0) {
        finishRoundWithWinner(
          room,
          targetSeat,
          `${targetSeat.name} gave away their last card to Rizzler Arvin and wins!`,
          () => effects
        );
        return;
      }
      if (handleMercyKnockout(room, fromSeat, effects)) return;
      room.message = `${targetSeat.name} accepted Rizzler Arvin's line 👍 (+1 card to ${fromSeat.name})!`;
    } else {
      effects.push({
        kind: 'rizz_line',
        fromName: fromSeat?.name ?? 'Player',
        targetName: targetSeat?.name ?? 'Opponent',
        line: pending.line,
        accepted: false,
        seatIndex: pending.fromIndex,
        targetIndex: pending.targetIndex,
      });
      room.message = `${targetSeat?.name ?? 'Opponent'} curved Rizzler Arvin 👎 — match continues!`;
    }

    const nextIdx =
      room.seats[pending.nextTurnIndex] && !room.seats[pending.nextTurnIndex].eliminated
        ? pending.nextTurnIndex
        : advanceTurn(room, 1);
    room.turnIndex = nextIdx;
    room.turn = nextIdx === 0 ? 'host' : 'guest';
    const nextSeat = room.seats[nextIdx];
    room.message = `${room.message} ${nextSeat ? `${nextSeat.name}'s turn.` : ''}`.trim();
    scheduleCpuIfNeeded(room);
    broadcastRoom(room, () => effects);
  }

  function commitSeatPlay(
    room: RoomState,
    activeSeat: ServerSeat,
    cardIndex: number,
    chosenColor: SuitColor
  ): void {
    const card = activeSeat.hand[cardIndex];
    const wasUnoArmed = activeSeat.unoArmed;
    activeSeat.unoArmed = false;
    activeSeat.hand.splice(cardIndex, 1);

    const sharedEffects: EffectEvent[] = [];

    if (card.value === 'Dump' && card.color !== 'Wild') {
      const extras: Card[] = [];
      for (let i = activeSeat.hand.length - 1; i >= 0; i--) {
        if (activeSeat.hand[i].color === card.color) {
          const [matched] = activeSeat.hand.splice(i, 1);
          extras.push(matched);
        }
      }
      room.discard.push(...extras);
      sharedEffects.push({
        kind: 'dump',
        whoName: activeSeat.name,
        color: chosenColor,
        count: extras.length + 1,
        seatIndex: activeSeat.index,
      });
    }

    room.discard.push(card);
    room.currentColor = chosenColor;
    room.drawnUid = null;
    sharedEffects.push({
      kind: 'impact',
      card,
      activeColor: chosenColor,
      seatIndex: activeSeat.index,
    });

    if (activeSeat.hand.length === 0) {
      finishRoundWithWinner(room, activeSeat, `${activeSeat.name} wins the round!`, () => sharedEffects);
      return;
    }

    let penalizedUno = false;
    let unoTrigger: 'armed' | 'penalty' | null = null;
    if (activeSeat.hand.length === 1) {
      if (wasUnoArmed) {
        unoTrigger = 'armed';
      } else {
        penalizedUno = true;
        unoTrigger = 'penalty';
        for (let i = 0; i < 2; i++) {
          const res = drawWithUniqueSurjoGuard(room, activeSeat.hand);
          if (res.reshuffled) sharedEffects.push({ kind: 'reshuffle' });
        }
        sharedEffects.push({ kind: 'seat_draw', seatIndex: activeSeat.index, count: 2 });
      }
    }

    const perSeatEffects = (seatIdx: number): EffectEvent[] => {
      const list = [...sharedEffects];
      if (unoTrigger === 'armed') {
        list.push({
          kind: 'uno',
          whoName: activeSeat.name,
          isSelf: activeSeat.index === seatIdx,
          seatIndex: activeSeat.index,
        });
      } else if (unoTrigger === 'penalty') {
        list.push({
          kind: 'uno_penalty',
          whoName: activeSeat.name,
          isSelf: activeSeat.index === seatIdx,
          seatIndex: activeSeat.index,
        });
      }
      return list;
    };

    const aliveSeats = getAliveSeats(room);
    const aliveCount = aliveSeats.length;
    const aliveOpponents = aliveSeats.filter((s) => s.index !== activeSeat.index);
    const drawAmount = getDrawAmount(card);

    if (card.value === 'Rizzler Arvin') {
      const targetSeat =
        aliveOpponents.length > 0
          ? aliveOpponents[Math.floor(Math.random() * aliveOpponents.length)]
          : null;
      const line = RIZZ_PICKUP_LINES[Math.floor(Math.random() * RIZZ_PICKUP_LINES.length)];
      if (!targetSeat) {
        room.turnIndex = advanceTurn(room, 1);
        room.turn = room.turnIndex === 0 ? 'host' : 'guest';
        room.message = `${activeSeat.name} dropped Rizzler Arvin (${chosenColor})!`;
      } else if (targetSeat.isCpu) {
        const accepted = targetSeat.hand.length > 0 && Math.random() < 0.45;
        if (accepted) {
          const pickIdx = Math.floor(Math.random() * targetSeat.hand.length);
          const [gifted] = targetSeat.hand.splice(pickIdx, 1);
          activeSeat.hand.push(gifted);
          sharedEffects.push({
            kind: 'rizz_line',
            fromName: activeSeat.name,
            targetName: targetSeat.name,
            line,
            accepted: true,
            seatIndex: activeSeat.index,
            targetIndex: targetSeat.index,
          });
          if (targetSeat.hand.length === 0) {
            finishRoundWithWinner(
              room,
              targetSeat,
              `${targetSeat.name} accepted Rizzler Arvin 👍 and gave away its last card!`,
              perSeatEffects
            );
            return;
          }
          if (handleMercyKnockout(room, activeSeat, perSeatEffects(activeSeat.index))) return;
        } else {
          sharedEffects.push({
            kind: 'rizz_line',
            fromName: activeSeat.name,
            targetName: targetSeat.name,
            line,
            accepted: false,
            seatIndex: activeSeat.index,
            targetIndex: targetSeat.index,
          });
        }
        room.turnIndex = advanceTurn(room, 1);
        room.turn = room.turnIndex === 0 ? 'host' : 'guest';
        const nextSeat = room.seats[room.turnIndex];
        room.message = accepted
          ? `${activeSeat.name} rizzed ${targetSeat.name} 👍 (+1 card)! ${nextSeat.name}'s turn.`
          : `${targetSeat.name} curved ${activeSeat.name}'s rizz 👎! ${nextSeat.name}'s turn.`;
      } else {
        clearCpuTimer(room);
        clearTurnTimer(room);
        clearPendingRizz(room);
        const promptId = crypto.randomUUID();
        const nextTurnIndex = advanceTurn(room, 1);
        const timer = setTimeout(() => {
          resolveRizzPrompt(room, promptId, false);
        }, RIZZ_PROMPT_TIMEOUT_MS);
        room.pendingRizz = {
          promptId,
          fromIndex: activeSeat.index,
          targetIndex: targetSeat.index,
          line,
          nextTurnIndex,
          chosenColor,
          timer,
        };
        room.turn = 'busy';
        room.message = `${activeSeat.name} sent a Rizzler Arvin pickup line to ${targetSeat.name}...`;
        sharedEffects.push({
          kind: 'rizz_line',
          fromName: activeSeat.name,
          targetName: targetSeat.name,
          line,
          seatIndex: activeSeat.index,
          targetIndex: targetSeat.index,
        });
        broadcastRoom(room, perSeatEffects);
        return;
      }
    } else if (card.value === 'Rafath Kauwa') {
      const targetSeat =
        aliveOpponents.length > 0
          ? aliveOpponents[Math.floor(Math.random() * aliveOpponents.length)]
          : null;
      if (targetSeat) {
        room.peekState = {
          viewerIndex: activeSeat.index,
          targetIndex: targetSeat.index,
          targetName: targetSeat.name,
          cards: [...targetSeat.hand],
          expiresAt: Date.now() + RAFATH_PEEK_DURATION_MS,
        };
        sharedEffects.push({
          kind: 'crow_feathers',
          whoName: activeSeat.name,
          targetName: targetSeat.name,
          seatIndex: activeSeat.index,
          targetIndex: targetSeat.index,
        });
      }
      room.turnIndex = advanceTurn(room, 1);
      room.turn = room.turnIndex === 0 ? 'host' : 'guest';
      const nextSeat = room.seats[room.turnIndex];
      room.message = targetSeat
        ? `KAAAW! ${activeSeat.name} used Rafath Kauwa to spy on ${targetSeat.name}'s cards (7.5s)! ${nextSeat.name}'s turn.`
        : `KAAAW! ${activeSeat.name} summoned Rafath Kauwa! ${nextSeat.name}'s turn.`;
    } else if (card.value === 'Gooner Surjo') {
      if (room.goonerSurjoUsed) {
        room.turnIndex = advanceTurn(room, 1);
        room.turn = room.turnIndex === 0 ? 'host' : 'guest';
        const nextSeat = room.seats[room.turnIndex];
        room.message = `Gooner Surjo was already used this game! ${nextSeat.name}'s turn.`;
      } else {
        room.goonerSurjoUsed = true;
        const targetSeat =
          aliveOpponents.length > 0
            ? aliveOpponents[Math.floor(Math.random() * aliveOpponents.length)]
            : null;
        if (targetSeat) {
          targetSeat.eliminated = true;
          recycleHandToDeck(room, targetSeat.hand);
          const remaining = getAliveSeats(room);
          if (remaining.length <= 1) {
            const survivor = remaining[0] ?? activeSeat;
            finishRoundWithWinner(
              room,
              survivor,
              `GOONER SURJO! ${targetSeat.name} was eliminated — ${survivor.name} wins!`,
              (seatIdx) => [
                ...perSeatEffects(seatIdx),
                {
                  kind: 'surjo_ko',
                  whoName: activeSeat.name,
                  targetName: targetSeat.name,
                  isSelfLoser: targetSeat.index === seatIdx,
                  seatIndex: activeSeat.index,
                  targetIndex: targetSeat.index,
                },
              ]
            );
            return;
          }
          room.turnIndex = advanceTurn(room, 1);
          room.turn = room.turnIndex === 0 ? 'host' : 'guest';
          const nextSeat = room.seats[room.turnIndex];
          room.message = `GOONER SURJO! ${targetSeat.name} eliminated! ${nextSeat.name}'s turn.`;
          scheduleCpuIfNeeded(room);
          broadcastRoom(room, (seatIdx) => [
            ...perSeatEffects(seatIdx),
            {
              kind: 'surjo_ko',
              whoName: activeSeat.name,
              targetName: targetSeat.name,
              isSelfLoser: targetSeat.index === seatIdx,
              seatIndex: activeSeat.index,
              targetIndex: targetSeat.index,
            },
          ]);
          return;
        }
        room.turnIndex = advanceTurn(room, 1);
        room.turn = room.turnIndex === 0 ? 'host' : 'guest';
        room.message = `Gooner Surjo played!`;
      }
    } else if (card.value === 'Toothpick Alif') {
      const candidates = aliveOpponents.filter((opp) =>
        opp.hand.some((c) => POWER_CARD_VALUES.has(c.value))
      );
      if (candidates.length > 0) {
        const victimSeat = candidates[Math.floor(Math.random() * candidates.length)];
        const powerIndices = victimSeat.hand
          .map((c, i) => (POWER_CARD_VALUES.has(c.value) ? i : -1))
          .filter((i) => i >= 0);
        const stealIdx = powerIndices[Math.floor(Math.random() * powerIndices.length)];
        const [stolenCard] = victimSeat.hand.splice(stealIdx, 1);
        activeSeat.hand.push(stolenCard);

        if (victimSeat.hand.length === 0) {
          const rep = drawWithUniqueSurjoGuard(room, victimSeat.hand);
          if (rep.reshuffled) sharedEffects.push({ kind: 'reshuffle' });
          if (rep.card) sharedEffects.push({ kind: 'seat_draw', seatIndex: victimSeat.index, count: 1 });
        }

        if (handleMercyKnockout(room, activeSeat, perSeatEffects(activeSeat.index))) return;

        room.turnIndex = advanceTurn(room, 1);
        room.turn = room.turnIndex === 0 ? 'host' : 'guest';
        const nextSeat = room.seats[room.turnIndex];
        room.message = `TOOTHPICK ALIF! ${activeSeat.name} stole a power card from ${victimSeat.name}! ${nextSeat.name}'s turn.`;
        scheduleCpuIfNeeded(room);
        broadcastRoom(room, (seatIdx) => [
          ...perSeatEffects(seatIdx),
          {
            kind: 'steal_power',
            thiefName: activeSeat.name,
            victimName: victimSeat.name,
            stolenCard:
              seatIdx === activeSeat.index || seatIdx === victimSeat.index
                ? stolenCard
                : undefined,
            thiefIndex: activeSeat.index,
            victimIndex: victimSeat.index,
          },
        ]);
        return;
      }
      room.turnIndex = advanceTurn(room, 1);
      room.turn = room.turnIndex === 0 ? 'host' : 'guest';
      const nextSeat = room.seats[room.turnIndex];
      sharedEffects.push({
        kind: 'banner',
        text: 'NO POWER CARDS TO STEAL!',
        color: '#eab308',
        size: 0.6,
        dur: 1.0,
      });
      room.message = `Toothpick Alif found no power cards to steal! ${nextSeat.name}'s turn.`;
    } else if (drawAmount > 0) {
      if (isNoMercyRuleset(room.difficulty)) {
        room.pendingDrawStack += drawAmount;
        room.pendingDrawMin = drawAmount;
        room.turnIndex = advanceTurn(room, 1);
        room.turn = room.turnIndex === 0 ? 'host' : 'guest';
        const targetSeat = room.seats[room.turnIndex];
        room.message = penalizedUno
          ? `${activeSeat.name} forgot UNO (+2)! ${targetSeat.name}: stack +${drawAmount}+ or take ${room.pendingDrawStack}!`
          : `${targetSeat.name}: stack a +${drawAmount}+ card or take +${room.pendingDrawStack}!`;
      } else {
        const victimIndex = advanceTurn(room, 1);
        const victimSeat = room.seats[victimIndex];
        let reshuffledAny = false;
        for (let i = 0; i < drawAmount; i++) {
          const res = drawWithUniqueSurjoGuard(room, victimSeat.hand);
          if (res.reshuffled) reshuffledAny = true;
        }
        if (reshuffledAny) sharedEffects.push({ kind: 'reshuffle' });
        sharedEffects.push({ kind: 'seat_draw', seatIndex: victimSeat.index, count: drawAmount });
        room.turnIndex = advanceTurn(room, 2);
        room.turn = room.turnIndex === 0 ? 'host' : 'guest';
        const nextSeat = room.seats[room.turnIndex];
        room.message = penalizedUno
          ? `${activeSeat.name} forgot UNO (+2)! ${victimSeat.name} draws ${drawAmount}. ${nextSeat.name}'s turn.`
          : `${victimSeat.name} draws ${drawAmount}! ${nextSeat.name}'s turn (${chosenColor}).`;
      }
    } else if (card.value === 'Roulette') {
      const victimIndex = advanceTurn(room, 1);
      const victimSeat = room.seats[victimIndex];
      const rRes = drawColorRoulette(room.deck, room.discard, victimSeat.hand, chosenColor);
      if (rRes.reshuffled) sharedEffects.push({ kind: 'reshuffle' });
      sharedEffects.push({
        kind: 'roulette',
        whoName: victimSeat.name,
        color: chosenColor,
        drawnCount: rRes.drawnCount,
        seatIndex: victimSeat.index,
      });
      if (rRes.drawnCount > 0) {
        sharedEffects.push({ kind: 'seat_draw', seatIndex: victimSeat.index, count: rRes.drawnCount });
      }

      if (handleMercyKnockout(room, victimSeat, perSeatEffects(victimSeat.index))) {
        return;
      }

      room.turnIndex = advanceTurn(room, 2);
      room.turn = room.turnIndex === 0 ? 'host' : 'guest';
      const nextSeat = room.seats[room.turnIndex];
      room.message = `${victimSeat.name} drew ${rRes.drawnCount} in Color Roulette! ${nextSeat.name}'s turn.`;
    } else if (card.value === 'Skip All') {
      room.turnIndex = activeSeat.index;
      room.turn = room.turnIndex === 0 ? 'host' : 'guest';
      room.message = penalizedUno
        ? `${activeSeat.name} forgot UNO (+2)! Skip All — ${activeSeat.name} goes again.`
        : `Skip All! ${activeSeat.name} plays again.`;
    } else if (card.value === 'Skip') {
      const skippedSeat = room.seats[advanceTurn(room, 1)];
      room.turnIndex = advanceTurn(room, 2);
      room.turn = room.turnIndex === 0 ? 'host' : 'guest';
      const nextSeat = room.seats[room.turnIndex];
      room.message = penalizedUno
        ? `${activeSeat.name} forgot UNO (+2)! ${skippedSeat.name} skipped — ${nextSeat.name}'s turn.`
        : `${skippedSeat.name} skipped! ${nextSeat.name}'s turn.`;
    } else if (card.value === 'Reverse') {
      if (aliveCount <= 2) {
        room.turnIndex = activeSeat.index;
        room.turn = room.turnIndex === 0 ? 'host' : 'guest';
        room.message = penalizedUno
          ? `${activeSeat.name} forgot UNO (+2)! Reversed back to ${activeSeat.name}.`
          : `Reversed! ${activeSeat.name} plays again.`;
      } else {
        room.direction = room.direction === 1 ? -1 : 1;
        room.turnIndex = advanceTurn(room, 1);
        room.turn = room.turnIndex === 0 ? 'host' : 'guest';
        const nextSeat = room.seats[room.turnIndex];
        room.message = penalizedUno
          ? `${activeSeat.name} forgot UNO (+2)! Direction reversed — ${nextSeat.name}'s turn.`
          : `Direction reversed! ${nextSeat.name}'s turn.`;
      }
    } else {
      room.turnIndex = advanceTurn(room, 1);
      room.turn = room.turnIndex === 0 ? 'host' : 'guest';
      const nextSeat = room.seats[room.turnIndex];
      room.message = penalizedUno
        ? `${activeSeat.name} forgot UNO (+2)! ${nextSeat.name}'s turn (${chosenColor}).`
        : activeSeat.hand.length === 1
          ? `${activeSeat.name} called UNO! ${nextSeat.name}'s turn (${chosenColor}).`
          : `${nextSeat.name}'s turn — color is ${chosenColor}.`;
    }

    scheduleCpuIfNeeded(room);
    broadcastRoom(room, perSeatEffects);
  }

  function executeCpuTurn(room: RoomState, cpuSeat: ServerSeat): void {
    const top = room.discard[room.discard.length - 1];
    const nextAliveIdx = advanceTurn(room, 1);
    const nextAliveCount = room.seats[nextAliveIdx]?.hand.length ?? 7;

    const chosen = chooseCpuCard(
      cpuSeat.hand,
      top,
      room.currentColor,
      room.difficulty,
      room.pendingDrawMin,
      nextAliveCount
    );

    if (room.pendingDrawStack > 0 && !chosen) {
      const stackCount = room.pendingDrawStack;
      const effs: EffectEvent[] = [];
      for (let i = 0; i < stackCount; i++) {
        const res = drawOneFromDeck(room.deck, room.discard, cpuSeat.hand);
        if (res.reshuffled) effs.push({ kind: 'reshuffle' });
      }
      effs.push({ kind: 'seat_draw', seatIndex: cpuSeat.index, count: stackCount });
      room.pendingDrawStack = 0;
      room.pendingDrawMin = 0;
      room.drawnUid = null;

      if (handleMercyKnockout(room, cpuSeat, effs)) return;

      room.turnIndex = advanceTurn(room, 1);
      room.turn = room.turnIndex === 0 ? 'host' : 'guest';
      const nextSeat = room.seats[room.turnIndex];
      room.message = `${cpuSeat.name} took +${stackCount} cards! ${nextSeat.name}'s turn.`;
      scheduleCpuIfNeeded(room);
      broadcastRoom(room, () => effs);
      return;
    }

    if (!chosen) {
      const { card, reshuffled } = drawOneFromDeck(room.deck, room.discard, cpuSeat.hand);
      const effs: EffectEvent[] = reshuffled ? [{ kind: 'reshuffle' }] : [];
      if (card) effs.push({ kind: 'seat_draw', seatIndex: cpuSeat.index, count: 1 });

      if (handleMercyKnockout(room, cpuSeat, effs)) return;

      if (card && canPlayCard(card, top, room.currentColor)) {
        if (cpuSeat.hand.length === 2 && shouldCpuCallUno(room.difficulty)) {
          cpuSeat.unoArmed = true;
        }
        const idx = cpuSeat.hand.findIndex((c) => c.uid === card.uid);
        if (idx !== -1) {
          const nextColor: SuitColor =
            card.color === 'Wild' ? chooseCpuWildColor(cpuSeat.hand, room.difficulty) : card.color;
          commitSeatPlay(room, cpuSeat, idx, nextColor);
          return;
        }
      }

      room.turnIndex = advanceTurn(room, 1);
      room.turn = room.turnIndex === 0 ? 'host' : 'guest';
      const nextSeat = room.seats[room.turnIndex];
      room.message = card
        ? `${cpuSeat.name} drew a card. ${nextSeat.name}'s turn.`
        : `Deck empty — ${nextSeat.name}'s turn.`;
      scheduleCpuIfNeeded(room);
      broadcastRoom(room, () => effs);
      return;
    }

    if (cpuSeat.hand.length === 2 && shouldCpuCallUno(room.difficulty)) {
      cpuSeat.unoArmed = true;
    }
    const idx = cpuSeat.hand.findIndex((c) => c.uid === chosen.uid);
    if (idx === -1) return;
    const nextColor: SuitColor =
      chosen.color === 'Wild' ? chooseCpuWildColor(cpuSeat.hand, room.difficulty) : chosen.color;
    commitSeatPlay(room, cpuSeat, idx, nextColor);
  }

  function startFreshRound(
    room: RoomState,
    nextDifficulty?: DifficultyLevel,
    fillEmptyWithCpu = false,
    keepWaiting = false
  ): void {
    clearCpuTimer(room);
    clearTurnTimer(room);
    clearPendingRizz(room);
    room.peekState = null;
    room.goonerSurjoUsed = false;
    if (nextDifficulty) {
      room.difficulty = nextDifficulty;
    }

    if (fillEmptyWithCpu) {
      let cpuNum = 1;
      for (const seat of room.seats) {
        if (seat.clientId === null && !seat.isCpu) {
          seat.isCpu = true;
          seat.name = `CPU ${cpuNum++}`;
        }
      }
    }

    const dealt = dealRoundMulti(
      room.seats.map((s) => s.name),
      room.difficulty
    );
    room.deck = dealt.deck;
    room.discard = dealt.discard;
    room.currentColor = dealt.currentColor;
    room.drawnUid = null;
    room.pendingDrawStack = 0;
    room.pendingDrawMin = 0;
    room.direction = 1;
    const starterSeat =
      room.seats[room.hostIndex] &&
      (room.seats[room.hostIndex].clientId !== null || room.seats[room.hostIndex].isCpu)
        ? room.seats[room.hostIndex]
        : room.seats.find((s) => s.clientId !== null || s.isCpu) ?? room.seats[0];
    room.turnIndex = starterSeat ? starterSeat.index : 0;
    room.winner = null;
    room.winnerIndex = null;
    room.winnerName = null;
    room.roundId += 1;

    room.seats.forEach((s, idx) => {
      s.hand = dealt.hands[idx] ?? [];
      s.unoArmed = false;
      s.eliminated = false;
    });

    const readyCount = room.seats.filter((s) => s.clientId !== null || s.isCpu).length;
    const hostSeat = room.seats[room.hostIndex] ?? room.seats[0];
    const jasirBoost = dealt.jasirSeatIndexes.length > 0;

    if (!keepWaiting && readyCount >= 2) {
      room.turn = room.turnIndex === 0 ? 'host' : 'guest';
      room.message = jasirBoost
        ? `j4s1r POWER-UP: 7 power cards dealt! ${hostSeat.name}'s turn.`
        : room.difficulty === 'bomboclatt'
          ? `BOMBOCLATT MODE (50-card KO) — ${hostSeat.name}'s turn.`
          : room.difficulty === 'no_mercy'
            ? `NO MERCY active — ${hostSeat.name}'s turn.`
            : `${hostSeat.name}'s turn — match the color or value.`;

      scheduleCpuIfNeeded(room);
      broadcastRoom(room, (seatIdx) => [
        {
          kind: 'deal',
          isJasirBoost: dealt.jasirSeatIndexes.includes(seatIdx),
          isCustomGrant: dealt.customGrantSeatIndexes.includes(seatIdx),
          difficulty: room.difficulty,
        },
        {
          kind: 'banner',
          text: seatIdx === room.turnIndex ? 'YOUR TURN' : `${hostSeat.name.toUpperCase()} STARTS`,
          color: '#f5c84b',
          size: 0.58,
          dur: 1.0,
          delay: 0.7,
        },
      ]);
    } else {
      room.turn = 'waiting';
      room.message =
        readyCount >= room.playerCount
          ? `All ${room.playerCount} players ready! Waiting for ${hostSeat.name} to start.`
          : `Waiting for players (${readyCount}/${room.playerCount} ready) — waiting for ${hostSeat.name} to start.`;
      broadcastRoom(room);
    }
  }

  function performKickSeat(
    room: RoomState,
    targetSeat: ServerSeat,
    reason: 'host' | 'vote'
  ): void {
    const kickedName = targetSeat.name;
    const kickedClientId = targetSeat.clientId;
    const kickedSocketId = targetSeat.socketId;
    if (kickedClientId) {
      room.kickedClientIds.add(kickedClientId);
      for (const voterSet of room.kickVotes.values()) {
        voterSet.delete(kickedClientId);
      }
    }
    room.kickVotes.delete(targetSeat.index);

    targetSeat.clientId = null;
    targetSeat.socketId = null;
    targetSeat.hasConnectedOnce = false;
    targetSeat.isCpu = false;
    targetSeat.name = `Player ${targetSeat.index + 1}`;
    targetSeat.unoArmed = false;
    targetSeat.score = 0;

    const kickText =
      reason === 'vote'
        ? 'You were removed from the room by majority vote.'
        : 'You were removed from the room by the host.';

    if (kickedSocketId) {
      const targetSocket = io.sockets.sockets.get(kickedSocketId);
      if (targetSocket) {
        targetSocket.emit('kicked', {
          roomId: room.roomId,
          message: kickText,
        });
        targetSocket.leave(room.roomId);
        setTimeout(() => {
          targetSocket.disconnect(true);
        }, 80);
      }
    }

    if (targetSeat.index === room.hostIndex) {
      const nextHost = room.seats.find((s) => !s.isCpu && s.clientId !== null);
      room.hostIndex = nextHost ? nextHost.index : 0;
    }

    const bannerText =
      reason === 'vote'
        ? `${kickedName.toUpperCase()} VOTE KICKED`
        : `${kickedName.toUpperCase()} KICKED`;

    if (room.turn === 'waiting') {
      targetSeat.eliminated = false;
      const readyCount = room.seats.filter((s) => s.clientId !== null || s.isCpu).length;
      const hostSeat = room.seats[room.hostIndex] ?? room.seats[0];
      room.message = `${kickedName} was removed (${readyCount}/${room.playerCount} ready) — ${hostSeat.name} can start anytime.`;
      broadcastRoom(room, () => [
        {
          kind: 'banner',
          text: bannerText,
          color: '#f43f5e',
          size: 0.54,
          dur: 1.05,
        },
      ]);
      return;
    }

    if (room.turn === 'over') {
      targetSeat.eliminated = false;
      room.message = `${kickedName} was removed from the room.`;
      broadcastRoom(room, () => [
        {
          kind: 'banner',
          text: bannerText,
          color: '#f43f5e',
          size: 0.54,
          dur: 1.05,
        },
      ]);
      return;
    }

    recycleHandToDeck(room, targetSeat.hand);
    targetSeat.eliminated = true;

    const remainingActive = room.seats.filter(
      (s) => !s.eliminated && (s.clientId !== null || s.isCpu)
    );

    if (remainingActive.length <= 1) {
      startFreshRound(room, undefined, false, true);
      room.message = `${kickedName} was removed. Invite another player to start.`;
      broadcastRoom(room, () => [
        {
          kind: 'banner',
          text: bannerText,
          color: '#f43f5e',
          size: 0.56,
          dur: 1.1,
        },
      ]);
      return;
    }

    if (
      room.pendingRizz &&
      (room.pendingRizz.targetIndex === targetSeat.index ||
        room.pendingRizz.fromIndex === targetSeat.index)
    ) {
      clearPendingRizz(room);
    }

    if (room.turnIndex === targetSeat.index) {
      room.drawnUid = null;
      room.turnIndex = advanceTurn(room, 1);
      room.turn = room.turnIndex === 0 ? 'host' : 'guest';
    }
    const nextSeat = room.seats[room.turnIndex];
    room.message = `${kickedName} was removed (${reason === 'vote' ? 'majority vote' : 'host'}). ${
      nextSeat ? `${nextSeat.name}'s turn.` : ''
    }`.trim();
    scheduleCpuIfNeeded(room);
    broadcastRoom(room, () => [
      {
        kind: 'banner',
        text: bannerText,
        color: '#f43f5e',
        size: 0.54,
        dur: 1.05,
      },
    ]);
  }

  // Clean up abandoned rooms older than 6 hours
  const cleanupTimer = setInterval(() => {
    const cutoff = Date.now() - 6 * 60 * 60 * 1000;
    for (const [id, room] of rooms.entries()) {
      if (room.lastActivityAt < cutoff) {
        clearCpuTimer(room);
        clearTurnTimer(room);
        clearPendingRizz(room);
        rooms.delete(id);
      }
    }
  }, 15 * 60 * 1000);
  cleanupTimer.unref();

  if (options.exposeRootHealth) {
    app.get('/', (_req, res) => {
      res.json({
        service: 'puno-multiplayer-server',
        transport: 'socket.io',
        status: 'ok',
        rooms: rooms.size,
      });
    });
  }

  app.get('/health', (_req, res) => {
    res.json({
      ok: true,
      transport: 'socket.io',
      rooms: rooms.size,
      uptime: Math.round(process.uptime()),
    });
  });

  app.post('/api/rooms', (req, res) => {
    const body =
      req.body && typeof req.body === 'object'
        ? (req.body as {
            hostName?: unknown;
            difficulty?: unknown;
            playerCount?: unknown;
            hostClientId?: unknown;
          })
        : {};
    const room = createRoom(body.hostName, body.difficulty, body.playerCount, body.hostClientId);
    res.status(201).json({
      roomId: room.roomId,
      token: room.token,
      playerCount: room.playerCount,
      difficulty: room.difficulty,
    });
  });

  app.post('/api/rooms/join', (req, res) => {
    const body =
      req.body && typeof req.body === 'object'
        ? (req.body as { roomId?: unknown; clientId?: unknown })
        : {};
    const code = sanitizeRoomCode(body.roomId);
    if (!code) {
      res.status(400).json({ error: 'Enter a valid room code.' });
      return;
    }
    const room = rooms.get(code);
    if (!room) {
      res.status(404).json({ error: 'Room not found or expired. Check the room code.' });
      return;
    }

    const clientId = typeof body.clientId === 'string' ? body.clientId.trim() : '';
    if (clientId && room.kickedClientIds.has(clientId)) {
      res.status(403).json({ error: 'You were removed from this room by the host.' });
      return;
    }
    const existingSeat = clientId ? room.seats.find((s) => s.clientId === clientId) : undefined;
    const hasOpenSeat = room.seats.some((s) => s.clientId === null && !s.isCpu);

    if (!existingSeat && !hasOpenSeat) {
      res.status(409).json({ error: `Room ${room.roomId} is already full.` });
      return;
    }

    res.json({
      roomId: room.roomId,
      token: room.token,
      hostName: room.seats[0]?.name ?? 'Host',
      difficulty: room.difficulty,
      playerCount: room.playerCount,
    });
  });

  app.get('/api/rooms/:roomId', (req, res) => {
    const room = rooms.get(sanitizeRoomCode(req.params.roomId));
    if (!room) {
      res.status(404).json({ error: 'Room not found or expired.' });
      return;
    }
    const token = typeof req.query.token === 'string' ? req.query.token.trim() : '';
    if (!token || token !== room.token) {
      res.status(403).json({ error: 'Invalid invite token.' });
      return;
    }
    const clientId = typeof req.query.clientId === 'string' ? req.query.clientId.trim() : '';
    if (clientId && room.kickedClientIds.has(clientId)) {
      res.status(403).json({ error: 'You were removed from this room by the host.' });
      return;
    }
    const existingSeat = clientId ? room.seats.find((s) => s.clientId === clientId) : undefined;
    const hasOpenSeat = room.seats.some((s) => s.clientId === null && !s.isCpu);
    if (!existingSeat && !hasOpenSeat) {
      res.status(409).json({ error: `Room ${room.roomId} is already full.` });
      return;
    }
    const joinedCount = room.seats.filter((s) => s.clientId !== null).length;
    res.json({
      roomId: room.roomId,
      token: room.token,
      hostName: room.seats[0]?.name ?? 'Host',
      difficulty: room.difficulty,
      playerCount: room.playerCount,
      joinedCount,
      guestJoined: joinedCount >= 2,
    });
  });

  io.on('connection', (socket) => {
    let boundRoomId: string | null = null;
    let boundClientId: string | null = null;

    const getBoundContext = (): { room: RoomState; activeSeat: ServerSeat } | null => {
      if (boundRoomId === null || !boundClientId) {
        sendError(socket, 'Join a room first.');
        return null;
      }
      const room = rooms.get(boundRoomId);
      if (!room) {
        sendError(socket, 'Room closed.');
        return null;
      }
      const activeSeat = room.seats.find((s) => s.clientId === boundClientId);
      if (!activeSeat) {
        sendError(socket, 'You are no longer seated in this room.');
        return null;
      }
      return { room, activeSeat };
    };

    const bindSocketToRoom = (
      payload: JoinRoomPayload,
      ack?: (res: { ok: boolean; roomId?: string; seatIndex?: number; error?: string }) => void
    ) => {
      const room = rooms.get(sanitizeRoomCode(payload?.roomId));
      if (!room) {
        const msg = 'This game room does not exist or has expired.';
        sendError(socket, msg);
        ack?.({ ok: false, error: msg });
        return;
      }
      const cleanToken = typeof payload?.token === 'string' ? payload.token.trim() : '';
      if (!cleanToken || cleanToken !== room.token) {
        const msg = 'Invalid game invite token.';
        sendError(socket, msg);
        ack?.({ ok: false, error: msg });
        return;
      }
      const clientId = typeof payload.clientId === 'string' ? payload.clientId.trim() : '';
      if (!clientId || clientId.length > 100) {
        const msg = 'Invalid player session.';
        sendError(socket, msg);
        ack?.({ ok: false, error: msg });
        return;
      }
      if (room.kickedClientIds.has(clientId)) {
        const msg = 'You were removed from this room by the host.';
        sendError(socket, msg);
        ack?.({ ok: false, error: msg });
        return;
      }

      let targetSeat = room.seats.find((s) => s.clientId === clientId) ?? null;
      let isFirstSeatJoin = false;
      let isReconnect = false;

      if (targetSeat) {
        isFirstSeatJoin = !targetSeat.hasConnectedOnce;
        isReconnect =
          targetSeat.hasConnectedOnce &&
          (targetSeat.socketId === null || targetSeat.socketId !== socket.id);
        if (targetSeat.socketId && targetSeat.socketId !== socket.id) {
          const prevSocket = io.sockets.sockets.get(targetSeat.socketId);
          if (prevSocket) {
            prevSocket.leave(room.roomId);
            prevSocket.disconnect(true);
          }
        }
        targetSeat.socketId = socket.id;
        targetSeat.hasConnectedOnce = true;
        targetSeat.isCpu = false;
        targetSeat.name = sanitizeName(
          payload.name,
          targetSeat.index === 0 ? 'Host' : `Player ${targetSeat.index + 1}`
        );
      } else {
        const openSeat = room.seats.find((s) => s.clientId === null && !s.isCpu) ?? null;
        if (!openSeat) {
          const msg = `This ${room.playerCount}-player room is already full.`;
          sendError(socket, msg);
          ack?.({ ok: false, error: msg });
          return;
        }
        isFirstSeatJoin = true;
        openSeat.clientId = clientId;
        openSeat.socketId = socket.id;
        openSeat.hasConnectedOnce = true;
        openSeat.isCpu = false;
        openSeat.name = sanitizeName(
          payload.name,
          openSeat.index === 0 ? 'Host' : `Player ${openSeat.index + 1}`
        );
        targetSeat = openSeat;
      }

      boundRoomId = room.roomId;
      boundClientId = clientId;
      void socket.join(room.roomId);
      ack?.({ ok: true, roomId: room.roomId, seatIndex: targetSeat.index });

      const joinedCount = room.seats.filter((s) => s.clientId !== null || s.isCpu).length;
      if (room.turn === 'waiting') {
        const hostSeat = room.seats[room.hostIndex] ?? room.seats[0];
        if (joinedCount >= room.playerCount) {
          room.message = `All ${room.playerCount} players joined! Waiting for ${hostSeat.name} to start.`;
        } else {
          room.message =
            room.playerCount === 2
              ? `Share room code ${room.roomId} or the QR invite link.`
              : `${targetSeat.name} joined (${joinedCount}/${room.playerCount} ready) — waiting for ${hostSeat.name} to start.`;
        }
        broadcastRoom(room, (seatIdx) => {
          if (isFirstSeatJoin && seatIdx !== targetSeat.index) {
            return [
              {
                kind: 'banner',
                text: `${targetSeat.name.toUpperCase()} JOINED`,
                color: '#f5c84b',
                size: 0.5,
                dur: 0.9,
              },
            ];
          }
          return [];
        });
      } else {
        if (isReconnect && !isFirstSeatJoin) {
          const currentTurnSeat = room.seats[room.turnIndex];
          if (room.winnerIndex === null && currentTurnSeat) {
            room.message = `${targetSeat.name} reconnected! ${currentTurnSeat.name}'s turn.`;
          }
        }
        broadcastRoom(room, (seatIdx) => {
          if (isFirstSeatJoin && seatIdx !== targetSeat.index) {
            return [
              {
                kind: 'banner',
                text: `${targetSeat.name.toUpperCase()} JOINED`,
                color: '#f5c84b',
                size: 0.52,
                dur: 1.0,
              },
            ];
          }
          if (isReconnect && !isFirstSeatJoin && seatIdx !== targetSeat.index) {
            return [
              {
                kind: 'banner',
                text: `${targetSeat.name.toUpperCase()} BACK`,
                color: '#34d399',
                size: 0.48,
                dur: 0.9,
              },
            ];
          }
          return [];
        });
      }
    };

    // Optional Socket.IO acknowledgment helpers for creating or joining rooms directly over Socket.IO
    socket.on(
      'create_room',
      (
        data: { hostName?: unknown; difficulty?: unknown; playerCount?: unknown },
        ack?: (res: { ok: boolean; roomId?: string; token?: string; playerCount?: number }) => void
      ) => {
        const room = createRoom(data?.hostName, data?.difficulty, data?.playerCount);
        ack?.({
          ok: true,
          roomId: room.roomId,
          token: room.token,
          playerCount: room.playerCount,
        });
      }
    );

    socket.on(
      'join_room',
      (
        data: { roomId?: unknown; clientId?: unknown },
        ack?: (res: {
          ok: boolean;
          roomId?: string;
          token?: string;
          playerCount?: number;
          error?: string;
        }) => void
      ) => {
        const code = sanitizeRoomCode(data?.roomId);
        const room = code ? rooms.get(code) : undefined;
        if (!room) {
          ack?.({ ok: false, error: 'Room not found or expired. Check the room code.' });
          return;
        }
        const clientId = typeof data?.clientId === 'string' ? data.clientId.trim() : '';
        if (clientId && room.kickedClientIds.has(clientId)) {
          ack?.({ ok: false, error: 'You were removed from this room by the host.' });
          return;
        }
        const existingSeat = clientId ? room.seats.find((s) => s.clientId === clientId) : undefined;
        const hasOpenSeat = room.seats.some((s) => s.clientId === null && !s.isCpu);
        if (!existingSeat && !hasOpenSeat) {
          ack?.({ ok: false, error: `Room ${room.roomId} is already full.` });
          return;
        }
        ack?.({
          ok: true,
          roomId: room.roomId,
          token: room.token,
          playerCount: room.playerCount,
        });
      }
    );

    socket.on(
      'join',
      (
        payload: JoinRoomPayload,
        ack?: (res: { ok: boolean; roomId?: string; seatIndex?: number; error?: string }) => void
      ) => {
        bindSocketToRoom(payload, ack);
      }
    );

    socket.on('rename', (payload: RenamePayload) => {
      const ctx = getBoundContext();
      if (!ctx) return;
      ctx.activeSeat.name = sanitizeName(
        payload?.name,
        ctx.activeSeat.index === 0 ? 'Host' : `Player ${ctx.activeSeat.index + 1}`
      );
      broadcastRoom(ctx.room);
    });

    socket.on(
      'kick_player',
      (
        payload: KickPlayerPayload,
        ack?: (res: { ok: boolean; error?: string }) => void
      ) => {
        const ctx = getBoundContext();
        if (!ctx) {
          ack?.({ ok: false, error: 'Join a room first.' });
          return;
        }
        const { room, activeSeat } = ctx;
        if (activeSeat.index !== room.hostIndex) {
          const msg = 'Only the host can kick players directly. Use Vote Kick instead.';
          sendError(socket, msg);
          ack?.({ ok: false, error: msg });
          return;
        }
        const seatIndex = typeof payload?.seatIndex === 'number' ? payload.seatIndex : -1;
        if (
          !Number.isInteger(seatIndex) ||
          seatIndex < 0 ||
          seatIndex >= room.seats.length ||
          seatIndex === room.hostIndex
        ) {
          const msg = 'Select a valid player seat to kick.';
          sendError(socket, msg);
          ack?.({ ok: false, error: msg });
          return;
        }
        const targetSeat = room.seats[seatIndex];
        if (!targetSeat || targetSeat.isCpu || targetSeat.clientId === null) {
          const msg = 'That seat has no human player to kick.';
          sendError(socket, msg);
          ack?.({ ok: false, error: msg });
          return;
        }

        ack?.({ ok: true });
        performKickSeat(room, targetSeat, 'host');
      }
    );

    socket.on(
      'vote_kick',
      (
        payload: KickPlayerPayload,
        ack?: (res: {
          ok: boolean;
          kicked?: boolean;
          votes?: number;
          required?: number;
          error?: string;
        }) => void
      ) => {
        const ctx = getBoundContext();
        if (!ctx) {
          ack?.({ ok: false, error: 'Join a room first.' });
          return;
        }
        const { room, activeSeat } = ctx;
        const voterClientId = activeSeat.clientId;
        if (!voterClientId || activeSeat.isCpu) {
          ack?.({ ok: false, error: 'Only seated players can vote to kick.' });
          return;
        }
        const seatIndex = typeof payload?.seatIndex === 'number' ? payload.seatIndex : -1;
        if (
          !Number.isInteger(seatIndex) ||
          seatIndex < 0 ||
          seatIndex >= room.seats.length ||
          seatIndex === activeSeat.index
        ) {
          const msg = 'Select another player seat to vote against.';
          sendError(socket, msg);
          ack?.({ ok: false, error: msg });
          return;
        }
        const targetSeat = room.seats[seatIndex];
        if (!targetSeat || targetSeat.isCpu || targetSeat.clientId === null) {
          const msg = 'That seat has no human player.';
          sendError(socket, msg);
          ack?.({ ok: false, error: msg });
          return;
        }

        const humanSeats = room.seats.filter((s) => !s.isCpu && s.clientId !== null);
        if (humanSeats.length < 3) {
          const msg = 'Majority vote kick requires at least 3 human players.';
          sendError(socket, msg);
          ack?.({ ok: false, error: msg });
          return;
        }

        const requiredVotes = Math.floor(humanSeats.length / 2) + 1;
        let voters = room.kickVotes.get(seatIndex);
        if (!voters) {
          voters = new Set<string>();
          room.kickVotes.set(seatIndex, voters);
        }

        let addedVote = false;
        if (voters.has(voterClientId)) {
          voters.delete(voterClientId);
        } else {
          voters.add(voterClientId);
          addedVote = true;
        }

        if (voters.size >= requiredVotes) {
          ack?.({ ok: true, kicked: true, votes: voters.size, required: requiredVotes });
          performKickSeat(room, targetSeat, 'vote');
          return;
        }

        ack?.({ ok: true, kicked: false, votes: voters.size, required: requiredVotes });
        room.message = addedVote
          ? `${activeSeat.name} voted to kick ${targetSeat.name} (${voters.size}/${requiredVotes}).`
          : `${activeSeat.name} withdrew kick vote on ${targetSeat.name} (${voters.size}/${requiredVotes}).`;
        broadcastRoom(room, () =>
          addedVote
            ? [
                {
                  kind: 'banner',
                  text: `KICK VOTE ${voters.size}/${requiredVotes}`,
                  color: '#fb923c',
                  size: 0.48,
                  dur: 0.9,
                },
              ]
            : []
        );
      }
    );

    socket.on(
      'start_now',
      (
        payload?: StartGamePayload,
        ack?: (res: { ok: boolean; error?: string }) => void
      ) => {
        const ctx = getBoundContext();
        if (!ctx) {
          ack?.({ ok: false, error: 'Join a room first.' });
          return;
        }
        const { room, activeSeat } = ctx;
        if (activeSeat.index !== room.hostIndex) {
          const msg = 'Only the host can start the match.';
          sendError(socket, msg);
          ack?.({ ok: false, error: msg });
          return;
        }
        if (room.turn !== 'waiting') {
          ack?.({ ok: false, error: 'The match has already started.' });
          return;
        }

        const fillCpus = Boolean(payload?.fillCpus);
        const readyCount = room.seats.filter((s) => s.clientId !== null || s.isCpu).length;
        if (!fillCpus && readyCount < 2) {
          const msg = 'Wait for at least 1 other player to join, or start with CPUs.';
          sendError(socket, msg);
          ack?.({ ok: false, error: msg });
          return;
        }

        if (!fillCpus && readyCount < room.playerCount) {
          const activeHostClientId = room.seats[room.hostIndex]?.clientId ?? null;
          room.seats = room.seats.filter((s) => s.clientId !== null || s.isCpu);
          room.seats.forEach((s, idx) => {
            s.index = idx;
          });
          room.playerCount = room.seats.length;
          const nextHostIdx = activeHostClientId
            ? room.seats.findIndex((s) => s.clientId === activeHostClientId)
            : 0;
          room.hostIndex = nextHostIdx >= 0 ? nextHostIdx : 0;
          room.kickVotes.clear();
        }

        ack?.({ ok: true });
        startFreshRound(room, undefined, fillCpus, false);
      }
    );

    socket.on('restart', (payload?: RestartPayload) => {
      const ctx = getBoundContext();
      if (!ctx) return;
      const nextDiff = isDifficultyLevel(payload?.difficulty) ? payload.difficulty : undefined;
      const keepWaiting = ctx.room.turn === 'waiting';
      startFreshRound(ctx.room, nextDiff, false, keepWaiting);
    });

    socket.on('rizz_response', (payload: RizzResponsePayload) => {
      const ctx = getBoundContext();
      if (!ctx) return;
      const { room, activeSeat } = ctx;
      if (!room.pendingRizz) return;
      if (room.pendingRizz.targetIndex !== activeSeat.index) {
        sendError(socket, 'This Rizzler Arvin prompt is for another player.');
        return;
      }
      if (!payload?.promptId || payload.promptId !== room.pendingRizz.promptId) return;
      const chosenUid = typeof payload.cardUid === 'number' ? payload.cardUid : undefined;
      resolveRizzPrompt(room, payload.promptId, Boolean(payload.accept), chosenUid);
    });

    socket.on('call_uno', () => {
      const ctx = getBoundContext();
      if (!ctx) return;
      const { room, activeSeat } = ctx;
      if (room.pendingRizz) {
        sendError(socket, 'Waiting for Rizzler Arvin response.');
        return;
      }
      if (room.winnerIndex !== null || room.turn === 'waiting' || room.turn === 'over') return;
      if (room.turnIndex !== activeSeat.index || activeSeat.eliminated) {
        sendError(socket, 'Wait for your turn.');
        return;
      }
      if (activeSeat.hand.length < 2 || activeSeat.unoArmed) return;
      activeSeat.unoArmed = true;
      room.message = `${activeSeat.name} called UNO! Play your card.`;
      broadcastRoom(room, (seatIdx) => [
        {
          kind: 'uno',
          whoName: activeSeat.name,
          isSelf: seatIdx === activeSeat.index,
          seatIndex: activeSeat.index,
        },
      ]);
    });

    socket.on('draw', () => {
      const ctx = getBoundContext();
      if (!ctx) return;
      const { room, activeSeat } = ctx;
      if (room.pendingRizz) {
        sendError(socket, 'Waiting for Rizzler Arvin response.');
        return;
      }
      if (room.winnerIndex !== null || room.turn === 'waiting' || room.turn === 'over') return;
      if (room.turnIndex !== activeSeat.index || activeSeat.eliminated) {
        sendError(socket, 'Wait for your turn.');
        return;
      }

      activeSeat.unoArmed = false;

      if (room.pendingDrawStack > 0) {
        const stackCount = room.pendingDrawStack;
        const effs: EffectEvent[] = [];
        for (let i = 0; i < stackCount; i++) {
          const res = drawWithUniqueSurjoGuard(room, activeSeat.hand);
          if (res.reshuffled) effs.push({ kind: 'reshuffle' });
        }
        effs.push({ kind: 'seat_draw', seatIndex: activeSeat.index, count: stackCount });
        room.pendingDrawStack = 0;
        room.pendingDrawMin = 0;
        room.drawnUid = null;

        if (handleMercyKnockout(room, activeSeat, effs)) return;

        room.turnIndex = advanceTurn(room, 1);
        room.turn = room.turnIndex === 0 ? 'host' : 'guest';
        const nextSeat = room.seats[room.turnIndex];
        room.message = `${activeSeat.name} drew ${stackCount} cards! ${nextSeat.name}'s turn.`;
        scheduleCpuIfNeeded(room);
        broadcastRoom(room, () => effs);
        return;
      }

      if (room.drawnUid !== null) {
        sendError(socket, 'You already drew a card this turn — play it or pass.');
        return;
      }

      const { card, reshuffled } = drawWithUniqueSurjoGuard(room, activeSeat.hand);
      const effects: EffectEvent[] = reshuffled ? [{ kind: 'reshuffle' }] : [];
      if (card) {
        effects.push({ kind: 'seat_draw', seatIndex: activeSeat.index, count: 1 });
      }

      if (handleMercyKnockout(room, activeSeat, effects)) return;

      if (!card) {
        room.turnIndex = advanceTurn(room, 1);
        room.turn = room.turnIndex === 0 ? 'host' : 'guest';
        room.drawnUid = null;
        const nextSeat = room.seats[room.turnIndex];
        room.message = `Deck empty — turn passes to ${nextSeat.name}.`;
        scheduleCpuIfNeeded(room);
        broadcastRoom(room, () => effects);
        return;
      }

      const top = room.discard[room.discard.length - 1];
      room.drawnUid = card.uid;
      room.message = canPlayCard(card, top, room.currentColor)
        ? `${activeSeat.name} drew a playable card — play it or pass.`
        : `${activeSeat.name} drew a card with no match — pass turn.`;
      scheduleCpuIfNeeded(room);
      broadcastRoom(room, () => effects);
    });

    socket.on('pass', () => {
      const ctx = getBoundContext();
      if (!ctx) return;
      const { room, activeSeat } = ctx;
      if (room.pendingRizz) {
        sendError(socket, 'Waiting for Rizzler Arvin response.');
        return;
      }
      if (room.winnerIndex !== null || room.turn === 'waiting' || room.turn === 'over') return;
      if (room.turnIndex !== activeSeat.index || activeSeat.eliminated) {
        sendError(socket, 'Wait for your turn.');
        return;
      }
      if (room.drawnUid === null || room.pendingDrawStack > 0) return;

      room.drawnUid = null;
      activeSeat.unoArmed = false;
      room.turnIndex = advanceTurn(room, 1);
      room.turn = room.turnIndex === 0 ? 'host' : 'guest';
      const nextSeat = room.seats[room.turnIndex];
      room.message = `${nextSeat.name}'s turn — color is ${room.currentColor}.`;
      scheduleCpuIfNeeded(room);
      broadcastRoom(room);
    });

    socket.on('play', (payload: PlayCardPayload) => {
      const ctx = getBoundContext();
      if (!ctx) return;
      const { room, activeSeat } = ctx;
      if (room.pendingRizz) {
        sendError(socket, 'Waiting for Rizzler Arvin response.');
        return;
      }
      if (room.winnerIndex !== null || room.turn === 'waiting' || room.turn === 'over') return;
      if (room.turnIndex !== activeSeat.index || activeSeat.eliminated) {
        sendError(socket, 'Wait for your turn.');
        return;
      }

      const cardIndex = activeSeat.hand.findIndex((c) => c.uid === payload?.uid);
      if (cardIndex === -1) {
        sendError(socket, 'Card not in hand.');
        return;
      }
      const card = activeSeat.hand[cardIndex];
      if (room.drawnUid !== null && card.uid !== room.drawnUid) {
        sendError(socket, 'Play the card you just drew, or pass.');
        return;
      }
      const top = room.discard[room.discard.length - 1];
      if (!canPlayCard(card, top, room.currentColor, room.pendingDrawMin)) {
        sendError(
          socket,
          room.pendingDrawMin > 0
            ? `Stack a +${room.pendingDrawMin} or higher card, or take +${room.pendingDrawStack}!`
            : 'That card does not match the active color or value.'
        );
        return;
      }
      let nextColor: SuitColor;
      if (card.color === 'Wild') {
        if (!isSuitColor(payload?.chosenColor)) {
          sendError(socket, 'Choose a valid color for the Wild card.');
          return;
        }
        nextColor = payload.chosenColor;
      } else {
        nextColor = card.color;
      }

      commitSeatPlay(room, activeSeat, cardIndex, nextColor);
    });

    socket.on('disconnect', () => {
      if (!boundRoomId) return;
      const room = rooms.get(boundRoomId);
      if (!room) return;
      const seat = room.seats.find(
        (s) => s.socketId === socket.id || (boundClientId !== null && s.clientId === boundClientId && s.socketId === socket.id)
      );
      if (seat) {
        seat.socketId = null;
        if (room.turn === 'host' || room.turn === 'guest') {
          room.message = `${seat.name} disconnected — waiting to reconnect...`;
        }
        broadcastRoom(room);
      }
    });
  });

  return io;
}
