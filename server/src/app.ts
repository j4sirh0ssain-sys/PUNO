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
  getNextAliveSeatIndex,
  isDifficultyLevel,
  isSuitColor,
  shouldCpuCallUno,
} from './game/engine.ts';
import {
  MERCY_HAND_LIMIT,
  type Card,
  type ClientGameView,
  type DifficultyLevel,
  type EffectEvent,
  type JoinRoomPayload,
  type PlayCardPayload,
  type PlayerRole,
  type RenamePayload,
  type RestartPayload,
  type SeatInfo,
  type ServerStatePayload,
  type SuitColor,
  type TurnPhase,
} from './game/types.ts';

const ROOM_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const DEFAULT_GITHUB_PAGES_ORIGIN = 'https://j4sirh0ssain-sys.github.io';

interface ServerSeat {
  index: number;
  clientId: string | null;
  name: string;
  socketId: string | null;
  isCpu: boolean;
  hand: Card[];
  unoArmed: boolean;
  eliminated: boolean;
  score: number;
}

interface RoomState {
  roomId: string;
  token: string;
  difficulty: DifficultyLevel;
  playerCount: number;
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
  cpuTimer: NodeJS.Timeout | null;
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
  options: { exposeRootHealth?: boolean } = {}
): SocketIOServer {
  const rooms = new Map<string, RoomState>();
  const allowedOrigins = buildAllowedOrigins();

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
    transports: ['websocket', 'polling'],
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
    playerCountRaw?: unknown
  ): RoomState {
    const roomId = generateRoomCode();
    const token = crypto.randomBytes(16).toString('base64url');
    const hostName = sanitizeName(hostNameRaw, 'Host');
    const difficulty: DifficultyLevel = isDifficultyLevel(difficultyRaw) ? difficultyRaw : 'normal';
    const playerCount = clampPlayerCount(playerCountRaw);

    const seatNames = Array.from({ length: playerCount }, (_, idx) =>
      idx === 0 ? hostName : `Player ${idx + 1}`
    );
    const dealt = dealRoundMulti(seatNames, difficulty);

    const seats: ServerSeat[] = seatNames.map((name, idx) => ({
      index: idx,
      clientId: null,
      name,
      socketId: null,
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
      cpuTimer: null,
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

    const seatInfos: SeatInfo[] = room.seats.map((s) => ({
      index: s.index,
      name: s.name,
      isCpu: s.isCpu,
      connected: getSeatConnected(s),
      cardCount: s.hand.length,
      unoArmed: s.unoArmed,
      eliminated: s.eliminated,
      score: s.score,
    }));

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

  function recycleHandToDeck(room: RoomState, hand: Card[]): void {
    if (hand.length === 0) return;
    room.deck.unshift(...hand.splice(0, hand.length));
  }

  function scheduleCpuIfNeeded(room: RoomState): void {
    clearCpuTimer(room);
    if (room.winnerIndex !== null || (room.turn !== 'host' && room.turn !== 'guest')) return;
    const activeSeat = room.seats[room.turnIndex];
    if (!activeSeat || !activeSeat.isCpu || activeSeat.eliminated) return;

    const expectedRound = room.roundId;
    const expectedSeatIndex = activeSeat.index;
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
  }

  function finishRoundWithWinner(
    room: RoomState,
    winnerSeat: ServerSeat,
    message: string,
    extraEffectsForSeat?: (seatIdx: number) => EffectEvent[]
  ): void {
    clearCpuTimer(room);
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
    if (room.difficulty !== 'no_mercy' || loserSeat.hand.length < MERCY_HAND_LIMIT) {
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
        `MERCY KO! ${loserSeat.name} hit 25+ cards — ${survivor.name} wins!`,
        (seatIdx) => [
          ...baseEffects,
          { kind: 'mercy_ko', loserName: loserSeat.name, isSelfLoser: loserSeat.index === seatIdx },
        ]
      );
      return true;
    }

    if (room.turnIndex === loserSeat.index) {
      room.turnIndex = advanceTurn(room, 1);
    }
    room.turn = room.turnIndex === 0 ? 'host' : 'guest';
    const nextSeat = room.seats[room.turnIndex];
    room.message = `MERCY KO! ${loserSeat.name} eliminated! ${nextSeat.name}'s turn.`;
    broadcastRoom(room, (seatIdx) => [
      ...baseEffects,
      { kind: 'mercy_ko', loserName: loserSeat.name, isSelfLoser: loserSeat.index === seatIdx },
    ]);
    scheduleCpuIfNeeded(room);
    return true;
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
      });
    }

    room.discard.push(card);
    room.currentColor = chosenColor;
    room.drawnUid = null;
    sharedEffects.push({ kind: 'impact', card, activeColor: chosenColor });

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
          const res = drawOneFromDeck(room.deck, room.discard, activeSeat.hand);
          if (res.reshuffled) sharedEffects.push({ kind: 'reshuffle' });
        }
      }
    }

    const perSeatEffects = (seatIdx: number): EffectEvent[] => {
      const list = [...sharedEffects];
      if (unoTrigger === 'armed') {
        list.push({ kind: 'uno', whoName: activeSeat.name, isSelf: activeSeat.index === seatIdx });
      } else if (unoTrigger === 'penalty') {
        list.push({
          kind: 'uno_penalty',
          whoName: activeSeat.name,
          isSelf: activeSeat.index === seatIdx,
        });
      }
      return list;
    };

    const aliveCount = getAliveSeats(room).length;
    const drawAmount = getDrawAmount(card);

    if (drawAmount > 0) {
      if (room.difficulty === 'no_mercy') {
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
          const res = drawOneFromDeck(room.deck, room.discard, victimSeat.hand);
          if (res.reshuffled) reshuffledAny = true;
        }
        if (reshuffledAny) sharedEffects.push({ kind: 'reshuffle' });
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
      });

      if (room.difficulty === 'no_mercy' && victimSeat.hand.length >= MERCY_HAND_LIMIT) {
        if (handleMercyKnockout(room, victimSeat, perSeatEffects(victimSeat.index))) {
          return;
        }
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

    broadcastRoom(room, perSeatEffects);
    scheduleCpuIfNeeded(room);
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
      room.pendingDrawStack = 0;
      room.pendingDrawMin = 0;
      room.drawnUid = null;

      if (handleMercyKnockout(room, cpuSeat, effs)) return;

      room.turnIndex = advanceTurn(room, 1);
      room.turn = room.turnIndex === 0 ? 'host' : 'guest';
      const nextSeat = room.seats[room.turnIndex];
      room.message = `${cpuSeat.name} took +${stackCount} cards! ${nextSeat.name}'s turn.`;
      broadcastRoom(room, () => effs);
      scheduleCpuIfNeeded(room);
      return;
    }

    if (!chosen) {
      const { card, reshuffled } = drawOneFromDeck(room.deck, room.discard, cpuSeat.hand);
      const effs: EffectEvent[] = reshuffled ? [{ kind: 'reshuffle' }] : [];

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
      broadcastRoom(room, () => effs);
      scheduleCpuIfNeeded(room);
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
    fillEmptyWithCpu = false
  ): void {
    clearCpuTimer(room);
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
    room.turnIndex = 0;
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
    const hostSeat = room.seats[0];
    const jasirBoost = dealt.jasirSeatIndexes.length > 0;

    if (readyCount >= 2) {
      room.turn = 'host';
      room.message = jasirBoost
        ? `j4s1r POWER-UP: 7 power cards dealt! ${hostSeat.name}'s turn.`
        : room.difficulty === 'no_mercy'
          ? `NO MERCY active — ${hostSeat.name}'s turn.`
          : `${hostSeat.name}'s turn — match the color or value.`;

      broadcastRoom(room, (seatIdx) => [
        {
          kind: 'deal',
          isJasirBoost: dealt.jasirSeatIndexes.includes(seatIdx),
          difficulty: room.difficulty,
        },
        {
          kind: 'banner',
          text: seatIdx === 0 ? 'YOUR TURN' : `${hostSeat.name.toUpperCase()} STARTS`,
          color: '#f5c84b',
          size: 0.58,
          dur: 1.0,
          delay: 0.7,
        },
      ]);
      scheduleCpuIfNeeded(room);
    } else {
      room.turn = 'waiting';
      room.message =
        room.playerCount === 2
          ? `Share room code ${room.roomId} or the QR invite link.`
          : `Waiting for players (${readyCount}/${room.playerCount} ready) — code ${room.roomId}.`;
      broadcastRoom(room);
    }
  }

  // Clean up abandoned rooms older than 6 hours
  const cleanupTimer = setInterval(() => {
    const cutoff = Date.now() - 6 * 60 * 60 * 1000;
    for (const [id, room] of rooms.entries()) {
      if (room.lastActivityAt < cutoff) {
        clearCpuTimer(room);
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
        ? (req.body as { hostName?: unknown; difficulty?: unknown; playerCount?: unknown })
        : {};
    const room = createRoom(body.hostName, body.difficulty, body.playerCount);
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
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    if (!token || token !== room.token) {
      res.status(403).json({ error: 'Invalid invite token.' });
      return;
    }
    const joinedCount = room.seats.filter((s) => s.clientId !== null).length;
    res.json({
      roomId: room.roomId,
      hostName: room.seats[0]?.name ?? 'Host',
      difficulty: room.difficulty,
      playerCount: room.playerCount,
      joinedCount,
      guestJoined: joinedCount >= 2,
    });
  });

  io.on('connection', (socket) => {
    let boundRoomId: string | null = null;
    let boundSeatIndex: number | null = null;
    let boundClientId: string | null = null;

    const getBoundContext = (): { room: RoomState; activeSeat: ServerSeat } | null => {
      if (boundRoomId === null || boundSeatIndex === null || !boundClientId) {
        sendError(socket, 'Join a room first.');
        return null;
      }
      const room = rooms.get(boundRoomId);
      if (!room) {
        sendError(socket, 'Room closed.');
        return null;
      }
      const activeSeat = room.seats[boundSeatIndex];
      if (!activeSeat) return null;
      return { room, activeSeat };
    };

    const bindSocketToRoom = (payload: JoinRoomPayload) => {
      const room = rooms.get(sanitizeRoomCode(payload?.roomId));
      if (!room) {
        sendError(socket, 'This game room does not exist or has expired.');
        return;
      }
      if (typeof payload?.token !== 'string' || payload.token !== room.token) {
        sendError(socket, 'Invalid game invite token.');
        return;
      }
      const clientId = typeof payload.clientId === 'string' ? payload.clientId.trim() : '';
      if (!clientId || clientId.length > 100) {
        sendError(socket, 'Invalid player session.');
        return;
      }

      let targetSeat = room.seats.find((s) => s.clientId === clientId) ?? null;
      let isFirstSeatJoin = false;
      let isReconnect = false;

      if (targetSeat) {
        isReconnect = targetSeat.socketId === null || targetSeat.socketId !== socket.id;
        if (targetSeat.socketId && targetSeat.socketId !== socket.id) {
          const prevSocket = io.sockets.sockets.get(targetSeat.socketId);
          if (prevSocket) {
            prevSocket.leave(room.roomId);
            prevSocket.disconnect(true);
          }
        }
        targetSeat.socketId = socket.id;
        targetSeat.isCpu = false;
        targetSeat.name = sanitizeName(
          payload.name,
          targetSeat.index === 0 ? 'Host' : `Player ${targetSeat.index + 1}`
        );
      } else {
        const openSeat = room.seats.find((s) => s.clientId === null && !s.isCpu) ?? null;
        if (!openSeat) {
          sendError(socket, `This ${room.playerCount}-player room is already full.`);
          return;
        }
        isFirstSeatJoin = true;
        openSeat.clientId = clientId;
        openSeat.socketId = socket.id;
        openSeat.isCpu = false;
        openSeat.name = sanitizeName(
          payload.name,
          openSeat.index === 0 ? 'Host' : `Player ${openSeat.index + 1}`
        );
        targetSeat = openSeat;
      }

      boundRoomId = room.roomId;
      boundSeatIndex = targetSeat.index;
      boundClientId = clientId;
      void socket.join(room.roomId);

      const joinedCount = room.seats.filter((s) => s.clientId !== null || s.isCpu).length;
      if (room.turn === 'waiting') {
        if (joinedCount >= room.playerCount) {
          room.turn = 'host';
          room.turnIndex = 0;
          const hostSeat = room.seats[0];
          room.message = `All ${room.playerCount} players joined! ${hostSeat.name}'s turn.`;
          const joinerName = targetSeat.name;
          broadcastRoom(room, (seatIdx) => [
            seatIdx === 0
              ? {
                  kind: 'banner',
                  text: `${joinerName.toUpperCase()} JOINED`,
                  color: '#f5c84b',
                  size: 0.6,
                  dur: 1.1,
                }
              : { kind: 'deal', isJasirBoost: false, difficulty: room.difficulty },
          ]);
        } else {
          room.message =
            room.playerCount === 2
              ? `Share room code ${room.roomId} or the QR invite link.`
              : `${targetSeat.name} joined (${joinedCount}/${room.playerCount} ready) — code ${room.roomId}.`;
          broadcastRoom(room);
        }
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

    socket.on('join', (payload: JoinRoomPayload) => {
      bindSocketToRoom(payload);
    });

    socket.on('rename', (payload: RenamePayload) => {
      const ctx = getBoundContext();
      if (!ctx) return;
      ctx.activeSeat.name = sanitizeName(
        payload?.name,
        ctx.activeSeat.index === 0 ? 'Host' : `Player ${ctx.activeSeat.index + 1}`
      );
      broadcastRoom(ctx.room);
    });

    socket.on('start_now', () => {
      const ctx = getBoundContext();
      if (!ctx) return;
      if (ctx.activeSeat.index !== 0) {
        sendError(socket, 'Only the host can start early with CPUs.');
        return;
      }
      if (ctx.room.turn !== 'waiting') return;
      startFreshRound(ctx.room, undefined, true);
    });

    socket.on('restart', (payload?: RestartPayload) => {
      const ctx = getBoundContext();
      if (!ctx) return;
      const nextDiff = isDifficultyLevel(payload?.difficulty) ? payload.difficulty : undefined;
      startFreshRound(ctx.room, nextDiff, false);
    });

    socket.on('call_uno', () => {
      const ctx = getBoundContext();
      if (!ctx) return;
      const { room, activeSeat } = ctx;
      if (room.winnerIndex !== null || room.turn === 'waiting' || room.turn === 'over') return;
      if (room.turnIndex !== activeSeat.index || activeSeat.eliminated) {
        sendError(socket, 'Wait for your turn.');
        return;
      }
      if (activeSeat.hand.length < 2 || activeSeat.unoArmed) return;
      activeSeat.unoArmed = true;
      room.message = `${activeSeat.name} called UNO! Play your card.`;
      broadcastRoom(room, (seatIdx) => [
        { kind: 'uno', whoName: activeSeat.name, isSelf: seatIdx === activeSeat.index },
      ]);
    });

    socket.on('draw', () => {
      const ctx = getBoundContext();
      if (!ctx) return;
      const { room, activeSeat } = ctx;
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
          const res = drawOneFromDeck(room.deck, room.discard, activeSeat.hand);
          if (res.reshuffled) effs.push({ kind: 'reshuffle' });
        }
        room.pendingDrawStack = 0;
        room.pendingDrawMin = 0;
        room.drawnUid = null;

        if (handleMercyKnockout(room, activeSeat, effs)) return;

        room.turnIndex = advanceTurn(room, 1);
        room.turn = room.turnIndex === 0 ? 'host' : 'guest';
        const nextSeat = room.seats[room.turnIndex];
        room.message = `${activeSeat.name} drew ${stackCount} cards! ${nextSeat.name}'s turn.`;
        broadcastRoom(room, () => effs);
        scheduleCpuIfNeeded(room);
        return;
      }

      if (room.drawnUid !== null) {
        sendError(socket, 'You already drew a card this turn — play it or pass.');
        return;
      }

      const { card, reshuffled } = drawOneFromDeck(room.deck, room.discard, activeSeat.hand);
      const effects: EffectEvent[] = reshuffled ? [{ kind: 'reshuffle' }] : [];

      if (handleMercyKnockout(room, activeSeat, effects)) return;

      if (!card) {
        room.turnIndex = advanceTurn(room, 1);
        room.turn = room.turnIndex === 0 ? 'host' : 'guest';
        room.drawnUid = null;
        const nextSeat = room.seats[room.turnIndex];
        room.message = `Deck empty — turn passes to ${nextSeat.name}.`;
        broadcastRoom(room, () => effects);
        scheduleCpuIfNeeded(room);
        return;
      }

      const top = room.discard[room.discard.length - 1];
      room.drawnUid = card.uid;
      room.message = canPlayCard(card, top, room.currentColor)
        ? `${activeSeat.name} drew a playable card — play it or pass.`
        : `${activeSeat.name} drew a card with no match — pass turn.`;
      broadcastRoom(room, () => effects);
    });

    socket.on('pass', () => {
      const ctx = getBoundContext();
      if (!ctx) return;
      const { room, activeSeat } = ctx;
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
      broadcastRoom(room);
      scheduleCpuIfNeeded(room);
    });

    socket.on('play', (payload: PlayCardPayload) => {
      const ctx = getBoundContext();
      if (!ctx) return;
      const { room, activeSeat } = ctx;
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
      if (!boundRoomId || boundSeatIndex === null) return;
      const room = rooms.get(boundRoomId);
      if (!room) return;
      const seat = room.seats[boundSeatIndex];
      if (seat && seat.socketId === socket.id) {
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
