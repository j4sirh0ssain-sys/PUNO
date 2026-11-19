import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import {
  canPlayCard,
  dealRound,
  drawColorRoulette,
  drawOneFromDeck,
  getDrawAmount,
  isDifficultyLevel,
  isSuitColor,
} from './src/game/engine.ts';
import {
  MERCY_HAND_LIMIT,
  type Card,
  type ClientGameView,
  type ClientWsAction,
  type DifficultyLevel,
  type EffectEvent,
  type PlayerRole,
  type ServerWsMessage,
  type SuitColor,
  type TurnPhase,
} from './src/game/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface RoomState {
  roomId: string;
  token: string;
  difficulty: DifficultyLevel;
  hostClientId: string | null;
  guestClientId: string | null;
  hostName: string;
  guestName: string;
  hostWs: WebSocket | null;
  guestWs: WebSocket | null;
  deck: Card[];
  hostHand: Card[];
  guestHand: Card[];
  discard: Card[];
  currentColor: SuitColor;
  turn: TurnPhase;
  drawnUid: number | null;
  pendingDrawStack: number;
  pendingDrawMin: number;
  hostUnoArmed: boolean;
  guestUnoArmed: boolean;
  winner: PlayerRole | null;
  score: { host: number; guest: number };
  message: string;
  roundId: number;
  createdAt: number;
  lastActivityAt: number;
}

const rooms = new Map<string, RoomState>();

// Clean up abandoned rooms older than 6 hours
setInterval(() => {
  const cutoff = Date.now() - 6 * 60 * 60 * 1000;
  for (const [id, room] of rooms.entries()) {
    if (room.lastActivityAt < cutoff) {
      rooms.delete(id);
    }
  }
}, 15 * 60 * 1000).unref();

function sanitizeName(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  const cleaned = raw.replace(/\s+/g, ' ').trim().slice(0, 18);
  return cleaned || fallback;
}

function createRoom(hostNameRaw?: unknown, difficultyRaw?: unknown): RoomState {
  const roomId = crypto.randomBytes(4).toString('hex').toUpperCase();
  const token = crypto.randomBytes(16).toString('base64url');
  const hostName = sanitizeName(hostNameRaw, 'Host');
  const difficulty: DifficultyLevel = isDifficultyLevel(difficultyRaw) ? difficultyRaw : 'normal';
  const dealt = dealRound(hostName, difficulty);

  const room: RoomState = {
    roomId,
    token,
    difficulty,
    hostClientId: null,
    guestClientId: null,
    hostName,
    guestName: 'Friend',
    hostWs: null,
    guestWs: null,
    deck: dealt.deck,
    hostHand: dealt.hostHand,
    guestHand: dealt.guestHand,
    discard: dealt.discard,
    currentColor: dealt.currentColor,
    turn: 'waiting',
    drawnUid: null,
    pendingDrawStack: 0,
    pendingDrawMin: 0,
    hostUnoArmed: false,
    guestUnoArmed: false,
    winner: null,
    score: { host: 0, guest: 0 },
    message: 'Waiting for the second player to scan or open the invite link.',
    roundId: 1,
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
  };
  rooms.set(roomId, room);
  return room;
}

function buildView(room: RoomState, role: PlayerRole): ClientGameView {
  const isHost = role === 'host';
  const selfHand = isHost ? room.hostHand : room.guestHand;
  const opponentHand = isHost ? room.guestHand : room.hostHand;
  const opponentConnected = isHost
    ? room.guestClientId !== null && room.guestWs?.readyState === WebSocket.OPEN
    : room.hostClientId !== null && room.hostWs?.readyState === WebSocket.OPEN;

  return {
    roomId: room.roomId,
    mode: 'multiplayer',
    difficulty: room.difficulty,
    selfRole: role,
    selfName: isHost ? room.hostName : room.guestName,
    opponentName: isHost ? room.guestName : room.hostName,
    opponentConnected,
    selfHand,
    opponentCardIds: opponentHand.map((c) => c.uid),
    opponentCount: opponentHand.length,
    discardPile: room.discard.slice(-5),
    deckCount: room.deck.length,
    currentColor: room.currentColor,
    turn: room.turn,
    drawnUid: room.drawnUid,
    pendingDrawStack: room.pendingDrawStack,
    pendingDrawMin: room.pendingDrawMin,
    selfUnoArmed: isHost ? room.hostUnoArmed : room.guestUnoArmed,
    opponentUnoArmed: isHost ? room.guestUnoArmed : room.hostUnoArmed,
    winner: room.winner,
    score: {
      self: isHost ? room.score.host : room.score.guest,
      opponent: isHost ? room.score.guest : room.score.host,
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
  hostEffects: EffectEvent[] = [],
  guestEffects: EffectEvent[] = []
): void {
  room.lastActivityAt = Date.now();
  if (room.hostWs && room.hostWs.readyState === WebSocket.OPEN) {
    const payload: ServerWsMessage = {
      type: 'state',
      view: buildView(room, 'host'),
      effects: hostEffects,
    };
    room.hostWs.send(JSON.stringify(payload));
  }
  if (room.guestWs && room.guestWs.readyState === WebSocket.OPEN) {
    const payload: ServerWsMessage = {
      type: 'state',
      view: buildView(room, 'guest'),
      effects: guestEffects,
    };
    room.guestWs.send(JSON.stringify(payload));
  }
}

function startFreshRound(room: RoomState, nextDifficulty?: DifficultyLevel): void {
  if (nextDifficulty) {
    room.difficulty = nextDifficulty;
  }
  const dealt = dealRound(room.hostName, room.difficulty);
  room.deck = dealt.deck;
  room.hostHand = dealt.hostHand;
  room.guestHand = dealt.guestHand;
  room.discard = dealt.discard;
  room.currentColor = dealt.currentColor;
  room.drawnUid = null;
  room.pendingDrawStack = 0;
  room.pendingDrawMin = 0;
  room.hostUnoArmed = false;
  room.guestUnoArmed = false;
  room.winner = null;
  room.roundId += 1;

  if (room.guestClientId) {
    room.turn = 'host';
    room.message = dealt.jasirBoost
      ? `j4s1r POWER-UP: 7 power cards dealt! ${room.hostName}'s turn.`
      : room.difficulty === 'no_mercy'
        ? `NO MERCY active — ${room.hostName}'s turn.`
        : `${room.hostName}'s turn — match the color or value.`;
    const dealEffect: EffectEvent = {
      kind: 'deal',
      isJasirBoost: dealt.jasirBoost,
      difficulty: room.difficulty,
    };
    const hostEffects: EffectEvent[] = [
      dealEffect,
      { kind: 'banner', text: 'YOUR TURN', color: '#f5c84b', size: 0.6, dur: 1.0, delay: 0.7 },
    ];
    const guestEffects: EffectEvent[] = [
      dealEffect,
      { kind: 'banner', text: `${room.hostName.toUpperCase()} STARTS`, color: '#f5c84b', size: 0.55, dur: 1.0, delay: 0.7 },
    ];
    broadcastRoom(room, hostEffects, guestEffects);
  } else {
    room.turn = 'waiting';
    room.message = 'Waiting for the second player to scan or open the invite link.';
    broadcastRoom(room);
  }
}

async function main(): Promise<void> {
  const app = express();
  app.use(express.json());

  app.post('/api/rooms', (req, res) => {
    const body = req.body && typeof req.body === 'object' ? (req.body as { hostName?: unknown; difficulty?: unknown }) : {};
    const room = createRoom(body.hostName, body.difficulty);
    res.status(201).json({
      roomId: room.roomId,
      token: room.token,
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
    res.json({
      roomId: room.roomId,
      hostName: room.hostName,
      difficulty: room.difficulty,
      guestJoined: room.guestClientId !== null,
    });
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    let boundRoomId: string | null = null;
    let boundRole: PlayerRole | null = null;
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

        let role: PlayerRole | null = null;
        if (room.hostClientId === clientId || room.hostClientId === null) {
          role = 'host';
          room.hostClientId = clientId;
          room.hostWs = ws;
          room.hostName = sanitizeName(action.name, room.hostName);
        } else if (room.guestClientId === clientId || room.guestClientId === null) {
          const isFirstGuestJoin = room.guestClientId === null;
          role = 'guest';
          room.guestClientId = clientId;
          room.guestWs = ws;
          room.guestName = sanitizeName(action.name, 'Player 2');

          if (isFirstGuestJoin) {
            if (room.turn === 'waiting') {
              room.turn = 'host';
              room.message = `${room.guestName} joined! ${room.hostName}'s turn.`;
            }
          }
        } else {
          sendError(ws, 'This room already has two players.');
          return;
        }

        boundRoomId = room.roomId;
        boundRole = role;
        boundClientId = clientId;

        if (role === 'guest' && room.turn === 'host' && room.discard.length === 1 && room.hostHand.length >= 7) {
          const joinBanner: EffectEvent = {
            kind: 'banner',
            text: `${room.guestName.toUpperCase()} JOINED`,
            color: '#f5c84b',
            size: 0.6,
            dur: 1.1,
          };
          broadcastRoom(room, [joinBanner], [{ kind: 'deal', isJasirBoost: false, difficulty: room.difficulty }]);
        } else {
          broadcastRoom(room);
        }
        return;
      }

      if (!boundRoomId || !boundRole || !boundClientId) {
        sendError(ws, 'Join a room first.');
        return;
      }
      const room = rooms.get(boundRoomId);
      if (!room) {
        sendError(ws, 'Room closed.');
        return;
      }

      if (action.type === 'rename') {
        const nextName = sanitizeName(action.name, boundRole === 'host' ? 'Host' : 'Player 2');
        if (boundRole === 'host') {
          room.hostName = nextName;
        } else {
          room.guestName = nextName;
        }
        broadcastRoom(room);
        return;
      }

      if (action.type === 'restart') {
        const nextDiff = isDifficultyLevel(action.difficulty) ? action.difficulty : undefined;
        startFreshRound(room, nextDiff);
        return;
      }

      if (room.winner !== null || room.turn === 'waiting' || room.turn === 'over') {
        return;
      }
      if (room.turn !== boundRole) {
        sendError(ws, 'Wait for your turn.');
        return;
      }

      const activeHand = boundRole === 'host' ? room.hostHand : room.guestHand;
      const opponentHand = boundRole === 'host' ? room.guestHand : room.hostHand;
      const opponentRole: PlayerRole = boundRole === 'host' ? 'guest' : 'host';
      const activeName = boundRole === 'host' ? room.hostName : room.guestName;
      const opponentName = boundRole === 'host' ? room.guestName : room.hostName;

      if (action.type === 'call_uno') {
        if (activeHand.length < 2) return;
        const alreadyArmed = boundRole === 'host' ? room.hostUnoArmed : room.guestUnoArmed;
        if (alreadyArmed) return;
        if (boundRole === 'host') room.hostUnoArmed = true;
        else room.guestUnoArmed = true;
        room.message = `${activeName} called UNO! Play your card.`;
        broadcastRoom(
          room,
          [{ kind: 'uno', whoName: activeName, isSelf: boundRole === 'host' }],
          [{ kind: 'uno', whoName: activeName, isSelf: boundRole === 'guest' }]
        );
        return;
      }

      if (action.type === 'draw') {
        if (boundRole === 'host') room.hostUnoArmed = false;
        else room.guestUnoArmed = false;

        // Accepting a No Mercy draw stack
        if (room.pendingDrawStack > 0) {
          const stackCount = room.pendingDrawStack;
          let reshuffledAny = false;
          for (let i = 0; i < stackCount; i++) {
            const res = drawOneFromDeck(room.deck, room.discard, activeHand);
            if (res.reshuffled) reshuffledAny = true;
          }
          room.pendingDrawStack = 0;
          room.pendingDrawMin = 0;
          room.drawnUid = null;
          const hostEffects: EffectEvent[] = reshuffledAny ? [{ kind: 'reshuffle' }] : [];
          const guestEffects: EffectEvent[] = reshuffledAny ? [{ kind: 'reshuffle' }] : [];

          if (room.difficulty === 'no_mercy' && activeHand.length >= MERCY_HAND_LIMIT) {
            room.winner = opponentRole;
            room.turn = 'over';
            room.score[opponentRole] += 1;
            room.message = `MERCY KO! ${activeName} reached ${activeHand.length} cards.`;
            hostEffects.push({ kind: 'mercy_ko', loserName: activeName, isSelfLoser: boundRole === 'host' });
            guestEffects.push({ kind: 'mercy_ko', loserName: activeName, isSelfLoser: boundRole === 'guest' });
            hostEffects.push({ kind: 'win', winnerRole: opponentRole });
            guestEffects.push({ kind: 'win', winnerRole: opponentRole });
            broadcastRoom(room, hostEffects, guestEffects);
            return;
          }

          room.turn = opponentRole;
          room.message = `${activeName} drew ${stackCount} cards! ${opponentName}'s turn.`;
          broadcastRoom(room, hostEffects, guestEffects);
          return;
        }

        if (room.drawnUid !== null) {
          sendError(ws, 'You already drew a card this turn — play it or pass.');
          return;
        }
        const { card, reshuffled } = drawOneFromDeck(room.deck, room.discard, activeHand);
        const effects: EffectEvent[] = reshuffled ? [{ kind: 'reshuffle' }] : [];

        if (room.difficulty === 'no_mercy' && activeHand.length >= MERCY_HAND_LIMIT) {
          room.winner = opponentRole;
          room.turn = 'over';
          room.score[opponentRole] += 1;
          room.message = `MERCY KO! ${activeName} reached ${activeHand.length} cards.`;
          const hostEffs: EffectEvent[] = [
            ...effects,
            { kind: 'mercy_ko', loserName: activeName, isSelfLoser: boundRole === 'host' },
            { kind: 'win', winnerRole: opponentRole },
          ];
          const guestEffs: EffectEvent[] = [
            ...effects,
            { kind: 'mercy_ko', loserName: activeName, isSelfLoser: boundRole === 'guest' },
            { kind: 'win', winnerRole: opponentRole },
          ];
          broadcastRoom(room, hostEffs, guestEffs);
          return;
        }

        if (!card) {
          room.turn = opponentRole;
          room.drawnUid = null;
          room.message = `Deck empty — turn passes to ${opponentName}.`;
          broadcastRoom(room, effects, effects);
          return;
        }
        const top = room.discard[room.discard.length - 1];
        if (canPlayCard(card, top, room.currentColor)) {
          room.drawnUid = card.uid;
          room.message = `${activeName} drew a playable card — play it or pass.`;
        } else {
          room.drawnUid = card.uid;
          room.message = `${activeName} drew a card with no match — pass turn.`;
        }
        broadcastRoom(room, effects, effects);
        return;
      }

      if (action.type === 'pass') {
        if (room.drawnUid === null || room.pendingDrawStack > 0) return;
        room.drawnUid = null;
        if (boundRole === 'host') room.hostUnoArmed = false;
        else room.guestUnoArmed = false;
        room.turn = opponentRole;
        room.message = `${opponentName}'s turn — color is ${room.currentColor}.`;
        broadcastRoom(room);
        return;
      }

      if (action.type === 'play') {
        const cardIndex = activeHand.findIndex((c) => c.uid === action.uid);
        if (cardIndex === -1) {
          sendError(ws, 'Card not in hand.');
          return;
        }
        const card = activeHand[cardIndex];
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

        const wasUnoArmed = boundRole === 'host' ? room.hostUnoArmed : room.guestUnoArmed;
        if (boundRole === 'host') room.hostUnoArmed = false;
        else room.guestUnoArmed = false;

        activeHand.splice(cardIndex, 1);

        const hostEffects: EffectEvent[] = [];
        const guestEffects: EffectEvent[] = [];

        if (card.value === 'Dump' && card.color !== 'Wild') {
          const extras: Card[] = [];
          for (let i = activeHand.length - 1; i >= 0; i--) {
            if (activeHand[i].color === card.color) {
              const [matched] = activeHand.splice(i, 1);
              extras.push(matched);
            }
          }
          room.discard.push(...extras);
          hostEffects.push({ kind: 'dump', whoName: activeName, color: nextColor, count: extras.length + 1 });
          guestEffects.push({ kind: 'dump', whoName: activeName, color: nextColor, count: extras.length + 1 });
        }

        room.discard.push(card);
        room.currentColor = nextColor;
        room.drawnUid = null;

        hostEffects.push({ kind: 'impact', card, activeColor: nextColor });
        guestEffects.push({ kind: 'impact', card, activeColor: nextColor });

        if (activeHand.length === 0) {
          room.pendingDrawStack = 0;
          room.pendingDrawMin = 0;
          room.winner = boundRole;
          room.turn = 'over';
          room.score[boundRole] += 1;
          room.message = `${activeName} wins the round!`;
          hostEffects.push({ kind: 'win', winnerRole: boundRole });
          guestEffects.push({ kind: 'win', winnerRole: boundRole });
          broadcastRoom(room, hostEffects, guestEffects);
          return;
        }

        let penalizedUno = false;
        if (activeHand.length === 1) {
          if (wasUnoArmed) {
            hostEffects.push({ kind: 'uno', whoName: activeName, isSelf: boundRole === 'host' });
            guestEffects.push({ kind: 'uno', whoName: activeName, isSelf: boundRole === 'guest' });
          } else {
            penalizedUno = true;
            for (let i = 0; i < 2; i++) {
              const res = drawOneFromDeck(room.deck, room.discard, activeHand);
              if (res.reshuffled) {
                hostEffects.push({ kind: 'reshuffle' });
                guestEffects.push({ kind: 'reshuffle' });
              }
            }
            hostEffects.push({ kind: 'uno_penalty', whoName: activeName, isSelf: boundRole === 'host' });
            guestEffects.push({ kind: 'uno_penalty', whoName: activeName, isSelf: boundRole === 'guest' });
          }
        }

        const drawAmount = getDrawAmount(card);
        if (drawAmount > 0) {
          if (room.difficulty === 'no_mercy') {
            room.pendingDrawStack += drawAmount;
            room.pendingDrawMin = drawAmount;
            room.turn = opponentRole;
            room.message = penalizedUno
              ? `${activeName} forgot UNO (+2)! ${opponentName}: stack +${drawAmount}+ or take ${room.pendingDrawStack}!`
              : `${opponentName}: stack a +${drawAmount}+ card or take +${room.pendingDrawStack} cards!`;
          } else {
            let reshuffledAny = false;
            for (let i = 0; i < drawAmount; i++) {
              const res = drawOneFromDeck(room.deck, room.discard, opponentHand);
              if (res.reshuffled) reshuffledAny = true;
            }
            if (reshuffledAny) {
              hostEffects.push({ kind: 'reshuffle' });
              guestEffects.push({ kind: 'reshuffle' });
            }
            room.turn = boundRole;
            room.message = penalizedUno
              ? `${activeName} forgot UNO (+2), and ${opponentName} draws ${drawAmount}!`
              : `${opponentName} draws ${drawAmount}! ${activeName} plays again (${nextColor}).`;
          }
        } else if (card.value === 'Roulette') {
          const rRes = drawColorRoulette(room.deck, room.discard, opponentHand, nextColor);
          if (rRes.reshuffled) {
            hostEffects.push({ kind: 'reshuffle' });
            guestEffects.push({ kind: 'reshuffle' });
          }
          hostEffects.push({ kind: 'roulette', whoName: opponentName, color: nextColor, drawnCount: rRes.drawnCount });
          guestEffects.push({ kind: 'roulette', whoName: opponentName, color: nextColor, drawnCount: rRes.drawnCount });

          if (room.difficulty === 'no_mercy' && opponentHand.length >= MERCY_HAND_LIMIT) {
            room.winner = boundRole;
            room.turn = 'over';
            room.score[boundRole] += 1;
            room.message = `MERCY KO! ${opponentName} hit ${opponentHand.length} cards!`;
            hostEffects.push({ kind: 'mercy_ko', loserName: opponentName, isSelfLoser: opponentRole === 'host' });
            guestEffects.push({ kind: 'mercy_ko', loserName: opponentName, isSelfLoser: opponentRole === 'guest' });
            hostEffects.push({ kind: 'win', winnerRole: boundRole });
            guestEffects.push({ kind: 'win', winnerRole: boundRole });
            broadcastRoom(room, hostEffects, guestEffects);
            return;
          }

          room.turn = boundRole;
          room.message = `${opponentName} drew ${rRes.drawnCount} in Color Roulette! ${activeName} goes again.`;
        } else if (card.value === 'Skip' || card.value === 'Reverse' || card.value === 'Skip All') {
          room.turn = boundRole;
          room.message = penalizedUno
            ? `${activeName} forgot UNO (+2)! Still ${activeName}'s turn.`
            : `${opponentName} skipped! ${activeName} plays again.`;
        } else {
          room.turn = opponentRole;
          room.message = penalizedUno
            ? `${activeName} forgot UNO (+2)! ${opponentName}'s turn (${nextColor}).`
            : activeHand.length === 1
              ? `${activeName} called UNO! ${opponentName}'s turn (${nextColor}).`
              : `${opponentName}'s turn — color is ${nextColor}.`;
        }

        broadcastRoom(room, hostEffects, guestEffects);
      }
    });

    ws.on('close', () => {
      if (!boundRoomId || !boundRole) return;
      const room = rooms.get(boundRoomId);
      if (!room) return;
      if (boundRole === 'host' && room.hostWs === ws) {
        room.hostWs = null;
      } else if (boundRole === 'guest' && room.guestWs === ws) {
        room.guestWs = null;
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
