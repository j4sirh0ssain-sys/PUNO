import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocket, WebSocketServer } from 'ws';
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
} from './src/game/engine.ts';
import {
  MERCY_HAND_LIMIT,
  type Card,
  type ClientGameView,
  type ClientWsAction,
  type DifficultyLevel,
  type EffectEvent,
  type PlayerRole,
  type SeatInfo,
  type ServerWsMessage,
  type SuitColor,
  type TurnPhase,
} from './src/game/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ServerSeat {
  index: number;
  clientId: string | null;
  name: string;
  ws: WebSocket | null;
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

const rooms = new Map<string, RoomState>();

// Clean up abandoned rooms older than 6 hours
setInterval(() => {
  const cutoff = Date.now() - 6 * 60 * 60 * 1000;
  for (const [id, room] of rooms.entries()) {
    if (room.lastActivityAt < cutoff) {
      if (room.cpuTimer) {
        clearTimeout(room.cpuTimer);
        room.cpuTimer = null;
      }
      rooms.delete(id);
    }
  }
}, 15 * 60 * 1000).unref();

function sanitizeName(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  const cleaned = raw.replace(/\s+/g, ' ').trim().slice(0, 18);
  return cleaned || fallback;
}

function createRoom(
  hostNameRaw?: unknown,
  difficultyRaw?: unknown,
  playerCountRaw?: unknown
): RoomState {
  const roomId = crypto.randomBytes(4).toString('hex').toUpperCase();
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
    ws: null,
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
        ? 'Waiting for the second player to scan or open the invite link.'
        : `Waiting for players (0/${playerCount} ready) — share the QR link or start with CPUs.`,
    roundId: 1,
    cpuTimer: null,
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
  };
  rooms.set(roomId, room);
  return room;
}

function getSeatConnected(seat: ServerSeat): boolean {
  return seat.isCpu || (seat.clientId !== null && seat.ws?.readyState === WebSocket.OPEN);
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
  if (room.turn === 'waiting' || room.turn === 'over' || room.turn === 'dealing' || room.turn === 'busy') {
    viewTurn = room.turn;
  } else if (room.turnIndex === seatIndex) {
    viewTurn = selfRole;
  } else {
    viewTurn = selfRole === 'host' ? 'guest' : 'host';
  }

  let viewWinner: PlayerRole | null = null;
  if (room.winnerIndex !== null) {
    viewWinner = room.winnerIndex === seatIndex ? selfRole : selfRole === 'host' ? 'guest' : 'host';
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

function sendError(ws: WebSocket, message: string): void {
  if (ws.readyState === WebSocket.OPEN) {
    const payload: ServerWsMessage = { type: 'error', message };
    ws.send(JSON.stringify(payload));
  }
}

function broadcastRoom(
  room: RoomState,
  perSeatEffects?: (seatIndex: number) => EffectEvent[]
): void {
  room.lastActivityAt = Date.now();
  for (const seat of room.seats) {
    if (seat.ws && seat.ws.readyState === WebSocket.OPEN) {
      const payload: ServerWsMessage = {
        type: 'state',
        view: buildView(room, seat.index),
        effects: perSeatEffects ? perSeatEffects(seat.index) : [],
      };
      seat.ws.send(JSON.stringify(payload));
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
        winnerRole: winnerSeat.index === seatIdx ? (seatIdx === 0 ? 'host' : 'guest') : seatIdx === 0 ? 'guest' : 'host',
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

function startFreshRound(room: RoomState, nextDifficulty?: DifficultyLevel, fillEmptyWithCpu = false): void {
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
        ? 'Waiting for the second player to scan or open the invite link.'
        : `Waiting for players (${readyCount}/${room.playerCount} ready)...`;
    broadcastRoom(room);
  }
}

async function main(): Promise<void> {
  const app = express();
  app.use(express.json());

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
    });
  });

  app.get('/api/rooms/:roomId', (req, res) => {
    const room = rooms.get(req.params.roomId.toUpperCase());
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

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    let boundRoomId: string | null = null;
    let boundSeatIndex: number | null = null;
    let boundClientId: string | null = null;

    ws.on('message', (raw) => {
      let action: ClientWsAction;
      try {
        action = JSON.parse(raw.toString('utf8')) as ClientWsAction;
      } catch {
        sendError(ws, 'Malformed message.');
        return;
      }

      if (!action || typeof action !== 'object') {
        sendError(ws, 'Invalid action.');
        return;
      }

      if (action.type === 'join') {
        const room = rooms.get(String(action.roomId || '').toUpperCase());
        if (!room) {
          sendError(ws, 'This game room does not exist or has expired.');
          return;
        }
        if (typeof action.token !== 'string' || action.token !== room.token) {
          sendError(ws, 'Invalid game invite token.');
          return;
        }
        const clientId = typeof action.clientId === 'string' ? action.clientId.trim() : '';
        if (!clientId || clientId.length > 100) {
          sendError(ws, 'Invalid player session.');
          return;
        }

        let targetSeat = room.seats.find((s) => s.clientId === clientId) ?? null;
        let isFirstSeatJoin = false;
        if (targetSeat) {
          targetSeat.ws = ws;
          targetSeat.isCpu = false;
          targetSeat.name = sanitizeName(
            action.name,
            targetSeat.index === 0 ? 'Host' : `Player ${targetSeat.index + 1}`
          );
        } else {
          const openSeat = room.seats.find((s) => s.clientId === null && !s.isCpu) ?? null;
          if (!openSeat) {
            sendError(ws, `This ${room.playerCount}-player room is already full.`);
            return;
          }
          isFirstSeatJoin = true;
          openSeat.clientId = clientId;
          openSeat.ws = ws;
          openSeat.isCpu = false;
          openSeat.name = sanitizeName(
            action.name,
            openSeat.index === 0 ? 'Host' : `Player ${openSeat.index + 1}`
          );
          targetSeat = openSeat;
        }

        boundRoomId = room.roomId;
        boundSeatIndex = targetSeat.index;
        boundClientId = clientId;

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
                ? 'Waiting for the second player to scan or open the invite link.'
                : `${targetSeat.name} joined (${joinedCount}/${room.playerCount} ready).`;
            broadcastRoom(room);
          }
        } else {
          broadcastRoom(room, (seatIdx) =>
            isFirstSeatJoin && seatIdx !== targetSeat.index
              ? [
                  {
                    kind: 'banner',
                    text: `${targetSeat.name.toUpperCase()} JOINED`,
                    color: '#f5c84b',
                    size: 0.52,
                    dur: 1.0,
                  },
                ]
              : []
          );
        }
        return;
      }

      if (boundRoomId === null || boundSeatIndex === null || !boundClientId) {
        sendError(ws, 'Join a room first.');
        return;
      }
      const room = rooms.get(boundRoomId);
      if (!room) {
        sendError(ws, 'Room closed.');
        return;
      }
      const activeSeat = room.seats[boundSeatIndex];
      if (!activeSeat) return;

      if (action.type === 'rename') {
        activeSeat.name = sanitizeName(
          action.name,
          activeSeat.index === 0 ? 'Host' : `Player ${activeSeat.index + 1}`
        );
        broadcastRoom(room);
        return;
      }

      if (action.type === 'start_now') {
        if (boundSeatIndex !== 0) {
          sendError(ws, 'Only the host can start early with CPUs.');
          return;
        }
        if (room.turn !== 'waiting') return;
        startFreshRound(room, undefined, true);
        return;
      }

      if (action.type === 'restart') {
        const nextDiff = isDifficultyLevel(action.difficulty) ? action.difficulty : undefined;
        startFreshRound(room, nextDiff, false);
        return;
      }

      if (room.winnerIndex !== null || room.turn === 'waiting' || room.turn === 'over') {
        return;
      }
      if (room.turnIndex !== boundSeatIndex || activeSeat.eliminated) {
        sendError(ws, 'Wait for your turn.');
        return;
      }

      if (action.type === 'call_uno') {
        if (activeSeat.hand.length < 2 || activeSeat.unoArmed) return;
        activeSeat.unoArmed = true;
        room.message = `${activeSeat.name} called UNO! Play your card.`;
        broadcastRoom(room, (seatIdx) => [
          { kind: 'uno', whoName: activeSeat.name, isSelf: seatIdx === activeSeat.index },
        ]);
        return;
      }

      if (action.type === 'draw') {
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
          sendError(ws, 'You already drew a card this turn — play it or pass.');
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
        return;
      }

      if (action.type === 'pass') {
        if (room.drawnUid === null || room.pendingDrawStack > 0) return;
        room.drawnUid = null;
        activeSeat.unoArmed = false;
        room.turnIndex = advanceTurn(room, 1);
        room.turn = room.turnIndex === 0 ? 'host' : 'guest';
        const nextSeat = room.seats[room.turnIndex];
        room.message = `${nextSeat.name}'s turn — color is ${room.currentColor}.`;
        broadcastRoom(room);
        scheduleCpuIfNeeded(room);
        return;
      }

      if (action.type === 'play') {
        const cardIndex = activeSeat.hand.findIndex((c) => c.uid === action.uid);
        if (cardIndex === -1) {
          sendError(ws, 'Card not in hand.');
          return;
        }
        const card = activeSeat.hand[cardIndex];
        if (room.drawnUid !== null && card.uid !== room.drawnUid) {
          sendError(ws, 'Play the card you just drew, or pass.');
          return;
        }
        const top = room.discard[room.discard.length - 1];
        if (!canPlayCard(card, top, room.currentColor, room.pendingDrawMin)) {
          sendError(
            ws,
            room.pendingDrawMin > 0
              ? `Stack a +${room.pendingDrawMin} or higher card, or take +${room.pendingDrawStack}!`
              : 'That card does not match the active color or value.'
          );
          return;
        }
        let nextColor: SuitColor;
        if (card.color === 'Wild') {
          if (!isSuitColor(action.chosenColor)) {
            sendError(ws, 'Choose a valid color for the Wild card.');
            return;
          }
          nextColor = action.chosenColor;
        } else {
          nextColor = card.color;
        }

        commitSeatPlay(room, activeSeat, cardIndex, nextColor);
      }
    });

    ws.on('close', () => {
      if (!boundRoomId || boundSeatIndex === null) return;
      const room = rooms.get(boundRoomId);
      if (!room) return;
      const seat = room.seats[boundSeatIndex];
      if (seat && seat.ws === ws) {
        seat.ws = null;
      }
      broadcastRoom(room);
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexHtml = path.join(distDir, 'index.html');
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(404).send('Build not found.');
      }
    });
  }

  const port = Number(process.env.PORT || 3000);
  server.listen(port, '0.0.0.0', () => {
    console.log(`PUNO server listening on http://0.0.0.0:${port}`);
  });
}

void main();
