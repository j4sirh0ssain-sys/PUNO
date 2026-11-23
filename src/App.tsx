import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle,
  Clock,
  Crown,
  Eye,
  Flame,
  Heart,
  Megaphone,
  Palette,
  Play,
  QrCode,
  RotateCcw,
  Skull,
  Sparkles,
  Star,
  ThumbsDown,
  ThumbsUp,
  Trophy,
  User,
  UserX,
  Users,
  Volume2,
  VolumeX,
  Wifi,
  X,
  Zap,
} from 'lucide-react';
import { io, type Socket } from 'socket.io-client';
import { HomeBackdrop, PunoLogo } from './components/HomeVisuals.tsx';
import { QrInviteModal } from './components/QrInviteModal.tsx';
import { PunoCanvasEngine } from './game/canvasRenderer.ts';
import { buildApiUrl, getSocketServerUrl, wakeBackendServer } from './lib/backend.ts';
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
  shouldCpuCallUno,
} from './game/engine.ts';
import { soundFx } from './game/sound.ts';
import { TABLE_THEMES, THEME_LIST, type TableTheme, type TableThemeId } from './game/themes.ts';
import {
  BOMBOCLATT_CARD_VALUES,
  COLORS,
  DIFFICULTY_LIST,
  getBomboclattCardArtUrl,
  MAX_PLAYERS,
  MIN_PLAYERS,
  POWER_CARD_VALUES,
  RIZZ_PICKUP_LINES,
  type Card,
  type ClientGameView,
  type ClientWsAction,
  type DifficultyLevel,
  type EffectEvent,
  type GameMode,
  type PeekTargetInfo,
  type PlayerRole,
  type SeatInfo,
  type SuitColor,
  type TurnPhase,
} from './game/types.ts';

type ScreenState = 'TITLE_MENU' | 'PLAYING' | 'GAME_OVER';

interface SoloSeat {
  index: number;
  name: string;
  isCpu: boolean;
  hand: Card[];
  unoArmed: boolean;
  eliminated: boolean;
  score: number;
}

interface SoloPendingRizz {
  promptId: string;
  fromIndex: number;
  targetIndex: number;
  line: string;
  nextTurnIndex: number;
}

interface SoloInternalState {
  difficulty: DifficultyLevel;
  playerCount: number;
  seats: SoloSeat[];
  deck: Card[];
  discard: Card[];
  currentColor: SuitColor;
  turn: TurnPhase;
  turnIndex: number;
  direction: 1 | -1;
  drawnUid: number | null;
  pendingDrawStack: number;
  pendingDrawMin: number;
  goonerSurjoUsed: boolean;
  pendingRizz: SoloPendingRizz | null;
  peekTarget: PeekTargetInfo | null;
  winner: PlayerRole | null;
  winnerIndex: number | null;
  winnerName: string | null;
  message: string;
  roundId: number;
}

let memoryFallbackClientId: string | null = null;

function getOrCreateClientId(_scopeKey?: string): string {
  const storageKey = 'puno-tab-client-id';
  try {
    const existing = sessionStorage.getItem(storageKey);
    if (existing) return existing;
    const generated =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem(storageKey, generated);
    return generated;
  } catch {
    if (!memoryFallbackClientId) {
      memoryFallbackClientId =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    }
    return memoryFallbackClientId;
  }
}

const ACTIVE_SESSION_KEY = 'puno-active-multiplayer-session';

interface SavedMultiplayerSession {
  roomId: string;
  token: string;
  name: string;
}

function saveMultiplayerSession(session: SavedMultiplayerSession): void {
  try {
    sessionStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify(session));
  } catch {
    // ignore
  }
}

function loadMultiplayerSession(): SavedMultiplayerSession | null {
  try {
    const raw = sessionStorage.getItem(ACTIVE_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedMultiplayerSession>;
    if (
      typeof parsed.roomId === 'string' &&
      parsed.roomId.trim() &&
      typeof parsed.token === 'string' &&
      parsed.token.trim()
    ) {
      return {
        roomId: parsed.roomId.trim().toUpperCase(),
        token: parsed.token.trim(),
        name: typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : 'Player',
      };
    }
    return null;
  } catch {
    return null;
  }
}

function clearMultiplayerSession(): void {
  try {
    sessionStorage.removeItem(ACTIVE_SESSION_KEY);
  } catch {
    // ignore
  }
}

function isThemeId(value: string | null): value is TableThemeId {
  return (
    value === 'emerald' ||
    value === 'burgundy' ||
    value === 'obsidian' ||
    value === 'sakura' ||
    value === 'pharaoh' ||
    value === 'aurora' ||
    value === 'retro'
  );
}

interface ShowcaseCardProps {
  theme: TableTheme;
  suit: 'Blue' | 'Red' | 'Wild';
  label: string;
  rotate: number;
  xOffset: number;
  yOffset: number;
  zIndex: number;
  floatDelay: number;
}

function ShowcaseCard({
  theme,
  suit,
  label,
  rotate,
  xOffset,
  yOffset,
  zIndex,
  floatDelay,
}: ShowcaseCardProps) {
  const artUrl = getBomboclattCardArtUrl(label);
  const suitColor = theme.suitHex[suit];
  const design = theme.cardDesign;
  const isDarkFace = design === 'obsidian' || design === 'sunburst';
  const isWild = suit === 'Wild' && !artUrl;
  const cornerTextColor = isDarkFace
    ? isWild
      ? theme.accent
      : suitColor
    : '#ffffff';
  const centerTextColor = isWild ? '#ffffff' : suitColor;
  const uid = `sc-${theme.id}-${suit}-${label.replace(/[^a-z0-9]/gi, '')}`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 24, scale: 0.85, rotate: rotate - 8 }}
      animate={{
        opacity: 1,
        y: [yOffset, yOffset - 10, yOffset],
        scale: 1,
        rotate: [rotate - 1, rotate + 1, rotate - 1],
      }}
      whileHover={{
        y: yOffset - 24,
        scale: 1.1,
        rotate: 0,
        transition: { type: 'spring', stiffness: 320, damping: 18 },
      }}
      transition={{
        opacity: { duration: 0.25 },
        scale: { type: 'spring', stiffness: 260, damping: 20 },
        rotate: {
          duration: 4.5,
          repeat: Infinity,
          repeatType: 'mirror',
          ease: 'easeInOut',
          delay: floatDelay,
        },
        y: {
          duration: 3.2,
          repeat: Infinity,
          repeatType: 'mirror',
          ease: 'easeInOut',
          delay: floatDelay,
        },
      }}
      style={{
        x: xOffset,
        zIndex,
        backgroundColor: artUrl ? '#0f172a' : theme.cardFrame,
        borderColor: artUrl ? 'rgba(255,255,255,0.4)' : theme.cardFrameOutline,
        boxShadow: design === 'comic' ? '6px 8px 0 rgba(12, 14, 26, 0.85)' : undefined,
      }}
      className={`absolute w-28 h-40 rounded-xl shadow-2xl border-2 cursor-pointer select-none overflow-hidden ${
        artUrl ? 'p-0' : 'p-1.5'
      }`}
    >
      {artUrl ? (
        <img
          src={artUrl}
          alt={label}
          draggable={false}
          className="w-full h-full object-cover"
          style={{
            transform:
              label === 'Gooner Surjo'
                ? 'scale(1.18)'
                : label === 'Rafath Kauwa'
                  ? 'scale(1.06)'
                  : 'scale(1.02)',
          }}
        />
      ) : (
        <div
          className="w-full h-full rounded-lg flex items-center justify-center relative overflow-hidden"
          style={{
            backgroundColor:
              design === 'obsidian'
                ? '#0d131d'
                : design === 'sunburst'
                  ? '#110f0a'
                  : suitColor,
            border:
              design === 'comic'
                ? '2px solid #141414'
                : design === 'obsidian'
                  ? `2px solid ${isWild ? '#38bdf8' : suitColor}`
                  : design === 'sunburst'
                    ? '1.5px solid #d4a63a'
                    : design === 'deco'
                      ? '1.5px solid #f0d086'
                      : '1px solid rgba(255,255,255,0.28)',
          }}
        >
          <span
            className="absolute top-1.5 left-2 font-display italic font-extrabold text-[13px] leading-none"
            style={{ color: cornerTextColor, textShadow: '0 1px 2px rgba(0,0,0,0.45)' }}
          >
            {label}
          </span>
          <span
            className="absolute bottom-1.5 right-2 font-display italic font-extrabold text-[13px] leading-none rotate-180"
            style={{ color: cornerTextColor, textShadow: '0 -1px 2px rgba(0,0,0,0.45)' }}
          >
            {label}
          </span>

          <svg viewBox="-40 -55 80 110" className="w-full h-full pointer-events-none" aria-hidden="true">
            <defs>
              {isWild && (
                <linearGradient id={uid} x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor={theme.suitHex.Red} />
                  <stop offset="33%" stopColor={theme.suitHex.Blue} />
                  <stop offset="66%" stopColor={theme.suitHex.Green} />
                  <stop offset="100%" stopColor={theme.suitHex.Yellow} />
                </linearGradient>
              )}
            </defs>
            {design === 'obsidian' && (
              <polygon
                points="0,-29 25,-14.5 25,14.5 0,29 -25,14.5 -25,-14.5"
                fill={isWild ? `url(#${uid})` : '#101927'}
                stroke={isWild ? '#ffffff' : suitColor}
                strokeWidth="2.4"
              />
            )}
            {design === 'sunburst' && (
              <polygon
                points="-12,-29 12,-29 29,-12 29,12 12,29 -12,29 -29,12 -29,-12"
                fill={isWild ? `url(#${uid})` : '#1d1911'}
                stroke={isWild ? '#fde08d' : suitColor}
                strokeWidth="2.4"
              />
            )}
            {design === 'crest' && (
              <circle
                cx="0"
                cy="0"
                r="27"
                fill={isWild ? `url(#${uid})` : theme.cardCenterBg}
                stroke="#ffffff"
                strokeWidth="2.2"
              />
            )}
            {(design === 'deco' || design === 'prism') && (
              <polygon
                points="0,-41 30,0 0,41 -30,0"
                fill={isWild ? `url(#${uid})` : theme.cardCenterBg}
                stroke={design === 'deco' ? '#e8c474' : '#ffffff'}
                strokeWidth="2"
              />
            )}
            {design === 'classic' && (
              <ellipse
                cx="0"
                cy="0"
                rx="28"
                ry="43"
                transform="rotate(26)"
                fill={isWild ? `url(#${uid})` : theme.cardCenterBg}
                stroke="rgba(255,255,255,0.45)"
                strokeWidth="1.6"
              />
            )}
            {design === 'comic' && (
              <g transform="rotate(24)">
                <ellipse cx="3" cy="3.5" rx="28" ry="41" fill="#141414" />
                <ellipse
                  cx="0"
                  cy="0"
                  rx="28"
                  ry="41"
                  fill={isWild ? `url(#${uid})` : theme.cardCenterBg}
                  stroke="#141414"
                  strokeWidth="2.6"
                />
              </g>
            )}
          </svg>

          <span
            className={`absolute font-display italic font-extrabold leading-none tracking-tight ${
              label.length >= 3 ? 'text-xl' : label.length > 1 ? 'text-2xl' : 'text-3xl'
            }`}
            style={{
              color: centerTextColor,
              textShadow:
                design === 'comic'
                  ? '2px 2.5px 0 #141414'
                  : '0 2px 3px rgba(0,0,0,0.35)',
            }}
          >
            {label}
          </span>
        </div>
      )}
    </motion.div>
  );
}

export default function App() {
  const urlParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const inviteRoomParam = useMemo(() => {
    const raw = urlParams.get('room');
    const cleaned = raw ? raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '') : '';
    return cleaned || null;
  }, [urlParams]);
  const inviteTokenParam = useMemo(() => {
    const raw = urlParams.get('token');
    const cleaned = raw ? raw.trim() : '';
    return cleaned || null;
  }, [urlParams]);
  const [inviteDismissed, setInviteDismissed] = useState(false);
  const isGuestInvite = Boolean(inviteRoomParam && inviteTokenParam && !inviteDismissed);

  const [screen, setScreen] = useState<ScreenState>('TITLE_MENU');
  const [mode, setMode] = useState<GameMode>(isGuestInvite ? 'multiplayer' : 'solo');
  const [themeId, setThemeId] = useState<TableThemeId>(() => {
    try {
      const saved = localStorage.getItem('puno-table-theme');
      return isThemeId(saved) ? saved : 'emerald';
    } catch {
      return 'emerald';
    }
  });
  const activeTheme = TABLE_THEMES[themeId];
  const [difficulty, setDifficulty] = useState<DifficultyLevel>(() => {
    try {
      const saved = localStorage.getItem('puno-difficulty');
      return isDifficultyLevel(saved) ? saved : 'normal';
    } catch {
      return 'normal';
    }
  });
  const activeDifficulty =
    DIFFICULTY_LIST.find((d) => d.id === difficulty) ?? DIFFICULTY_LIST[1];

  const [playerCount, setPlayerCount] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('puno-player-count');
      return saved ? clampPlayerCount(saved) : MIN_PLAYERS;
    } catch {
      return MIN_PLAYERS;
    }
  });

  const [playerName, setPlayerName] = useState<string>(() => {
    try {
      return localStorage.getItem('puno-player-name') || 'Player';
    } catch {
      return 'Player';
    }
  });
  const [nameDraft, setNameDraft] = useState<string>(playerName);
  const [showNameModal, setShowNameModal] = useState(false);

  const [muted, setMuted] = useState(false);
  const [pendingWildUid, setPendingWildUid] = useState<number | null>(null);
  const [careerWins, setCareerWins] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem('puno-career-wins'));
      return Number.isFinite(saved) && saved >= 0 ? Math.floor(saved) : 0;
    } catch {
      return 0;
    }
  });
  const careerWinsRef = useRef<number>(careerWins);
  const [winMilestone, setWinMilestone] = useState<1 | 5 | 10 | null>(null);
  const recordedWinKeyRef = useRef<string | null>(null);

  const [roomId, setRoomId] = useState<string | null>(inviteRoomParam);
  const [roomToken, setRoomToken] = useState<string | null>(inviteTokenParam);
  const [joinCodeDraft, setJoinCodeDraft] = useState('');
  const [showQrModal, setShowQrModal] = useState(false);
  const [showPlayersModal, setShowPlayersModal] = useState(false);
  const [kickingSeatIndex, setKickingSeatIndex] = useState<number | null>(null);
  const [votingSeatIndex, setVotingSeatIndex] = useState<number | null>(null);
  const [startingMatch, setStartingMatch] = useState(false);
  const [turnSecondsLeft, setTurnSecondsLeft] = useState<number | null>(null);
  const [peekSecondsLeft, setPeekSecondsLeft] = useState<number>(0);
  const [dismissedPeekKey, setDismissedPeekKey] = useState<string | null>(null);
  const [rizzBusyPromptId, setRizzBusyPromptId] = useState<string | null>(null);
  const [selectedRizzCardUid, setSelectedRizzCardUid] = useState<number | null>(null);
  const clockOffsetRef = useRef<number>(0);
  const [roomBusy, setRoomBusy] = useState(false);
  const [networkError, setNetworkError] = useState<string | null>(null);
  const [wsStatus, setWsStatus] = useState<'idle' | 'connecting' | 'connected' | 'reconnecting'>('idle');
  const [multiView, setMultiView] = useState<ClientGameView | null>(null);

  const soloRef = useRef<SoloInternalState | null>(null);
  const [soloView, setSoloView] = useState<ClientGameView | null>(null);
  const timersRef = useRef<number[]>([]);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<PunoCanvasEngine | null>(null);
  const pendingEffectsRef = useRef<EffectEvent[]>([]);
  const lastSyncedViewRef = useRef<ClientGameView | null>(null);
  const [hudTop, setHudTop] = useState<number | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const joinTimeoutRef = useRef<number | null>(null);
  const activeJoinNameRef = useRef<string>(playerName);
  const modeRef = useRef<GameMode>(mode);
  const roomIdRef = useRef<string | null>(roomId);
  const roomTokenRef = useRef<string | null>(roomToken);
  const themeIdRef = useRef<TableThemeId>(themeId);
  const prevWaitingRef = useRef(true);
  const [pointerActive, setPointerActive] = useState(false);

  modeRef.current = mode;
  roomIdRef.current = roomId;
  roomTokenRef.current = roomToken;
  themeIdRef.current = themeId;

  const activeView = mode === 'solo' ? soloView : multiView;

  const selectTheme = useCallback((next: TableThemeId) => {
    setThemeId(next);
    engineRef.current?.setTheme(next);
    try {
      localStorage.setItem('puno-table-theme', next);
    } catch {
      // ignore
    }
  }, []);

  const selectDifficulty = useCallback((next: DifficultyLevel) => {
    setDifficulty(next);
    try {
      localStorage.setItem('puno-difficulty', next);
    } catch {
      // ignore
    }
  }, []);

  const selectPlayerCount = useCallback((next: number) => {
    const clamped = clampPlayerCount(next);
    setPlayerCount(clamped);
    try {
      localStorage.setItem('puno-player-count', String(clamped));
    } catch {
      // ignore
    }
  }, []);

  const cycleTheme = useCallback(() => {
    const idx = THEME_LIST.findIndex((t) => t.id === themeId);
    const next = THEME_LIST[(idx + 1) % THEME_LIST.length].id;
    selectTheme(next);
  }, [selectTheme, themeId]);

  const clearSoloTimers = useCallback(() => {
    for (const id of timersRef.current) {
      window.clearTimeout(id);
    }
    timersRef.current = [];
  }, []);

  const scheduleSolo = useCallback((ms: number, fn: () => void) => {
    const id = window.setTimeout(fn, ms);
    timersRef.current.push(id);
  }, []);

  const recordSelfWin = useCallback((winKey: string): 1 | 5 | 10 | undefined => {
    if (recordedWinKeyRef.current === winKey) {
      return undefined;
    }
    recordedWinKeyRef.current = winKey;
    const next = careerWinsRef.current + 1;
    careerWinsRef.current = next;
    setCareerWins(next);
    try {
      localStorage.setItem('puno-career-wins', String(next));
    } catch {
      // ignore
    }
    const milestone: 1 | 5 | 10 | undefined =
      next === 1 || next === 5 || next === 10 ? next : undefined;
    setWinMilestone(milestone ?? null);
    return milestone;
  }, []);

  const playSoundForEffects = useCallback((effects: EffectEvent[]) => {
    for (const eff of effects) {
      if (eff.kind === 'deal') {
        soundFx.playDeal();
      } else if (eff.kind === 'seat_draw') {
        soundFx.playDraw();
      } else if (eff.kind === 'impact') {
        if (['+6', '+10', 'Roulette', 'Dump', 'Skip All'].includes(eff.card.value)) {
          soundFx.playMegaPower();
        } else {
          const isPower = [
            'Skip',
            'Reverse',
            '+2',
            '+4',
            'Wild',
            ...BOMBOCLATT_CARD_VALUES,
          ].includes(eff.card.value);
          soundFx.playCard(isPower);
        }
      } else if (eff.kind === 'crow_feathers') {
        soundFx.playCrow();
      } else if (eff.kind === 'rizz_line') {
        soundFx.playRizz();
      } else if (eff.kind === 'steal_power') {
        soundFx.playSteal();
      } else if (eff.kind === 'surjo_ko') {
        soundFx.playEliminate();
      } else if (eff.kind === 'uno') {
        soundFx.playUno();
      } else if (eff.kind === 'uno_penalty' || eff.kind === 'mercy_ko') {
        soundFx.playPenalty();
      } else if (eff.kind === 'roulette' || eff.kind === 'dump') {
        soundFx.playMegaPower();
      } else if (eff.kind === 'win') {
        soundFx.playWin(eff.milestone, themeIdRef.current);
      }
    }
  }, []);

  const syncSoloToView = useCallback(
    (effects: EffectEvent[] = []) => {
      const s = soloRef.current;
      if (!s) return;
      const nowMs = Date.now();
      if (s.peekTarget && nowMs >= s.peekTarget.expiresAt) {
        s.peekTarget = null;
      }
      const selfSeat = s.seats[0];
      const primaryOpp = s.seats[1] ?? s.seats[0];
      const bestOppScore = s.seats.reduce(
        (max, seat) => (seat.index === 0 ? max : Math.max(max, seat.score)),
        0
      );
      const seatInfos: SeatInfo[] = s.seats.map((seat) => ({
        index: seat.index,
        name: seat.name,
        isCpu: seat.isCpu,
        connected: true,
        cardCount: seat.hand.length,
        unoArmed: seat.unoArmed,
        eliminated: seat.eliminated,
        score: seat.score,
      }));

      const view: ClientGameView = {
        roomId: 'SOLO',
        mode: 'solo',
        difficulty: s.difficulty,
        playerCount: s.playerCount,
        selfIndex: 0,
        turnIndex: s.turn === 'host' || s.turn === 'guest' ? s.turnIndex : null,
        direction: s.direction,
        seats: seatInfos,
        selfRole: 'host',
        selfName: selfSeat.name,
        opponentName: primaryOpp.name,
        opponentConnected: true,
        selfHand: [...selfSeat.hand],
        opponentCardIds: s.playerCount === 2 ? primaryOpp.hand.map((c) => c.uid) : [],
        opponentCount: primaryOpp.hand.length,
        discardPile: s.discard.slice(-5),
        deckCount: s.deck.length,
        currentColor: s.currentColor,
        turn: s.turn,
        drawnUid: s.drawnUid,
        pendingDrawStack: s.pendingDrawStack,
        pendingDrawMin: s.pendingDrawMin,
        selfUnoArmed: selfSeat.unoArmed,
        opponentUnoArmed: primaryOpp.unoArmed,
        winner: s.winner,
        winnerIndex: s.winnerIndex,
        winnerName: s.winnerName,
        score: { self: selfSeat.score, opponent: bestOppScore },
        message: s.message,
        roundId: s.roundId,
        serverNow: nowMs,
        pendingRizzPrompt:
          s.pendingRizz && s.pendingRizz.targetIndex === 0
            ? {
                promptId: s.pendingRizz.promptId,
                fromIndex: s.pendingRizz.fromIndex,
                fromName: s.seats[s.pendingRizz.fromIndex]?.name ?? 'CPU',
                line: s.pendingRizz.line,
              }
            : null,
        peekTarget:
          s.peekTarget && nowMs < s.peekTarget.expiresAt
            ? {
                ...s.peekTarget,
                cards: [...s.peekTarget.cards],
              }
            : null,
      };
      setSoloView(view);
      if (s.turn === 'over' && s.winner) {
        setScreen('GAME_OVER');
      }
      if (engineRef.current) {
        engineRef.current.syncView(view, effects);
        lastSyncedViewRef.current = view;
        playSoundForEffects(effects);
      } else if (effects.length > 0) {
        pendingEffectsRef.current.push(...effects);
      }
    },
    [playSoundForEffects]
  );

  const startSoloRound = useCallback(
    (
      nameOverride?: string,
      preserveScore = true,
      difficultyOverride?: DifficultyLevel,
      playerCountOverride?: number
    ) => {
      clearSoloTimers();
      setPendingWildUid(null);
      setWinMilestone(null);
      setNetworkError(null);
      setDismissedPeekKey(null);
      setRizzBusyPromptId(null);
      const effectiveName = (nameOverride ?? playerName).trim() || 'Player';
      const effectiveDiff = difficultyOverride ?? difficulty;
      const effectiveCount = clampPlayerCount(playerCountOverride ?? playerCount);
      const prev = soloRef.current;
      const nextRoundId = prev ? prev.roundId + 1 : 1;

      const seatNames = Array.from({ length: effectiveCount }, (_, idx) => {
        if (idx === 0) return effectiveName;
        return effectiveCount === 2 ? 'CPU' : `CPU ${idx}`;
      });
      const dealt = dealRoundMulti(seatNames, effectiveDiff);
      const jasirBoost = dealt.jasirSeatIndexes.includes(0);

      const seats: SoloSeat[] = seatNames.map((name, idx) => ({
        index: idx,
        name,
        isCpu: idx > 0,
        hand: dealt.hands[idx] ?? [],
        unoArmed: false,
        eliminated: false,
        score:
          preserveScore && prev && prev.playerCount === effectiveCount && prev.seats[idx]
            ? prev.seats[idx].score
            : 0,
      }));

      soloRef.current = {
        difficulty: effectiveDiff,
        playerCount: effectiveCount,
        seats,
        deck: dealt.deck,
        discard: dealt.discard,
        currentColor: dealt.currentColor,
        turn: 'dealing',
        turnIndex: 0,
        direction: 1,
        drawnUid: null,
        pendingDrawStack: 0,
        pendingDrawMin: 0,
        goonerSurjoUsed: false,
        pendingRizz: null,
        peekTarget: null,
        winner: null,
        winnerIndex: null,
        winnerName: null,
        message: jasirBoost
          ? 'j4s1r POWER-UP: 7 power cards dealt!'
          : effectiveDiff === 'bomboclatt'
            ? 'BOMBOCLATT MODE — 50-card KO limit & chaos cards!'
            : effectiveDiff === 'no_mercy'
              ? 'NO MERCY MODE — 25+ cards = KO!'
              : `Shuffling & dealing (${effectiveCount} players)...`,
        roundId: nextRoundId,
      };

      setMode('solo');
      setScreen('PLAYING');
      syncSoloToView([
        { kind: 'deal', isJasirBoost: jasirBoost, difficulty: effectiveDiff },
      ]);

      scheduleSolo(900, () => {
        const s = soloRef.current;
        if (!s || s.roundId !== nextRoundId) return;
        s.turn = 'host';
        s.turnIndex = 0;
        s.message = jasirBoost
          ? 'j4s1r POWER-UP active — your turn!'
          : effectiveDiff === 'bomboclatt'
            ? 'Your turn — stack draws or unleash Bomboclatt cards!'
            : effectiveDiff === 'no_mercy'
              ? 'Your turn — stack draw cards or show No Mercy.'
              : 'Your turn — match the color or number.';
        syncSoloToView([
          { kind: 'banner', text: 'YOUR TURN', color: activeTheme.accent, size: 0.55, dur: 0.9 },
        ]);
      });
    },
    [
      activeTheme.accent,
      clearSoloTimers,
      difficulty,
      playerCount,
      playerName,
      scheduleSolo,
      syncSoloToView,
    ]
  );

  const advanceSoloIndex = (s: SoloInternalState, steps = 1): number =>
    getNextAliveSeatIndex(
      s.seats.map((seat) => seat.eliminated),
      s.turnIndex,
      s.direction,
      steps
    );

  const recycleSoloHand = (s: SoloInternalState, hand: Card[]) => {
    if (hand.length === 0) return;
    const kept = hand
      .splice(0, hand.length)
      .filter((c) => !(s.goonerSurjoUsed && c.value === 'Gooner Surjo'));
    if (kept.length > 0) {
      s.deck.unshift(...kept);
    }
  };

  const drawSoloOne = (
    s: SoloInternalState,
    targetHand: Card[]
  ): { card: Card | null; reshuffled: boolean } => {
    return drawOneFromDeck(s.deck, s.discard, targetHand, {
      surjoUsed: s.goonerSurjoUsed,
      surjoDrawChance: s.difficulty === 'bomboclatt' ? 0.05 : 0,
    });
  };

  const endSoloRoundWithWinner = (
    s: SoloInternalState,
    winnerSeat: SoloSeat,
    expectedRound: number,
    busyMessage: string,
    winMessage: string,
    baseEffects: EffectEvent[]
  ) => {
    s.pendingDrawStack = 0;
    s.pendingDrawMin = 0;
    s.pendingRizz = null;
    s.peekTarget = null;
    s.turn = 'busy';
    s.message = busyMessage;
    syncSoloToView(baseEffects);
    scheduleSolo(900, () => {
      const st = soloRef.current;
      if (!st || st.roundId !== expectedRound) return;
      winnerSeat.score += 1;
      st.winner = winnerSeat.index === 0 ? 'host' : 'guest';
      st.winnerIndex = winnerSeat.index;
      st.winnerName = winnerSeat.name;
      st.turn = 'over';
      st.message = winMessage;
      if (winnerSeat.index === 0) {
        const milestone = recordSelfWin(`solo-${expectedRound}`);
        syncSoloToView([
          {
            kind: 'win',
            winnerRole: 'host',
            winnerIndex: 0,
            winnerName: winnerSeat.name,
            milestone,
          },
        ]);
      } else {
        setWinMilestone(null);
        syncSoloToView([
          {
            kind: 'win',
            winnerRole: 'guest',
            winnerIndex: winnerSeat.index,
            winnerName: winnerSeat.name,
          },
        ]);
      }
    });
  };

  const triggerSoloMercyKo = (
    s: SoloInternalState,
    loserSeat: SoloSeat,
    expectedRound: number,
    baseEffects: EffectEvent[]
  ): boolean => {
    const limit = getHandLimit(s.difficulty);
    if (limit === null || loserSeat.hand.length < limit) {
      return false;
    }
    loserSeat.eliminated = true;
    recycleSoloHand(s, loserSeat.hand);
    const alive = s.seats.filter((seat) => !seat.eliminated);
    const isSelfLoser = loserSeat.index === 0;
    const koEffects: EffectEvent[] = [
      ...baseEffects,
      { kind: 'mercy_ko', loserName: loserSeat.name, isSelfLoser, seatIndex: loserSeat.index },
    ];

    if (alive.length <= 1 || isSelfLoser) {
      const winnerSeat = isSelfLoser ? alive[0] ?? s.seats[1] : alive[0] ?? s.seats[0];
      endSoloRoundWithWinner(
        s,
        winnerSeat,
        expectedRound,
        `MERCY KO! ${loserSeat.name} reached ${limit}+ cards!`,
        `${winnerSeat.name} wins by Mercy Rule KO!`,
        koEffects
      );
      return true;
    }

    const nextIdx = s.turnIndex === loserSeat.index ? advanceSoloIndex(s, 1) : s.turnIndex;
    s.turn = 'busy';
    s.message = `MERCY KO! ${loserSeat.name} knocked out!`;
    syncSoloToView(koEffects);
    scheduleSolo(900, () => {
      const st = soloRef.current;
      if (!st || st.roundId !== expectedRound || st.winner) return;
      st.turnIndex = nextIdx;
      const nextSeat = st.seats[nextIdx];
      st.turn = nextIdx === 0 ? 'host' : 'guest';
      st.message = `${nextSeat.name}'s turn (${st.currentColor}).`;
      syncSoloToView();
      if (nextSeat.isCpu) {
        scheduleSolo(700, () => runCpuTurn(expectedRound));
      }
    });
    return true;
  };

  const runCpuTurn = useCallback(
    (expectedRound: number) => {
      const s = soloRef.current;
      if (!s || s.roundId !== expectedRound || s.turn !== 'guest' || s.winner) return;
      const cpuSeat = s.seats[s.turnIndex];
      if (!cpuSeat || !cpuSeat.isCpu || cpuSeat.eliminated) return;

      const nextAliveIdx = advanceSoloIndex(s, 1);
      const nextAliveCount = s.seats[nextAliveIdx]?.hand.length ?? 7;
      const top = s.discard[s.discard.length - 1];
      const chosen = chooseCpuCard(
        cpuSeat.hand,
        top,
        s.currentColor,
        s.difficulty,
        s.pendingDrawMin,
        nextAliveCount
      );

      if (s.pendingDrawStack > 0 && !chosen) {
        const stackCount = s.pendingDrawStack;
        const effs: EffectEvent[] = [{ kind: 'seat_draw', seatIndex: cpuSeat.index, count: stackCount }];
        for (let i = 0; i < stackCount; i++) {
          const res = drawSoloOne(s, cpuSeat.hand);
          if (res.reshuffled) effs.push({ kind: 'reshuffle' });
        }
        s.pendingDrawStack = 0;
        s.pendingDrawMin = 0;
        soundFx.playDraw();

        if (triggerSoloMercyKo(s, cpuSeat, expectedRound, effs)) return;

        const nextIdx = advanceSoloIndex(s, 1);
        const nextSeat = s.seats[nextIdx];
        s.turn = 'busy';
        s.message = `${cpuSeat.name} took +${stackCount} cards! ${nextSeat.name}'s turn.`;
        syncSoloToView(effs);
        scheduleSolo(750, () => {
          const st = soloRef.current;
          if (!st || st.roundId !== expectedRound || st.winner) return;
          st.turnIndex = nextIdx;
          st.turn = nextIdx === 0 ? 'host' : 'guest';
          syncSoloToView();
          if (nextSeat.isCpu) {
            scheduleSolo(650, () => runCpuTurn(expectedRound));
          }
        });
        return;
      }

      if (!chosen) {
        const { card, reshuffled } = drawSoloOne(s, cpuSeat.hand);
        const effs: EffectEvent[] = [
          ...(card ? [{ kind: 'seat_draw', seatIndex: cpuSeat.index, count: 1 } as EffectEvent] : []),
          ...(reshuffled ? [{ kind: 'reshuffle' } as EffectEvent] : []),
        ];
        soundFx.playDraw();

        if (triggerSoloMercyKo(s, cpuSeat, expectedRound, effs)) return;

        if (card && canPlayCard(card, top, s.currentColor)) {
          s.message = `${cpuSeat.name} drew a playable card...`;
          syncSoloToView(effs);
          scheduleSolo(700, () => {
            const st = soloRef.current;
            if (!st || st.roundId !== expectedRound || st.winner) return;
            commitCpuCard(card, expectedRound);
          });
        } else {
          const nextIdx = advanceSoloIndex(s, 1);
          const nextSeat = s.seats[nextIdx];
          s.turn = 'busy';
          s.message = card
            ? `${cpuSeat.name} drew a card. ${nextSeat.name}'s turn.`
            : `Deck empty. ${nextSeat.name}'s turn.`;
          syncSoloToView(effs);
          scheduleSolo(650, () => {
            const st = soloRef.current;
            if (!st || st.roundId !== expectedRound || st.winner) return;
            st.turnIndex = nextIdx;
            st.turn = nextIdx === 0 ? 'host' : 'guest';
            syncSoloToView();
            if (nextSeat.isCpu) {
              scheduleSolo(650, () => runCpuTurn(expectedRound));
            }
          });
        }
        return;
      }

      commitCpuCard(chosen, expectedRound);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [recordSelfWin, scheduleSolo, syncSoloToView]
  );

  const handleSoloRizzResponse = useCallback(
    (accept: boolean, chosenCardUid?: number) => {
      const s = soloRef.current;
      if (!s || !s.pendingRizz || s.winner) return;
      const pending = s.pendingRizz;
      s.pendingRizz = null;
      setRizzBusyPromptId(null);
      setSelectedRizzCardUid(null);

      const expectedRound = s.roundId;
      const fromSeat = s.seats[pending.fromIndex];
      const selfSeat = s.seats[0];
      const effects: EffectEvent[] = [];

      if (accept && fromSeat && selfSeat.hand.length > 0) {
        const requestedIdx =
          typeof chosenCardUid === 'number'
            ? selfSeat.hand.findIndex((c) => c.uid === chosenCardUid)
            : -1;
        const pickIdx =
          requestedIdx !== -1 ? requestedIdx : Math.floor(Math.random() * selfSeat.hand.length);
        const [gifted] = selfSeat.hand.splice(pickIdx, 1);
        fromSeat.hand.push(gifted);
        effects.push({
          kind: 'rizz_line',
          fromName: fromSeat.name,
          targetName: selfSeat.name,
          line: pending.line,
          accepted: true,
          seatIndex: fromSeat.index,
          targetIndex: 0,
        });

        if (selfSeat.hand.length === 0) {
          endSoloRoundWithWinner(
            s,
            selfSeat,
            expectedRound,
            'You gifted your final card to Rizzler Arvin!',
            'You win by giving away your final card!',
            effects
          );
          return;
        }
        if (triggerSoloMercyKo(s, fromSeat, expectedRound, effects)) return;
        s.message = `You accepted Rizzler Arvin 👍 (+1 card to ${fromSeat.name})!`;
      } else {
        effects.push({
          kind: 'rizz_line',
          fromName: fromSeat?.name ?? 'CPU',
          targetName: selfSeat.name,
          line: pending.line,
          accepted: false,
          seatIndex: pending.fromIndex,
          targetIndex: 0,
        });
        s.message = 'You curved Rizzler Arvin 👎 — match continues!';
      }

      const nextIdx =
        s.seats[pending.nextTurnIndex] && !s.seats[pending.nextTurnIndex].eliminated
          ? pending.nextTurnIndex
          : advanceSoloIndex(s, 1);
      s.turn = 'busy';
      syncSoloToView(effects);
      scheduleSolo(650, () => {
        const st = soloRef.current;
        if (!st || st.roundId !== expectedRound || st.winner) return;
        st.turnIndex = nextIdx;
        const nextSeat = st.seats[nextIdx];
        st.turn = nextIdx === 0 ? 'host' : 'guest';
        st.message = `${nextSeat.name}'s turn (${st.currentColor}).`;
        syncSoloToView();
        if (nextSeat.isCpu) {
          scheduleSolo(650, () => runCpuTurn(expectedRound));
        }
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [runCpuTurn, scheduleSolo, syncSoloToView]
  );

  const resolveSoloSpecialPlay = (
    s: SoloInternalState,
    actor: SoloSeat,
    card: Card,
    chosenColor: SuitColor,
    expectedRound: number,
    effects: EffectEvent[],
    penalizedUno: boolean,
    scheduleNextTurn: (nextIdx: number, delayMs: number, nextMessage?: string) => void
  ): boolean => {
    const aliveSeats = s.seats.filter((seat) => !seat.eliminated);
    const aliveOpponents = aliveSeats.filter((seat) => seat.index !== actor.index);

    if (card.value === 'Rizzler Arvin') {
      const targetSeat =
        aliveOpponents.length > 0
          ? aliveOpponents[Math.floor(Math.random() * aliveOpponents.length)]
          : null;
      const line = RIZZ_PICKUP_LINES[Math.floor(Math.random() * RIZZ_PICKUP_LINES.length)];
      if (!targetSeat) {
        const nextIdx = advanceSoloIndex(s, 1);
        s.message = `${actor.name} played Rizzler Arvin!`;
        scheduleNextTurn(nextIdx, 700);
        return true;
      }
      if (targetSeat.index === 0) {
        s.pendingRizz = {
          promptId: `rizz-${expectedRound}-${Date.now()}`,
          fromIndex: actor.index,
          targetIndex: 0,
          line,
          nextTurnIndex: advanceSoloIndex(s, 1),
        };
        s.turn = 'busy';
        s.message = `${actor.name} hit you with Rizzler Arvin!`;
        effects.push({
          kind: 'rizz_line',
          fromName: actor.name,
          targetName: targetSeat.name,
          line,
          seatIndex: actor.index,
          targetIndex: 0,
        });
        syncSoloToView(effects);
        return true;
      }

      // Opponent is a CPU
      const accepted = targetSeat.hand.length > 0 && Math.random() < 0.45;
      if (accepted) {
        const pickIdx = Math.floor(Math.random() * targetSeat.hand.length);
        const [gifted] = targetSeat.hand.splice(pickIdx, 1);
        actor.hand.push(gifted);
        effects.push({
          kind: 'rizz_line',
          fromName: actor.name,
          targetName: targetSeat.name,
          line,
          accepted: true,
          seatIndex: actor.index,
          targetIndex: targetSeat.index,
        });
        if (targetSeat.hand.length === 0) {
          endSoloRoundWithWinner(
            s,
            targetSeat,
            expectedRound,
            `${targetSeat.name} accepted Rizzler Arvin 👍 and gave away its last card!`,
            `${targetSeat.name} wins!`,
            effects
          );
          return true;
        }
        if (triggerSoloMercyKo(s, actor, expectedRound, effects)) return true;
      } else {
        effects.push({
          kind: 'rizz_line',
          fromName: actor.name,
          targetName: targetSeat.name,
          line,
          accepted: false,
          seatIndex: actor.index,
          targetIndex: targetSeat.index,
        });
      }
      const nextIdx = advanceSoloIndex(s, 1);
      const nextSeat = s.seats[nextIdx];
      s.message = accepted
        ? `${targetSeat.name} loved Rizzler Arvin 👍 ("${line}") (+1 card)! ${nextSeat.name}'s turn.`
        : `${targetSeat.name} curved Rizzler Arvin 👎 ("${line}")! ${nextSeat.name}'s turn.`;
      scheduleNextTurn(nextIdx, 950);
      return true;
    }

    if (card.value === 'Rafath Kauwa') {
      const targetSeat =
        aliveOpponents.length > 0
          ? aliveOpponents[Math.floor(Math.random() * aliveOpponents.length)]
          : null;
      if (targetSeat) {
        effects.push({
          kind: 'crow_feathers',
          whoName: actor.name,
          targetName: targetSeat.name,
          seatIndex: actor.index,
          targetIndex: targetSeat.index,
        });
        if (actor.index === 0) {
          setDismissedPeekKey(null);
          s.peekTarget = {
            targetIndex: targetSeat.index,
            targetName: targetSeat.name,
            cards: [...targetSeat.hand],
            expiresAt: Date.now() + 7500,
          };
          scheduleSolo(7550, () => {
            const st = soloRef.current;
            if (!st || st.roundId !== expectedRound) return;
            if (st.peekTarget && Date.now() >= st.peekTarget.expiresAt) {
              st.peekTarget = null;
              syncSoloToView();
            }
          });
        }
      }
      const nextIdx = advanceSoloIndex(s, 1);
      const nextSeat = s.seats[nextIdx];
      s.message =
        actor.index === 0 && targetSeat
          ? `KAAAW! Peeking ${targetSeat.name}'s hand for 7.5s! ${nextSeat.name}'s turn.`
          : `KAAAW! ${actor.name} unleashed Rafath Kauwa! ${nextSeat.name}'s turn.`;
      scheduleNextTurn(nextIdx, 950);
      return true;
    }

    if (card.value === 'Gooner Surjo') {
      if (s.goonerSurjoUsed) {
        const nextIdx = advanceSoloIndex(s, 1);
        s.message = `Gooner Surjo already used this game!`;
        scheduleNextTurn(nextIdx, 700);
        return true;
      }
      s.goonerSurjoUsed = true;
      const targetSeat =
        aliveOpponents.length > 0
          ? aliveOpponents[Math.floor(Math.random() * aliveOpponents.length)]
          : null;
      if (targetSeat) {
        targetSeat.eliminated = true;
        recycleSoloHand(s, targetSeat.hand);
        effects.push({
          kind: 'surjo_ko',
          whoName: actor.name,
          targetName: targetSeat.name,
          isSelfLoser: targetSeat.index === 0,
          seatIndex: actor.index,
          targetIndex: targetSeat.index,
        });
        const remaining = s.seats.filter((seat) => !seat.eliminated);
        if (remaining.length <= 1 || targetSeat.index === 0) {
          const winnerSeat = targetSeat.index === 0 ? remaining[0] ?? actor : remaining[0] ?? actor;
          endSoloRoundWithWinner(
            s,
            winnerSeat,
            expectedRound,
            `GOONER SURJO! ${targetSeat.name} eliminated!`,
            `${winnerSeat.name} wins after Gooner Surjo eliminated ${targetSeat.name}!`,
            effects
          );
          return true;
        }
        const nextIdx = advanceSoloIndex(s, 1);
        const nextSeat = s.seats[nextIdx];
        s.message = `GOONER SURJO! ${targetSeat.name} eliminated! ${nextSeat.name}'s turn.`;
        scheduleNextTurn(nextIdx, 1050);
        return true;
      }
      const nextIdx = advanceSoloIndex(s, 1);
      scheduleNextTurn(nextIdx, 750);
      return true;
    }

    if (card.value === 'Toothpick Alif') {
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
        actor.hand.push(stolenCard);
        if (victimSeat.hand.length === 0) {
          const rep = drawSoloOne(s, victimSeat.hand);
          if (rep.reshuffled) effects.push({ kind: 'reshuffle' });
          if (rep.card) effects.push({ kind: 'seat_draw', seatIndex: victimSeat.index, count: 1 });
        }
        effects.push({
          kind: 'steal_power',
          thiefName: actor.name,
          victimName: victimSeat.name,
          stolenCard: actor.index === 0 || victimSeat.index === 0 ? stolenCard : undefined,
          thiefIndex: actor.index,
          victimIndex: victimSeat.index,
        });
        if (triggerSoloMercyKo(s, actor, expectedRound, effects)) return true;
        const nextIdx = advanceSoloIndex(s, 1);
        const nextSeat = s.seats[nextIdx];
        s.message = `TOOTHPICK ALIF! ${actor.name} stole ${
          actor.index === 0 || victimSeat.index === 0 ? stolenCard.value : 'a power card'
        } from ${victimSeat.name}! ${nextSeat.name}'s turn.`;
        scheduleNextTurn(nextIdx, 950);
        return true;
      }
      effects.push({
        kind: 'banner',
        text: 'NO POWER CARDS TO STEAL!',
        color: '#eab308',
        size: 0.6,
        dur: 1.0,
      });
      const nextIdx = advanceSoloIndex(s, 1);
      const nextSeat = s.seats[nextIdx];
      s.message =
        (penalizedUno ? 'Forgot UNO! ' : '') +
        `Toothpick Alif found no power cards (${chosenColor}). ${nextSeat.name}'s turn.`;
      scheduleNextTurn(nextIdx, 800);
      return true;
    }

    return false;
  };

  const commitCpuCard = useCallback(
    (card: Card, expectedRound: number) => {
      const s = soloRef.current;
      if (!s || s.roundId !== expectedRound || s.winner) return;
      const cpuSeat = s.seats[s.turnIndex];
      if (!cpuSeat || !cpuSeat.isCpu) return;
      const idx = cpuSeat.hand.findIndex((c) => c.uid === card.uid);
      if (idx === -1) return;

      cpuSeat.hand.splice(idx, 1);

      const effects: EffectEvent[] = [];
      const nextColor: SuitColor =
        card.color === 'Wild' ? chooseCpuWildColor(cpuSeat.hand, s.difficulty) : card.color;

      if (card.value === 'Dump' && card.color !== 'Wild') {
        const extras: Card[] = [];
        for (let i = cpuSeat.hand.length - 1; i >= 0; i--) {
          if (cpuSeat.hand[i].color === card.color) {
            const [matched] = cpuSeat.hand.splice(i, 1);
            extras.push(matched);
          }
        }
        s.discard.push(...extras);
        effects.push({
          kind: 'dump',
          whoName: cpuSeat.name,
          color: nextColor,
          count: extras.length + 1,
          seatIndex: cpuSeat.index,
        });
      }

      s.discard.push(card);
      s.currentColor = nextColor;
      effects.push({ kind: 'impact', card, activeColor: nextColor, seatIndex: cpuSeat.index });

      if (cpuSeat.hand.length === 0) {
        endSoloRoundWithWinner(
          s,
          cpuSeat,
          expectedRound,
          `${cpuSeat.name} played its last card!`,
          `${cpuSeat.name} wins this round.`,
          effects
        );
        return;
      }

      let cpuForgotUno = false;
      if (cpuSeat.hand.length === 1) {
        if (shouldCpuCallUno(s.difficulty)) {
          effects.push({ kind: 'uno', whoName: cpuSeat.name, isSelf: false, seatIndex: cpuSeat.index });
        } else {
          cpuForgotUno = true;
          for (let i = 0; i < 2; i++) {
            const res = drawSoloOne(s, cpuSeat.hand);
            if (res.reshuffled) effects.push({ kind: 'reshuffle' });
          }
          effects.push({ kind: 'uno_penalty', whoName: cpuSeat.name, isSelf: false, seatIndex: cpuSeat.index });
          effects.push({ kind: 'seat_draw', seatIndex: cpuSeat.index, count: 2 });
        }
      }

      const scheduleNextTurn = (nextIdx: number, delayMs: number, nextMessage?: string) => {
        s.turn = 'busy';
        syncSoloToView(effects);
        scheduleSolo(delayMs, () => {
          const st = soloRef.current;
          if (!st || st.roundId !== expectedRound || st.winner) return;
          st.turnIndex = nextIdx;
          const nextSeat = st.seats[nextIdx];
          st.turn = nextIdx === 0 ? 'host' : 'guest';
          if (nextMessage) st.message = nextMessage;
          syncSoloToView();
          if (nextSeat.isCpu) {
            scheduleSolo(700, () => runCpuTurn(expectedRound));
          }
        });
      };

      if (
        resolveSoloSpecialPlay(
          s,
          cpuSeat,
          card,
          nextColor,
          expectedRound,
          effects,
          cpuForgotUno,
          scheduleNextTurn
        )
      ) {
        return;
      }

      const aliveCount = s.seats.filter((seat) => !seat.eliminated).length;
      const drawAmount = getDrawAmount(card);

      if (drawAmount > 0) {
        if (isNoMercyRuleset(s.difficulty)) {
          s.pendingDrawStack += drawAmount;
          s.pendingDrawMin = drawAmount;
          const nextIdx = advanceSoloIndex(s, 1);
          const nextSeat = s.seats[nextIdx];
          s.message = `${cpuSeat.name} stacked ${card.value}! ${nextSeat.name}: stack +${drawAmount}+ or take +${s.pendingDrawStack}.`;
          scheduleNextTurn(nextIdx, 750);
        } else {
          const victimIdx = advanceSoloIndex(s, 1);
          const victimSeat = s.seats[victimIdx];
          for (let i = 0; i < drawAmount; i++) {
            const res = drawSoloOne(s, victimSeat.hand);
            if (res.reshuffled) effects.push({ kind: 'reshuffle' });
          }
          effects.push({ kind: 'seat_draw', seatIndex: victimSeat.index, count: drawAmount });
          const nextIdx = advanceSoloIndex(s, 2);
          const nextSeat = s.seats[nextIdx];
          s.message = `${cpuSeat.name} played ${card.value} — ${victimSeat.name} draws ${drawAmount}!`;
          scheduleNextTurn(
            nextIdx,
            950 + drawAmount * 80,
            `${nextSeat.name}'s turn — color is ${nextColor}.`
          );
        }
      } else if (card.value === 'Roulette') {
        const victimIdx = advanceSoloIndex(s, 1);
        const victimSeat = s.seats[victimIdx];
        const rRes = drawColorRoulette(s.deck, s.discard, victimSeat.hand, nextColor);
        if (s.goonerSurjoUsed) {
          for (let i = s.deck.length - 1; i >= 0; i--) {
            if (s.deck[i].value === 'Gooner Surjo') s.deck.splice(i, 1);
          }
          for (let i = victimSeat.hand.length - 1; i >= 0; i--) {
            if (victimSeat.hand[i].value === 'Gooner Surjo') {
              victimSeat.hand.splice(i, 1);
              drawSoloOne(s, victimSeat.hand);
            }
          }
        }
        if (rRes.reshuffled) effects.push({ kind: 'reshuffle' });
        effects.push({
          kind: 'roulette',
          whoName: victimSeat.name,
          color: nextColor,
          drawnCount: rRes.drawnCount,
          seatIndex: victimSeat.index,
        });
        if (rRes.drawnCount > 0) {
          effects.push({ kind: 'seat_draw', seatIndex: victimSeat.index, count: rRes.drawnCount });
        }

        if (triggerSoloMercyKo(s, victimSeat, expectedRound, effects)) return;

        const nextIdx = advanceSoloIndex(s, 2);
        const nextSeat = s.seats[nextIdx];
        s.message = `Color Roulette (${nextColor}) — ${victimSeat.name} drew ${rRes.drawnCount}!`;
        scheduleNextTurn(nextIdx, 1100, `${nextSeat.name}'s turn — color is ${nextColor}.`);
      } else if (card.value === 'Skip All') {
        s.message = `${cpuSeat.name} played Skip All — goes again!`;
        scheduleNextTurn(cpuSeat.index, 850);
      } else if (card.value === 'Skip') {
        const skippedSeat = s.seats[advanceSoloIndex(s, 1)];
        const nextIdx = advanceSoloIndex(s, 2);
        const nextSeat = s.seats[nextIdx];
        s.message = cpuForgotUno
          ? `${cpuSeat.name} forgot UNO (+2), skipped ${skippedSeat.name}!`
          : `${cpuSeat.name} skipped ${skippedSeat.name} — ${nextSeat.name}'s turn.`;
        scheduleNextTurn(nextIdx, 800);
      } else if (card.value === 'Reverse') {
        if (aliveCount <= 2) {
          s.message = cpuForgotUno
            ? `${cpuSeat.name} forgot UNO (+2), reversed back!`
            : `${cpuSeat.name} reversed — goes again!`;
          scheduleNextTurn(cpuSeat.index, 800);
        } else {
          s.direction = s.direction === 1 ? -1 : 1;
          const nextIdx = advanceSoloIndex(s, 1);
          const nextSeat = s.seats[nextIdx];
          s.message = `${cpuSeat.name} reversed direction — ${nextSeat.name}'s turn!`;
          scheduleNextTurn(nextIdx, 750);
        }
      } else {
        const nextIdx = advanceSoloIndex(s, 1);
        const nextSeat = s.seats[nextIdx];
        s.message = cpuForgotUno
          ? `${cpuSeat.name} forgot UNO (+2)! ${nextSeat.name}'s turn — ${nextColor}.`
          : cpuSeat.hand.length === 1
            ? `${cpuSeat.name} called UNO! ${nextSeat.name}'s turn — ${nextColor}.`
            : `${nextSeat.name}'s turn — color is ${nextColor}.`;
        scheduleNextTurn(nextIdx, 600);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [runCpuTurn, scheduleSolo, syncSoloToView]
  );

  const commitSoloPlayerCard = useCallback(
    (cardUid: number, chosenColor: SuitColor) => {
      const s = soloRef.current;
      if (!s || s.turn !== 'host' || s.winner) return;
      const selfSeat = s.seats[0];
      const idx = selfSeat.hand.findIndex((c) => c.uid === cardUid);
      if (idx === -1) return;

      const card = selfSeat.hand[idx];
      const expectedRound = s.roundId;
      const wasUnoArmed = selfSeat.unoArmed;
      selfSeat.unoArmed = false;

      selfSeat.hand.splice(idx, 1);

      const effects: EffectEvent[] = [];
      if (card.value === 'Dump' && card.color !== 'Wild') {
        const extras: Card[] = [];
        for (let i = selfSeat.hand.length - 1; i >= 0; i--) {
          if (selfSeat.hand[i].color === card.color) {
            const [matched] = selfSeat.hand.splice(i, 1);
            extras.push(matched);
          }
        }
        s.discard.push(...extras);
        effects.push({
          kind: 'dump',
          whoName: selfSeat.name,
          color: chosenColor,
          count: extras.length + 1,
          seatIndex: 0,
        });
      }

      s.discard.push(card);
      s.currentColor = chosenColor;
      s.drawnUid = null;
      effects.push({ kind: 'impact', card, activeColor: chosenColor, seatIndex: 0 });

      if (selfSeat.hand.length === 0) {
        endSoloRoundWithWinner(
          s,
          selfSeat,
          expectedRound,
          'Final card played!',
          'You win the round!',
          effects
        );
        return;
      }

      let penalizedUno = false;
      if (selfSeat.hand.length === 1) {
        if (wasUnoArmed) {
          effects.push({ kind: 'uno', whoName: selfSeat.name, isSelf: true });
        } else {
          penalizedUno = true;
          for (let i = 0; i < 2; i++) {
            const res = drawSoloOne(s, selfSeat.hand);
            if (res.reshuffled) effects.push({ kind: 'reshuffle' });
          }
          effects.push({ kind: 'uno_penalty', whoName: selfSeat.name, isSelf: true });
        }
      }

      const scheduleNextTurn = (nextIdx: number, delayMs: number, nextMessage?: string) => {
        s.turn = 'busy';
        syncSoloToView(effects);
        scheduleSolo(delayMs, () => {
          const st = soloRef.current;
          if (!st || st.roundId !== expectedRound || st.winner) return;
          st.turnIndex = nextIdx;
          const nextSeat = st.seats[nextIdx];
          st.turn = nextIdx === 0 ? 'host' : 'guest';
          if (nextMessage) st.message = nextMessage;
          syncSoloToView();
          if (nextSeat.isCpu) {
            scheduleSolo(750, () => runCpuTurn(expectedRound));
          }
        });
      };

      if (
        resolveSoloSpecialPlay(
          s,
          selfSeat,
          card,
          chosenColor,
          expectedRound,
          effects,
          penalizedUno,
          scheduleNextTurn
        )
      ) {
        return;
      }

      const aliveCount = s.seats.filter((seat) => !seat.eliminated).length;
      const drawAmount = getDrawAmount(card);

      if (drawAmount > 0) {
        if (isNoMercyRuleset(s.difficulty)) {
          s.pendingDrawStack += drawAmount;
          s.pendingDrawMin = drawAmount;
          const nextIdx = advanceSoloIndex(s, 1);
          const nextSeat = s.seats[nextIdx];
          s.message = penalizedUno
            ? `Forgot UNO (+2)! ${nextSeat.name} faces +${s.pendingDrawStack} stack...`
            : `You stacked ${card.value}! ${nextSeat.name} faces +${s.pendingDrawStack}...`;
          scheduleNextTurn(nextIdx, 800);
        } else {
          const victimIdx = advanceSoloIndex(s, 1);
          const victimSeat = s.seats[victimIdx];
          for (let i = 0; i < drawAmount; i++) {
            const res = drawSoloOne(s, victimSeat.hand);
            if (res.reshuffled) effects.push({ kind: 'reshuffle' });
          }
          effects.push({ kind: 'seat_draw', seatIndex: victimSeat.index, count: drawAmount });
          const nextIdx = advanceSoloIndex(s, 2);
          const nextSeat = s.seats[nextIdx];
          s.message = penalizedUno
            ? `Forgot UNO (+2)! ${victimSeat.name} draws ${drawAmount}!`
            : `${victimSeat.name} draws ${drawAmount}!`;
          scheduleNextTurn(
            nextIdx,
            950 + drawAmount * 80,
            nextIdx === 0 ? 'Your turn again!' : `${nextSeat.name}'s turn (${chosenColor}).`
          );
        }
      } else if (card.value === 'Roulette') {
        const victimIdx = advanceSoloIndex(s, 1);
        const victimSeat = s.seats[victimIdx];
        const rRes = drawColorRoulette(s.deck, s.discard, victimSeat.hand, chosenColor);
        if (s.goonerSurjoUsed) {
          for (let i = s.deck.length - 1; i >= 0; i--) {
            if (s.deck[i].value === 'Gooner Surjo') s.deck.splice(i, 1);
          }
          for (let i = victimSeat.hand.length - 1; i >= 0; i--) {
            if (victimSeat.hand[i].value === 'Gooner Surjo') {
              victimSeat.hand.splice(i, 1);
              drawSoloOne(s, victimSeat.hand);
            }
          }
        }
        if (rRes.reshuffled) effects.push({ kind: 'reshuffle' });
        effects.push({
          kind: 'roulette',
          whoName: victimSeat.name,
          color: chosenColor,
          drawnCount: rRes.drawnCount,
          seatIndex: victimSeat.index,
        });
        if (rRes.drawnCount > 0) {
          effects.push({ kind: 'seat_draw', seatIndex: victimSeat.index, count: rRes.drawnCount });
        }

        if (triggerSoloMercyKo(s, victimSeat, expectedRound, effects)) return;

        const nextIdx = advanceSoloIndex(s, 2);
        const nextSeat = s.seats[nextIdx];
        s.message = `Color Roulette (${chosenColor}) — ${victimSeat.name} drew ${rRes.drawnCount}!`;
        scheduleNextTurn(
          nextIdx,
          1050,
          nextIdx === 0 ? 'Your turn again!' : `${nextSeat.name}'s turn (${chosenColor}).`
        );
      } else if (card.value === 'Skip All') {
        s.message = penalizedUno ? 'Forgot UNO (+2)! Skip All — play again.' : 'Skip All — play again!';
        scheduleNextTurn(0, 800, 'Your turn again!');
      } else if (card.value === 'Skip') {
        const skippedSeat = s.seats[advanceSoloIndex(s, 1)];
        const nextIdx = advanceSoloIndex(s, 2);
        const nextSeat = s.seats[nextIdx];
        s.message = penalizedUno
          ? `Forgot UNO (+2)! ${skippedSeat.name} skipped.`
          : `${skippedSeat.name} skipped!`;
        scheduleNextTurn(
          nextIdx,
          800,
          nextIdx === 0 ? 'Your turn again!' : `${nextSeat.name}'s turn (${chosenColor}).`
        );
      } else if (card.value === 'Reverse') {
        if (aliveCount <= 2) {
          s.message = penalizedUno
            ? 'Forgot UNO (+2)! Reversed back — play again.'
            : 'Reversed — play again!';
          scheduleNextTurn(0, 800, 'Your turn again!');
        } else {
          s.direction = s.direction === 1 ? -1 : 1;
          const nextIdx = advanceSoloIndex(s, 1);
          const nextSeat = s.seats[nextIdx];
          s.message = penalizedUno
            ? `Forgot UNO (+2)! Direction reversed — ${nextSeat.name}'s turn.`
            : `Direction reversed — ${nextSeat.name}'s turn.`;
          scheduleNextTurn(nextIdx, 750);
        }
      } else {
        const nextIdx = advanceSoloIndex(s, 1);
        const nextSeat = s.seats[nextIdx];
        s.message = penalizedUno
          ? `Forgot UNO! +2 penalty cards. ${nextSeat.name}'s turn.`
          : `${nextSeat.name} is thinking...`;
        scheduleNextTurn(nextIdx, 750);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [recordSelfWin, runCpuTurn, scheduleSolo, syncSoloToView]
  );

  const sendWsAction = useCallback((action: ClientWsAction) => {
    const socket = socketRef.current;
    if (!socket || !socket.connected) return;
    const { type, ...payload } = action;
    socket.emit(type, payload);
  }, []);

  const clearJoinTimeout = useCallback(() => {
    if (joinTimeoutRef.current !== null) {
      window.clearTimeout(joinTimeoutRef.current);
      joinTimeoutRef.current = null;
    }
  }, []);

  const disconnectMultiplayer = useCallback(() => {
    clearJoinTimeout();
    if (socketRef.current) {
      const oldSocket = socketRef.current;
      socketRef.current = null;
      oldSocket.removeAllListeners();
      oldSocket.disconnect();
    }
    pendingEffectsRef.current = [];
    lastSyncedViewRef.current = null;
    clearMultiplayerSession();
    setRoomBusy(false);
    setWsStatus('idle');
    setNetworkError(null);
  }, [clearJoinTimeout]);

  const connectMultiplayer = useCallback(
    (targetRoomId: string, targetToken: string, joinName: string) => {
      clearJoinTimeout();
      if (socketRef.current) {
        const oldSocket = socketRef.current;
        socketRef.current = null;
        oldSocket.removeAllListeners();
        oldSocket.disconnect();
      }

      const cleanRoomId = targetRoomId.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      const cleanToken = targetToken.trim();
      activeJoinNameRef.current = joinName;
      saveMultiplayerSession({ roomId: cleanRoomId, token: cleanToken, name: joinName });

      let serverUrl: string | undefined;
      try {
        serverUrl = getSocketServerUrl();
      } catch (err) {
        setRoomBusy(false);
        setWsStatus('idle');
        setNetworkError(
          err instanceof Error
            ? err.message
            : 'Multiplayer server URL is not configured.'
        );
        return;
      }

      setWsStatus('connecting');
      const clientId = getOrCreateClientId(cleanRoomId);

      const socket = io(serverUrl, {
        transports: ['polling', 'websocket'],
        upgrade: true,
        reconnection: true,
        reconnectionAttempts: 20,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 20000,
      });
      socketRef.current = socket;
      let wokeBackend = false;
      let connectErrCount = 0;
      let receivedState = false;

      joinTimeoutRef.current = window.setTimeout(() => {
        if (socketRef.current !== socket || receivedState) return;
        setRoomBusy(false);
        setNetworkError(
          'Still waiting for the multiplayer room response. Check your connection or try joining again.'
        );
      }, 25000);

      socket.on('connect', () => {
        if (socketRef.current !== socket) return;
        connectErrCount = 0;
        setWsStatus('connected');
        setNetworkError(null);
        socket.emit(
          'join',
          {
            roomId: cleanRoomId,
            token: cleanToken,
            clientId,
            name: activeJoinNameRef.current,
          },
          (ack?: { ok?: boolean; error?: string }) => {
            if (socketRef.current !== socket) return;
            if (ack && ack.ok === false) {
              clearJoinTimeout();
              setRoomBusy(false);
              setNetworkError(ack.error || 'Could not join multiplayer room.');
              soundFx.playError();
            }
          }
        );
      });

      socket.on('state', (msg: { view: ClientGameView; effects: EffectEvent[] }) => {
        if (socketRef.current !== socket || !msg?.view) return;
        receivedState = true;
        clearJoinTimeout();
        if (typeof msg.view.serverNow === 'number') {
          clockOffsetRef.current = msg.view.serverNow - Date.now();
        }
        setRoomBusy(false);
        setStartingMatch(false);
        setVotingSeatIndex(null);
        setRizzBusyPromptId(null);
        setNetworkError(null);
        setMode('multiplayer');
        setMultiView(msg.view);
        setScreen(msg.view.turn === 'over' ? 'GAME_OVER' : 'PLAYING');
        if (msg.view.turn !== 'over') {
          setWinMilestone(null);
        }
        if (prevWaitingRef.current && msg.view.turn !== 'waiting') {
          setShowQrModal(false);
        }
        prevWaitingRef.current = msg.view.turn === 'waiting';
        const enrichedEffects = (msg.effects ?? []).map((eff) => {
          if (eff.kind === 'win' && eff.winnerRole === msg.view.selfRole) {
            const milestone = recordSelfWin(`mp-${msg.view.roomId}-${msg.view.roundId}`);
            return { ...eff, milestone };
          }
          if (eff.kind === 'win') {
            setWinMilestone(null);
          }
          return eff;
        });
        if (engineRef.current) {
          engineRef.current.syncView(msg.view, enrichedEffects);
          lastSyncedViewRef.current = msg.view;
          playSoundForEffects(enrichedEffects);
        } else if (enrichedEffects.length > 0) {
          pendingEffectsRef.current.push(...enrichedEffects);
        }
      });

      socket.on('game_error', (payload: { message?: string }) => {
        if (socketRef.current !== socket) return;
        clearJoinTimeout();
        setRoomBusy(false);
        setStartingMatch(false);
        setKickingSeatIndex(null);
        setVotingSeatIndex(null);
        setNetworkError(payload?.message || 'Multiplayer error.');
        soundFx.playError();
      });

      socket.on('kicked', (payload: { roomId?: string; message?: string }) => {
        if (socketRef.current !== socket) return;
        clearJoinTimeout();
        socketRef.current = null;
        socket.removeAllListeners();
        socket.disconnect();
        pendingEffectsRef.current = [];
        lastSyncedViewRef.current = null;
        clearMultiplayerSession();
        modeRef.current = 'solo';
        roomIdRef.current = null;
        roomTokenRef.current = null;
        setRoomId(null);
        setRoomToken(null);
        setMultiView(null);
        setShowQrModal(false);
        setShowPlayersModal(false);
        setPendingWildUid(null);
        setKickingSeatIndex(null);
        setVotingSeatIndex(null);
        setStartingMatch(false);
        setRoomBusy(false);
        setWsStatus('idle');
        setMode('solo');
        setInviteDismissed(true);
        if (window.location.search) {
          window.history.replaceState({}, '', window.location.pathname);
        }
        setScreen('TITLE_MENU');
        setNetworkError(payload?.message || 'You were removed from the room.');
        soundFx.playError();
      });

      socket.on('connect_error', (err) => {
        if (socketRef.current !== socket) return;
        connectErrCount += 1;
        setWsStatus('reconnecting');
        if (!wokeBackend) {
          wokeBackend = true;
          void wakeBackendServer();
        }
        if (!receivedState && connectErrCount >= 2) {
          setRoomBusy(false);
          const detail = err instanceof Error && err.message ? ` (${err.message})` : '';
          setNetworkError(`Connecting to multiplayer server${detail} — retrying...`);
        }
      });

      socket.on('disconnect', (reason) => {
        if (socketRef.current !== socket) return;
        const shouldStay =
          modeRef.current === 'multiplayer' &&
          roomIdRef.current?.toUpperCase() === cleanRoomId &&
          roomTokenRef.current === cleanToken;
        if (!shouldStay || reason === 'io client disconnect') {
          clearJoinTimeout();
          setWsStatus('idle');
          return;
        }
        setWsStatus('reconnecting');
      });

      socket.io.on('reconnect_attempt', () => {
        if (socketRef.current !== socket) return;
        setWsStatus('reconnecting');
      });

      socket.io.on('reconnect_failed', () => {
        if (socketRef.current !== socket) return;
        clearJoinTimeout();
        setRoomBusy(false);
        setWsStatus('idle');
        setNetworkError(
          'Unable to reach the multiplayer server right now. Check your connection or try again.'
        );
      });
    },
    [clearJoinTimeout, playSoundForEffects, recordSelfWin]
  );

  // Resume active multiplayer session on page reload (unless opening a new invite link)
  useEffect(() => {
    const saved = loadMultiplayerSession();
    if (!saved) return;
    if (isGuestInvite) {
      if (saved.roomId !== inviteRoomParam || saved.token !== inviteTokenParam) {
        return;
      }
    }
    modeRef.current = 'multiplayer';
    roomIdRef.current = saved.roomId;
    roomTokenRef.current = saved.token;
    prevWaitingRef.current = true;
    setRoomId(saved.roomId);
    setRoomToken(saved.token);
    setMode('multiplayer');
    connectMultiplayer(saved.roomId, saved.token, saved.name);
  }, [connectMultiplayer, inviteRoomParam, inviteTokenParam, isGuestInvite]);

  // Reconnect promptly when device regains network or tab returns to foreground
  useEffect(() => {
    const maybeReconnect = () => {
      if (document.visibilityState === 'hidden') return;
      if (modeRef.current !== 'multiplayer') return;
      const activeRoom = roomIdRef.current;
      const activeToken = roomTokenRef.current;
      if (!activeRoom || !activeToken) return;
      const socket = socketRef.current;
      if (!socket) {
        connectMultiplayer(activeRoom, activeToken, activeJoinNameRef.current);
      } else if (!socket.connected) {
        socket.connect();
      }
    };
    window.addEventListener('online', maybeReconnect);
    document.addEventListener('visibilitychange', maybeReconnect);
    return () => {
      window.removeEventListener('online', maybeReconnect);
      document.removeEventListener('visibilitychange', maybeReconnect);
    };
  }, [connectMultiplayer]);

  useEffect(() => {
    return () => {
      clearSoloTimers();
      clearJoinTimeout();
      if (socketRef.current) {
        const oldSocket = socketRef.current;
        socketRef.current = null;
        oldSocket.removeAllListeners();
        oldSocket.disconnect();
      }
    };
  }, [clearJoinTimeout, clearSoloTimers]);

  const handleHostMultiplayer = async () => {
    const cleanName = nameDraft.trim() || playerName;
    setPlayerName(cleanName);
    try {
      localStorage.setItem('puno-player-name', cleanName);
    } catch {
      // ignore
    }
    disconnectMultiplayer();
    setRoomBusy(true);
    setNetworkError(null);
    clearSoloTimers();
    try {
      const hostClientId = getOrCreateClientId('host');
      const res = await fetch(buildApiUrl('/api/rooms'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hostName: cleanName,
          difficulty,
          playerCount,
          hostClientId,
        }),
      });
      if (res.status === 404 || res.status === 405) {
        throw new Error('Multiplayer backend endpoint not found. Check VITE_BACKEND_URL.');
      }
      if (!res.ok) throw new Error('Could not create multiplayer room.');
      const data = (await res.json()) as { roomId: string; token: string };
      modeRef.current = 'multiplayer';
      roomIdRef.current = data.roomId;
      roomTokenRef.current = data.token;
      prevWaitingRef.current = true;
      setRoomId(data.roomId);
      setRoomToken(data.token);
      setMode('multiplayer');
      setShowQrModal(true);
      connectMultiplayer(data.roomId, data.token, cleanName);
    } catch (err) {
      setRoomBusy(false);
      setNetworkError(err instanceof Error ? err.message : 'Failed to create room.');
    }
  };

  const handleJoinByCode = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const cleanCode = joinCodeDraft.toUpperCase().replace(/[^A-Z0-9]/g, '').trim();
    if (cleanCode.length < 4) {
      setNetworkError('Enter the 6-character room code to join.');
      return;
    }
    const cleanName = nameDraft.trim() || playerName;
    setPlayerName(cleanName);
    try {
      localStorage.setItem('puno-player-name', cleanName);
    } catch {
      // ignore
    }
    disconnectMultiplayer();
    setRoomBusy(true);
    setNetworkError(null);
    clearSoloTimers();
    try {
      const clientId = getOrCreateClientId(cleanCode);
      const res = await fetch(buildApiUrl('/api/rooms/join'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId: cleanCode, clientId }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        roomId?: string;
        token?: string;
        error?: string;
      };
      if (!res.ok || !payload.roomId || !payload.token) {
        throw new Error(payload.error || 'Could not join room.');
      }
      modeRef.current = 'multiplayer';
      roomIdRef.current = payload.roomId;
      roomTokenRef.current = payload.token;
      prevWaitingRef.current = true;
      setRoomId(payload.roomId);
      setRoomToken(payload.token);
      setMode('multiplayer');
      setShowQrModal(false);
      connectMultiplayer(payload.roomId, payload.token, cleanName);
    } catch (err) {
      setRoomBusy(false);
      setNetworkError(err instanceof Error ? err.message : 'Failed to join room.');
    }
  };

  const handleJoinInvite = async () => {
    if (!inviteRoomParam || !inviteTokenParam) return;
    const cleanName = nameDraft.trim() || 'Player';
    setPlayerName(cleanName);
    try {
      localStorage.setItem('puno-player-name', cleanName);
    } catch {
      // ignore
    }
    disconnectMultiplayer();
    setRoomBusy(true);
    setNetworkError(null);
    clearSoloTimers();
    try {
      const clientId = getOrCreateClientId(inviteRoomParam);
      const res = await fetch(
        buildApiUrl(
          `/api/rooms/${encodeURIComponent(inviteRoomParam)}?token=${encodeURIComponent(
            inviteTokenParam
          )}&clientId=${encodeURIComponent(clientId)}`
        ),
        { method: 'GET', cache: 'no-store' }
      );
      const payload = (await res.json().catch(() => ({}))) as {
        roomId?: string;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(payload.error || 'Could not validate room invite.');
      }
      const verifiedRoomId = payload.roomId
        ? payload.roomId.trim().toUpperCase()
        : inviteRoomParam;
      modeRef.current = 'multiplayer';
      roomIdRef.current = verifiedRoomId;
      roomTokenRef.current = inviteTokenParam;
      prevWaitingRef.current = true;
      setMode('multiplayer');
      setRoomId(verifiedRoomId);
      setRoomToken(inviteTokenParam);
      setShowQrModal(false);
      connectMultiplayer(verifiedRoomId, inviteTokenParam, cleanName);
    } catch (err) {
      setRoomBusy(false);
      setNetworkError(err instanceof Error ? err.message : 'Failed to join invited room.');
    }
  };

  const handleCallUno = useCallback(() => {
    const view = activeView;
    if (!view || view.turn !== view.selfRole || pendingWildUid !== null) return;
    if (view.selfHand.length < 2 || view.selfUnoArmed) return;

    if (mode === 'multiplayer') {
      sendWsAction({ type: 'call_uno' });
      return;
    }

    const s = soloRef.current;
    if (!s || s.turn !== 'host') return;
    const selfSeat = s.seats[0];
    if (selfSeat.unoArmed) return;
    selfSeat.unoArmed = true;
    s.message = 'UNO armed! Play your card.';
    syncSoloToView([{ kind: 'uno', whoName: selfSeat.name, isSelf: true }]);
  }, [activeView, mode, pendingWildUid, sendWsAction, syncSoloToView]);

  const handleDrawOrPass = useCallback(() => {
    const view = activeView;
    if (!view || view.turn !== view.selfRole || pendingWildUid !== null) return;

    if (mode === 'multiplayer') {
      if (view.drawnUid !== null && view.pendingDrawStack === 0) {
        sendWsAction({ type: 'pass' });
      } else {
        soundFx.playDraw();
        sendWsAction({ type: 'draw' });
      }
      return;
    }

    const s = soloRef.current;
    if (!s || s.turn !== 'host') return;
    const selfSeat = s.seats[0];
    const expectedRound = s.roundId;
    selfSeat.unoArmed = false;

    if (s.pendingDrawStack > 0) {
      const stackCount = s.pendingDrawStack;
      const effs: EffectEvent[] = [];
      for (let i = 0; i < stackCount; i++) {
        const res = drawSoloOne(s, selfSeat.hand);
        if (res.reshuffled) effs.push({ kind: 'reshuffle' });
      }
      s.pendingDrawStack = 0;
      s.pendingDrawMin = 0;
      s.drawnUid = null;
      soundFx.playDraw();

      if (triggerSoloMercyKo(s, selfSeat, expectedRound, effs)) return;

      const nextIdx = advanceSoloIndex(s, 1);
      const nextSeat = s.seats[nextIdx];
      s.turnIndex = nextIdx;
      s.turn = nextIdx === 0 ? 'host' : 'guest';
      s.message = `You took +${stackCount} cards. ${nextSeat.name}'s turn.`;
      syncSoloToView(effs);
      if (nextSeat.isCpu) {
        scheduleSolo(850, () => runCpuTurn(expectedRound));
      }
      return;
    }

    if (s.drawnUid !== null) {
      s.drawnUid = null;
      const nextIdx = advanceSoloIndex(s, 1);
      const nextSeat = s.seats[nextIdx];
      s.turnIndex = nextIdx;
      s.turn = nextIdx === 0 ? 'host' : 'guest';
      s.message = `You passed. ${nextSeat.name}'s turn.`;
      syncSoloToView();
      if (nextSeat.isCpu) {
        scheduleSolo(850, () => runCpuTurn(expectedRound));
      }
      return;
    }

    const { card, reshuffled } = drawSoloOne(s, selfSeat.hand);
    const effects: EffectEvent[] = reshuffled ? [{ kind: 'reshuffle' }] : [];
    soundFx.playDraw();

    if (triggerSoloMercyKo(s, selfSeat, expectedRound, effects)) return;

    if (!card) {
      const nextIdx = advanceSoloIndex(s, 1);
      const nextSeat = s.seats[nextIdx];
      s.turnIndex = nextIdx;
      s.turn = nextIdx === 0 ? 'host' : 'guest';
      s.message = `No cards left to draw — ${nextSeat.name}'s turn.`;
      syncSoloToView(effects);
      if (nextSeat.isCpu) {
        scheduleSolo(850, () => runCpuTurn(expectedRound));
      }
      return;
    }

    s.drawnUid = card.uid;
    const top = s.discard[s.discard.length - 1];
    s.message = canPlayCard(card, top, s.currentColor)
      ? 'You drew a playable card — play it or pass.'
      : 'No match — pass your turn.';
    syncSoloToView(effects);
  }, [activeView, mode, pendingWildUid, runCpuTurn, scheduleSolo, sendWsAction, syncSoloToView]);

  const handleCardPlay = useCallback(
    (uid: number) => {
      const view = activeView;
      if (!view || view.turn !== view.selfRole || pendingWildUid !== null) return;
      const card = view.selfHand.find((c) => c.uid === uid);
      if (!card) return;

      if (view.drawnUid !== null && card.uid !== view.drawnUid) {
        engineRef.current?.wiggleCard(uid);
        soundFx.playError();
        if (mode === 'solo' && soloRef.current) {
          soloRef.current.message = 'Play the card you just drew, or pass.';
          syncSoloToView();
        }
        return;
      }

      const top = view.discardPile[view.discardPile.length - 1];
      if (!canPlayCard(card, top, view.currentColor, view.pendingDrawMin)) {
        engineRef.current?.wiggleCard(uid);
        soundFx.playError();
        if (mode === 'solo' && soloRef.current) {
          soloRef.current.message =
            view.pendingDrawMin > 0
              ? `Stack a +${view.pendingDrawMin} or higher card, or take +${view.pendingDrawStack}!`
              : "That card doesn't match the color or number.";
          syncSoloToView();
        }
        return;
      }

      if (card.color === 'Wild') {
        setPendingWildUid(uid);
        return;
      }

      if (mode === 'multiplayer') {
        sendWsAction({ type: 'play', uid, chosenColor: card.color });
      } else {
        commitSoloPlayerCard(uid, card.color);
      }
    },
    [activeView, commitSoloPlayerCard, mode, pendingWildUid, sendWsAction, syncSoloToView]
  );

  const handleWildColorSelect = useCallback(
    (color: SuitColor) => {
      if (pendingWildUid === null) return;
      const uid = pendingWildUid;
      setPendingWildUid(null);
      if (mode === 'multiplayer') {
        sendWsAction({ type: 'play', uid, chosenColor: color });
      } else {
        commitSoloPlayerCard(uid, color);
      }
    },
    [commitSoloPlayerCard, mode, pendingWildUid, sendWsAction]
  );

  const handleRestartRound = useCallback(() => {
    setPendingWildUid(null);
    if (mode === 'multiplayer') {
      sendWsAction({ type: 'restart', difficulty });
    } else {
      startSoloRound(playerName, true, difficulty, playerCount);
    }
  }, [difficulty, mode, playerCount, playerName, sendWsAction, startSoloRound]);

  useEffect(() => {
    if (screen === 'TITLE_MENU') {
      engineRef.current = null;
      lastSyncedViewRef.current = null;
      setHudTop(null);
      return;
    }
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const engine = new PunoCanvasEngine(canvas, themeId, (metrics) => {
      setHudTop(metrics.hudTop);
    });
    engineRef.current = engine;
    if (activeView) {
      const queued = pendingEffectsRef.current.splice(0);
      engine.syncView(activeView, queued);
      lastSyncedViewRef.current = activeView;
      if (queued.length > 0) {
        playSoundForEffects(queued);
      }
    }

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        engine.resize(width, height);
      }
    });
    observer.observe(container);

    let rafId = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      engine.step(dt);
      rafId = window.requestAnimationFrame(loop);
    };
    rafId = window.requestAnimationFrame(loop);

    return () => {
      window.cancelAnimationFrame(rafId);
      observer.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);

  useEffect(() => {
    if (activeView && engineRef.current && lastSyncedViewRef.current !== activeView) {
      const queued = pendingEffectsRef.current.splice(0);
      engineRef.current.syncView(activeView, queued);
      lastSyncedViewRef.current = activeView;
      if (queued.length > 0) {
        playSoundForEffects(queued);
      }
    }
  }, [activeView, playSoundForEffects]);

  const handleKickPlayer = useCallback((seatIndex: number) => {
    const socket = socketRef.current;
    if (!socket || !socket.connected) {
      setNetworkError('Not connected to the multiplayer server.');
      return;
    }
    setKickingSeatIndex(seatIndex);
    socket.emit(
      'kick_player',
      { seatIndex },
      (res?: { ok?: boolean; error?: string }) => {
        setKickingSeatIndex(null);
        if (res && res.ok === false && res.error) {
          setNetworkError(res.error);
          soundFx.playError();
        }
      }
    );
  }, []);

  const handleVoteKick = useCallback((seatIndex: number) => {
    const socket = socketRef.current;
    if (!socket || !socket.connected) {
      setNetworkError('Not connected to the multiplayer server.');
      return;
    }
    setVotingSeatIndex(seatIndex);
    socket.emit(
      'vote_kick',
      { seatIndex },
      (res?: { ok?: boolean; error?: string }) => {
        setVotingSeatIndex(null);
        if (res && res.ok === false && res.error) {
          setNetworkError(res.error);
          soundFx.playError();
        }
      }
    );
  }, []);

  const handleStartMultiplayerMatch = useCallback((fillCpus = false) => {
    const socket = socketRef.current;
    if (!socket || !socket.connected) {
      setNetworkError('Not connected to the multiplayer server.');
      return;
    }
    setStartingMatch(true);
    socket.emit(
      'start_now',
      { fillCpus },
      (res?: { ok?: boolean; error?: string }) => {
        setStartingMatch(false);
        if (res && res.ok === false && res.error) {
          setNetworkError(res.error);
          soundFx.playError();
        } else {
          setShowQrModal(false);
        }
      }
    );
  }, []);

  useEffect(() => {
    if (
      screen !== 'PLAYING' ||
      mode !== 'multiplayer' ||
      !activeView ||
      (activeView.turn !== 'host' && activeView.turn !== 'guest') ||
      typeof activeView.turnDeadlineAt !== 'number'
    ) {
      setTurnSecondsLeft(null);
      return;
    }
    const deadlineAt = activeView.turnDeadlineAt;
    const updateRemaining = () => {
      const serverNowEstimate = Date.now() + clockOffsetRef.current;
      const secs = Math.max(0, Math.ceil((deadlineAt - serverNowEstimate) / 1000));
      setTurnSecondsLeft(secs);
    };
    updateRemaining();
    const id = window.setInterval(updateRemaining, 200);
    return () => window.clearInterval(id);
  }, [activeView, mode, screen]);

  const activeRizzPromptId = activeView?.pendingRizzPrompt?.promptId ?? null;
  useEffect(() => {
    setSelectedRizzCardUid(null);
  }, [activeRizzPromptId]);

  const handleRizzPromptChoice = useCallback(
    (promptId: string, accept: boolean, cardUid?: number) => {
      setRizzBusyPromptId(promptId);
      if (mode === 'multiplayer') {
        sendWsAction({ type: 'rizz_response', promptId, accept, cardUid });
      } else {
        handleSoloRizzResponse(accept, cardUid);
      }
    },
    [handleSoloRizzResponse, mode, sendWsAction]
  );

  useEffect(() => {
    const peek = activeView?.peekTarget;
    if (screen !== 'PLAYING' || !peek) {
      setPeekSecondsLeft(0);
      return;
    }
    const updatePeek = () => {
      const serverNowEstimate = Date.now() + (mode === 'multiplayer' ? clockOffsetRef.current : 0);
      const secs = Math.max(0, (peek.expiresAt - serverNowEstimate) / 1000);
      setPeekSecondsLeft(secs);
    };
    updatePeek();
    const id = window.setInterval(updatePeek, 100);
    return () => window.clearInterval(id);
  }, [activeView?.peekTarget, mode, screen]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        showNameModal ||
        showQrModal ||
        showPlayersModal ||
        activeView?.pendingRizzPrompt ||
        screen === 'TITLE_MENU'
      )
        return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (pendingWildUid !== null) {
        const keyMap: Record<string, SuitColor> = {
          '1': 'Red',
          '2': 'Blue',
          '3': 'Green',
          '4': 'Yellow',
        };
        if (keyMap[e.key]) {
          e.preventDefault();
          handleWildColorSelect(keyMap[e.key]);
        }
        return;
      }

      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        if (screen === 'GAME_OVER') {
          handleRestartRound();
        } else if (activeView?.turn !== 'waiting') {
          handleDrawOrPass();
        }
      } else if (e.key === 'u' || e.key === 'U') {
        e.preventDefault();
        handleCallUno();
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        handleRestartRound();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    activeView?.pendingRizzPrompt,
    activeView?.turn,
    handleCallUno,
    handleDrawOrPass,
    handleRestartRound,
    handleWildColorSelect,
    pendingWildUid,
    screen,
    showNameModal,
    showPlayersModal,
    showQrModal,
  ]);

  const handleCanvasPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const engine = engineRef.current;
    const canvas = canvasRef.current;
    if (!engine || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const hit = engine.setPointer(e.clientX - rect.left, e.clientY - rect.top);
    if (hit !== pointerActive) setPointerActive(hit);
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const engine = engineRef.current;
    const canvas = canvasRef.current;
    if (
      !engine ||
      !canvas ||
      screen !== 'PLAYING' ||
      pendingWildUid !== null ||
      activeView?.turn === 'waiting'
    ) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const hit = engine.hitTest(e.clientX - rect.left, e.clientY - rect.top);
    if (!hit) return;
    if (hit.type === 'deck') {
      handleDrawOrPass();
    } else if (hit.type === 'card') {
      handleCardPlay(hit.uid);
    }
  };

  const handleSaveName = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = nameDraft.replace(/\s+/g, ' ').trim().slice(0, 18);
    if (!cleaned) return;
    setPlayerName(cleaned);
    try {
      localStorage.setItem('puno-player-name', cleaned);
    } catch {
      // ignore
    }
    setShowNameModal(false);

    if (mode === 'multiplayer') {
      sendWsAction({ type: 'rename', name: cleaned });
    } else if (screen !== 'TITLE_MENU') {
      if (soloRef.current) {
        soloRef.current.seats[0].name = cleaned;
      }
      if (cleaned.toLowerCase() === 'j4s1r' && playerName.toLowerCase() !== 'j4s1r') {
        startSoloRound(cleaned, true);
      } else if (soloRef.current) {
        soloRef.current.message = `Welcome, ${cleaned}!`;
        syncSoloToView([
          { kind: 'banner', text: 'WELCOME!', color: activeTheme.accent, size: 0.55, dur: 1.0, dy: -90 },
        ]);
      }
    }
  };

  const toggleMute = () => {
    const next = !muted;
    soundFx.muted = next;
    setMuted(next);
  };

  const inviteUrl = useMemo(() => {
    if (!roomId || !roomToken) return '';
    const cleanRoom = roomId.trim().toUpperCase();
    return `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(cleanRoom)}&token=${encodeURIComponent(roomToken.trim())}`;
  }, [roomId, roomToken]);

  const isMyTurn = Boolean(activeView && activeView.turn === activeView.selfRole);

  return (
    <div
      className="flex flex-col h-dvh w-screen overflow-hidden text-[#f4f4ed] transition-colors duration-300"
      style={{ backgroundColor: activeTheme.bgTop }}
    >
      {/* Top Bar */}
      <header
        className="flex items-center justify-between gap-4 sm:gap-8 px-4 sm:px-6 py-3 backdrop-blur-md border-b shrink-0 z-20 transition-colors duration-300"
        style={{
          backgroundColor: `${activeTheme.bgTop}e6`,
          borderColor: activeTheme.surfaceBorder,
        }}
      >
        <button
          type="button"
          onClick={() => {
            if (screen !== 'TITLE_MENU') {
              clearSoloTimers();
              disconnectMultiplayer();
              modeRef.current = 'solo';
              roomIdRef.current = null;
              roomTokenRef.current = null;
              setRoomId(null);
              setRoomToken(null);
              setMultiView(null);
              setMode('solo');
              setScreen('TITLE_MENU');
            }
          }}
          className="whitespace-nowrap shrink-0 hover:opacity-90 transition-opacity focus-visible:outline-2 focus-visible:outline-white rounded"
          aria-label="PUNO Home"
        >
          <PunoLogo theme={activeTheme} size="sm" />
        </button>

        {activeView && screen !== 'TITLE_MENU' ? (
          <div className="hidden md:flex items-center gap-3 text-sm text-[#9fb3b0] font-mono-tabular whitespace-nowrap overflow-hidden">
            <span className="text-[#f4f4ed] font-semibold truncate max-w-[120px]">
              {activeView.selfName}
            </span>
            {activeView.playerCount === 2 ? (
              <>
                <span className="text-base font-bold" style={{ color: activeTheme.accent }}>
                  {activeView.score.self} : {activeView.score.opponent}
                </span>
                <span className="text-[#f4f4ed] font-semibold truncate max-w-[120px]">
                  {activeView.opponentName}
                </span>
                <span aria-hidden="true">·</span>
                <span>{activeView.selfHand.length} in hand</span>
                <span aria-hidden="true">·</span>
                <span>{activeView.opponentCount} opponent</span>
              </>
            ) : (
              <>
                <span className="text-base font-bold" style={{ color: activeTheme.accent }}>
                  {activeView.score.self} {activeView.score.self === 1 ? 'win' : 'wins'}
                </span>
                <span aria-hidden="true">·</span>
                <span>{activeView.playerCount} Players</span>
                <span aria-hidden="true">·</span>
                <span>{activeView.selfHand.length} in hand</span>
              </>
            )}
            <span aria-hidden="true">·</span>
            <span
              className="font-semibold"
              style={{
                color:
                  DIFFICULTY_LIST.find((d) => d.id === activeView.difficulty)?.accent ??
                  activeTheme.accent,
              }}
            >
              {DIFFICULTY_LIST.find((d) => d.id === activeView.difficulty)?.label ?? 'Standard'}
            </span>
          </div>
        ) : (
          careerWins > 0 && (
            <div className="hidden sm:flex items-center gap-1.5 text-xs font-mono-tabular text-[#9fb3b0] whitespace-nowrap">
              <Trophy className="w-3.5 h-3.5" style={{ color: activeTheme.accent }} />
              <span>{careerWins} {careerWins === 1 ? 'win' : 'wins'}</span>
            </div>
          )
        )}

        <div className="flex items-center gap-2 shrink-0">
          {screen !== 'TITLE_MENU' && (
            <button
              type="button"
              onClick={cycleTheme}
              className="h-10 inline-flex items-center gap-1.5 px-3 rounded-xl text-xs sm:text-sm font-semibold text-[#d6e2e0] border transition-colors whitespace-nowrap shrink-0 hover:text-white focus-visible:outline-2 focus-visible:outline-white"
              style={{
                backgroundColor: activeTheme.surface,
                borderColor: activeTheme.surfaceBorder,
              }}
              title={`Theme: ${activeTheme.label}`}
              aria-label={`Switch theme, current ${activeTheme.label}`}
            >
              <Palette className="w-4 h-4" style={{ color: activeTheme.accent }} />
              <span className="hidden lg:inline">{activeTheme.label}</span>
            </button>
          )}

          <button
            type="button"
            onClick={toggleMute}
            className="h-10 w-10 inline-flex items-center justify-center rounded-xl text-[#d6e2e0] border transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-white"
            style={{
              backgroundColor: activeTheme.surface,
              borderColor: activeTheme.surfaceBorder,
            }}
            aria-label={muted ? 'Unmute sound effects' : 'Mute sound effects'}
            title={muted ? 'Unmute sound' : 'Mute sound'}
          >
            {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>

          {screen !== 'TITLE_MENU' && mode === 'multiplayer' && multiView && (() => {
            const activeKickVotes = multiView.seats.reduce(
              (sum, s) => sum + (s.kickVotes ?? 0),
              0
            );
            return (
              <button
                type="button"
                onClick={() => setShowPlayersModal(true)}
                className="h-10 inline-flex items-center gap-1.5 px-3 rounded-xl text-xs sm:text-sm font-semibold text-[#f4f4ed] border transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-white"
                style={{
                  backgroundColor: activeTheme.surface,
                  borderColor: activeKickVotes > 0 ? '#fb923c' : activeTheme.surfaceBorder,
                }}
                title="View room players, vote kick & manage seats"
                aria-label="Room players"
              >
                <Users className="w-4 h-4" style={{ color: activeTheme.accent }} />
                <span className="hidden sm:inline">Players</span>
                <span className="text-[11px] font-mono-tabular text-[#9fb3b0]">
                  {multiView.seats.filter((s) => s.isCpu || (s.occupied ?? s.connected)).length}/
                  {multiView.playerCount}
                </span>
                {activeKickVotes > 0 && (
                  <span className="text-[11px] font-bold text-[#fb923c]">· Vote</span>
                )}
              </button>
            );
          })()}

          {screen !== 'TITLE_MENU' && mode === 'multiplayer' && roomId && (
            <button
              type="button"
              onClick={() => setShowQrModal(true)}
              className="h-10 inline-flex items-center gap-1.5 px-3.5 rounded-xl text-xs sm:text-sm font-semibold text-[#f4f4ed] border transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-white"
              style={{
                backgroundColor: activeTheme.surface,
                borderColor: activeTheme.surfaceBorder,
              }}
            >
              <QrCode className="w-4 h-4" style={{ color: activeTheme.accent }} />
              <span className="hidden sm:inline">Invite</span>
            </button>
          )}

          {screen !== 'TITLE_MENU' && (
            <>
              <button
                type="button"
                onClick={() => {
                  setNameDraft(playerName);
                  setShowNameModal(true);
                }}
                className="h-10 inline-flex items-center gap-1.5 px-3.5 rounded-xl text-xs sm:text-sm font-semibold text-[#f4f4ed] border transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-white"
                style={{
                  backgroundColor: activeTheme.surface,
                  borderColor: activeTheme.surfaceBorder,
                }}
              >
                <User className="w-4 h-4 text-[#9fb3b0]" />
                <span className="max-w-[90px] truncate">{playerName}</span>
              </button>

              <button
                type="button"
                onClick={handleRestartRound}
                className="h-10 inline-flex items-center gap-1.5 px-4 rounded-xl text-[#151c27] text-xs sm:text-sm font-bold transition-opacity hover:opacity-90 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-white"
                style={{ backgroundColor: activeTheme.accent }}
              >
                <RotateCcw className="w-4 h-4" />
                <span>New Game</span>
              </button>
            </>
          )}
        </div>
      </header>

      {/* Main Stage */}
      <main className="relative flex-1 min-h-0 flex flex-col">
        {screen === 'TITLE_MENU' ? (
          <div className="relative flex-1 flex items-center justify-center px-4 py-6 sm:p-8 overflow-y-auto overflow-x-hidden">
            <HomeBackdrop theme={activeTheme} />
            <div className="relative z-10 w-full max-w-4xl grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
              {/* Left Brand & Animated Card Fan */}
              <div className="hidden lg:flex lg:col-span-5 flex-col items-center text-center">
                <PunoLogo theme={activeTheme} size="lg" />
                <p className="mt-3 text-sm text-[#c7d4d2]">
                  {isGuestInvite
                    ? `Invited to Room ${inviteRoomParam}`
                    : '2 to 10 players · Solo or QR Room'}
                </p>

                <div className="relative w-72 h-72 mt-4 flex items-center justify-center">
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 36, repeat: Infinity, ease: 'linear' }}
                    className="absolute inset-1 rounded-full border border-dashed opacity-45"
                    style={{ borderColor: activeTheme.accent }}
                  />
                  <motion.div
                    animate={{ scale: [1, 1.03, 1], opacity: [0.88, 1, 0.88] }}
                    transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
                    className="absolute inset-4 rounded-full border-2 shadow-2xl"
                    style={{
                      background: `radial-gradient(circle at 40% 35%, ${activeTheme.feltCenter}, ${activeTheme.feltEdge})`,
                      borderColor: activeTheme.railTrim,
                    }}
                  />
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={`${themeId}-${difficulty === 'bomboclatt' ? 'bm' : difficulty === 'no_mercy' ? 'nm' : 'std'}`}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      transition={{ duration: 0.2 }}
                      className="relative flex items-center justify-center w-full h-full"
                    >
                      <ShowcaseCard
                        theme={activeTheme}
                        suit="Blue"
                        label={
                          difficulty === 'bomboclatt'
                            ? 'Gooner Surjo'
                            : difficulty === 'no_mercy'
                              ? '⊘⊘'
                              : '7'
                        }
                        rotate={-16}
                        xOffset={-56}
                        yOffset={10}
                        zIndex={1}
                        floatDelay={0}
                      />
                      <ShowcaseCard
                        theme={activeTheme}
                        suit="Red"
                        label={
                          difficulty === 'bomboclatt'
                            ? 'Rizzler Arvin'
                            : difficulty === 'no_mercy'
                              ? 'ALL'
                              : '+2'
                        }
                        rotate={0}
                        xOffset={0}
                        yOffset={-8}
                        zIndex={2}
                        floatDelay={0.5}
                      />
                      <ShowcaseCard
                        theme={activeTheme}
                        suit="Wild"
                        label={
                          difficulty === 'bomboclatt'
                            ? 'Rafath Kauwa'
                            : difficulty === 'no_mercy'
                              ? '+10'
                              : '+4'
                        }
                        rotate={16}
                        xOffset={56}
                        yOffset={10}
                        zIndex={3}
                        floatDelay={1.0}
                      />
                    </motion.div>
                  </AnimatePresence>
                </div>
              </div>

              {/* Right Clean Setup Card */}
              <div className="lg:col-span-7 w-full max-w-md mx-auto lg:max-w-none">
                <div className="lg:hidden flex flex-col items-center text-center mb-5">
                  <PunoLogo theme={activeTheme} size="md" />
                  <p className="mt-2.5 text-xs text-[#c7d4d2]">
                    {isGuestInvite
                      ? `Room ${inviteRoomParam} invite`
                      : '2 to 10 players · Solo or QR Room'}
                  </p>
                </div>

                <motion.div
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
                  className="w-full rounded-2xl p-6 sm:p-7 shadow-2xl border backdrop-blur-md space-y-5"
                  style={{
                    backgroundColor: `${activeTheme.surface}e8`,
                    borderColor: activeTheme.surfaceBorder,
                  }}
                >
                  {/* Display Name */}
                  <div className="relative">
                    <User className="w-4 h-4 text-[#8ea5a2] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      id="player-name-input"
                      aria-label="Your display name"
                      type="text"
                      maxLength={18}
                      value={nameDraft}
                      onChange={(e) => setNameDraft(e.target.value)}
                      placeholder="Your name"
                      className="w-full h-11 pl-10 pr-4 rounded-xl bg-black/25 border text-[#f4f4ed] text-sm font-medium placeholder:text-[#7e9491] focus:outline-none focus:border-white/40 transition-colors"
                      style={{ borderColor: activeTheme.surfaceBorder }}
                    />
                  </div>

                  {/* Table Theme (Single Clean Dot Row) */}
                  <div className="flex items-center justify-between gap-4 py-1">
                    <div className="text-xs">
                      <span className="text-[#9fb3b0] font-medium">Table</span>
                      <span className="mx-1.5 text-[#5b716e]">·</span>
                      <span className="font-semibold text-[#f4f4ed]">{activeTheme.label}</span>
                    </div>
                    <div className="flex items-center gap-2" role="radiogroup" aria-label="Table theme">
                      {THEME_LIST.map((t) => {
                        const selected = t.id === themeId;
                        return (
                          <button
                            key={t.id}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            aria-label={t.label}
                            title={t.label}
                            onClick={() => selectTheme(t.id)}
                            className={`w-6 h-6 rounded-full border-2 transition-transform focus-visible:outline-2 focus-visible:outline-white ${
                              selected ? 'scale-110 shadow-md' : 'opacity-70 hover:opacity-100 hover:scale-105'
                            }`}
                            style={{
                              backgroundColor: t.feltCenter,
                              borderColor: selected ? t.accent : t.railTrim,
                              boxShadow: selected ? `0 0 0 2px ${t.accent}44` : undefined,
                            }}
                          />
                        );
                      })}
                    </div>
                  </div>

                  {/* Player Count Slider (2-10 Players) */}
                  {!isGuestInvite && (() => {
                    const sliderPct = ((playerCount - MIN_PLAYERS) / (MAX_PLAYERS - MIN_PLAYERS)) * 100;
                    return (
                      <div className="pt-1 border-t" style={{ borderColor: `${activeTheme.surfaceBorder}99` }}>
                        <div className="flex items-center justify-between text-xs pt-4 mb-2.5">
                          <label htmlFor="player-count-slider" className="font-medium text-[#9fb3b0]">
                            Players
                          </label>
                          <span
                            className="font-bold font-mono-tabular"
                            style={{ color: activeTheme.accent }}
                          >
                            {playerCount} {playerCount === 2 ? '· 1v1' : `· You + ${playerCount - 1}`}
                          </span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-[11px] font-mono-tabular text-[#809794] w-3 text-center">
                            {MIN_PLAYERS}
                          </span>
                          <input
                            id="player-count-slider"
                            type="range"
                            min={MIN_PLAYERS}
                            max={MAX_PLAYERS}
                            step={1}
                            value={playerCount}
                            onChange={(e) => selectPlayerCount(Number(e.target.value))}
                            aria-label="Number of players from 2 to 10"
                            className="puno-slider flex-1 cursor-pointer"
                            style={
                              {
                                '--slider-accent': activeTheme.accent,
                                background: `linear-gradient(to right, ${activeTheme.accent} 0%, ${activeTheme.accent} ${sliderPct}%, rgba(255,255,255,0.14) ${sliderPct}%, rgba(255,255,255,0.14) 100%)`,
                              } as CSSProperties
                            }
                          />
                          <span className="text-[11px] font-mono-tabular text-[#809794] w-4 text-center">
                            {MAX_PLAYERS}
                          </span>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Difficulty Segmented Control */}
                  {!isGuestInvite && (
                    <div className="pt-1 border-t" style={{ borderColor: `${activeTheme.surfaceBorder}99` }}>
                      <div className="flex items-center justify-between text-xs pt-4 mb-2.5">
                        <span className="font-medium text-[#9fb3b0]">Difficulty</span>
                        <span
                          className="font-bold inline-flex items-center gap-1"
                          style={{ color: activeDifficulty.accent }}
                        >
                          {difficulty === 'no_mercy' && <Skull className="w-3.5 h-3.5" />}
                          {difficulty === 'bomboclatt' && <Zap className="w-3.5 h-3.5" />}
                          <span>{activeDifficulty.tier}</span>
                        </span>
                      </div>

                      <div
                        className="grid grid-cols-2 sm:grid-cols-4 gap-1 p-1 rounded-xl border bg-black/25"
                        style={{ borderColor: activeTheme.surfaceBorder }}
                        role="radiogroup"
                        aria-label="Difficulty level"
                      >
                        {DIFFICULTY_LIST.map((d) => {
                          const selected = d.id === difficulty;
                          return (
                            <button
                              key={d.id}
                              type="button"
                              role="radio"
                              aria-checked={selected}
                              onClick={() => selectDifficulty(d.id)}
                              className={`h-9 rounded-lg text-[11px] sm:text-xs font-bold transition-all whitespace-nowrap px-2 focus-visible:outline-2 focus-visible:outline-white ${
                                selected ? 'text-[#10141e] shadow-sm' : 'text-[#b8cac8] hover:text-white'
                              }`}
                              style={selected ? { backgroundColor: d.accent } : undefined}
                            >
                              {d.label}
                            </button>
                          );
                        })}
                      </div>

                      <p className="mt-2 text-[11px] text-[#9fb3b0] leading-snug">
                        {activeDifficulty.summary}
                      </p>
                    </div>
                  )}

                  {networkError ? (
                    <div className="rounded-xl bg-[#ee3f4f]/15 border border-[#ee3f4f]/50 px-4 py-2.5 text-xs text-[#ffb4bc]">
                      {networkError}
                    </div>
                  ) : mode === 'multiplayer' && (wsStatus === 'connecting' || wsStatus === 'reconnecting') ? (
                    <div
                      className="rounded-xl border px-4 py-2.5 text-xs text-[#f4f4ed] inline-flex items-center gap-2 w-full"
                      style={{
                        backgroundColor: 'rgba(255,255,255,0.05)',
                        borderColor: activeTheme.surfaceBorder,
                      }}
                    >
                      <Wifi className="w-3.5 h-3.5 animate-pulse shrink-0" style={{ color: activeTheme.accent }} />
                      <span>
                        {wsStatus === 'reconnecting'
                          ? 'Connecting to multiplayer server...'
                          : 'Joining multiplayer room...'}
                      </span>
                    </div>
                  ) : null}

                  {/* Play Actions */}
                  {isGuestInvite ? (
                    <div className="flex flex-col sm:flex-row gap-3 pt-1">
                      <motion.button
                        whileHover={{ scale: roomBusy ? 1 : 1.02 }}
                        whileTap={{ scale: roomBusy ? 1 : 0.98 }}
                        type="button"
                        disabled={roomBusy}
                        onClick={handleJoinInvite}
                        className="flex-1 h-12 px-6 rounded-xl text-[#151c27] font-bold text-sm transition-opacity hover:opacity-90 disabled:opacity-60 whitespace-nowrap focus-visible:outline-2 focus-visible:outline-white"
                        style={{ backgroundColor: activeTheme.accent }}
                      >
                        {roomBusy ? 'Joining Match...' : 'Join Match'}
                      </motion.button>
                      <motion.button
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        type="button"
                        onClick={() => {
                          window.history.replaceState({}, '', window.location.pathname);
                          startSoloRound(nameDraft, false);
                        }}
                        className="h-12 px-5 rounded-xl text-[#f4f4ed] border font-semibold text-sm transition-colors hover:bg-white/5 whitespace-nowrap focus-visible:outline-2 focus-visible:outline-white"
                        style={{
                          backgroundColor: 'rgba(255,255,255,0.04)',
                          borderColor: activeTheme.surfaceBorder,
                        }}
                      >
                        Solo vs CPU
                      </motion.button>
                    </div>
                  ) : (
                    <div className="space-y-3 pt-1">
                      <div className="flex flex-col sm:flex-row gap-3">
                        <motion.button
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          type="button"
                          onClick={() => {
                            const cleaned = nameDraft.trim() || 'Player';
                            setPlayerName(cleaned);
                            try {
                              localStorage.setItem('puno-player-name', cleaned);
                            } catch {
                              // ignore
                            }
                            startSoloRound(cleaned, false);
                          }}
                          className="flex-1 h-12 px-6 rounded-xl text-[#151c27] font-bold text-sm transition-opacity hover:opacity-90 whitespace-nowrap focus-visible:outline-2 focus-visible:outline-white"
                          style={{ backgroundColor: activeTheme.accent }}
                        >
                          {playerCount === 2 ? 'Play vs CPU' : `Play vs ${playerCount - 1} CPUs`}
                        </motion.button>
                        <motion.button
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          type="button"
                          disabled={roomBusy}
                          onClick={handleHostMultiplayer}
                          className="h-12 inline-flex items-center justify-center gap-2 px-5 rounded-xl disabled:opacity-50 text-[#f4f4ed] border font-semibold text-sm transition-colors hover:bg-white/5 whitespace-nowrap focus-visible:outline-2 focus-visible:outline-white"
                          style={{
                            backgroundColor: 'rgba(255,255,255,0.04)',
                            borderColor: activeTheme.surfaceBorder,
                          }}
                        >
                          <Users className="w-4 h-4" style={{ color: activeTheme.accent }} />
                          <span>{roomBusy ? 'Creating...' : `Create ${playerCount}P Room`}</span>
                        </motion.button>
                      </div>

                      <form onSubmit={handleJoinByCode} className="flex items-center gap-2">
                        <input
                          type="text"
                          maxLength={10}
                          value={joinCodeDraft}
                          onChange={(e) =>
                            setJoinCodeDraft(
                              e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '')
                            )
                          }
                          placeholder="Room code (e.g. K7M9P2)"
                          aria-label="Enter room code to join"
                          className="flex-1 h-10 px-3.5 rounded-xl bg-black/25 border text-[#f4f4ed] text-xs font-mono-tabular tracking-[0.14em] uppercase placeholder:tracking-normal placeholder:normal-case placeholder:font-sans placeholder:text-[#7e9491] focus:outline-none focus:border-white/40 transition-colors"
                          style={{ borderColor: activeTheme.surfaceBorder }}
                        />
                        <button
                          type="submit"
                          disabled={roomBusy || joinCodeDraft.trim().length < 4}
                          className="h-10 px-4 rounded-xl text-xs font-bold text-[#f4f4ed] border disabled:opacity-45 hover:bg-white/10 transition-colors whitespace-nowrap focus-visible:outline-2 focus-visible:outline-white"
                          style={{
                            backgroundColor: 'rgba(255,255,255,0.06)',
                            borderColor: activeTheme.surfaceBorder,
                          }}
                        >
                          {roomBusy ? 'Joining...' : 'Join Code'}
                        </button>
                      </form>
                    </div>
                  )}
                </motion.div>
              </div>
            </div>
          </div>
        ) : (
          <div ref={containerRef} className="relative flex-1 min-h-0 w-full">
            <canvas
              ref={canvasRef}
              onPointerMove={handleCanvasPointerMove}
              onPointerLeave={() => {
                engineRef.current?.clearPointer();
                if (pointerActive) setPointerActive(false);
              }}
              onClick={handleCanvasClick}
              className={`block w-full h-full touch-manipulation ${pointerActive ? 'cursor-pointer' : 'cursor-default'}`}
            />

            {activeView && activeView.playerCount === 2 && (
              <div className="pointer-events-none absolute top-3 left-3 sm:top-5 sm:left-5 flex items-center gap-3">
                <div
                  className="h-10 w-10 rounded-full flex items-center justify-center font-display font-bold text-base border-2 transition-colors"
                  style={{
                    backgroundColor:
                      activeView.turn !== activeView.selfRole && activeView.turn !== 'over'
                        ? 'rgba(238, 63, 79, 0.28)'
                        : `${activeTheme.surface}e6`,
                    borderColor:
                      activeView.turn !== activeView.selfRole && activeView.turn !== 'over'
                        ? activeTheme.accent
                        : activeTheme.surfaceBorder,
                  }}
                >
                  {activeView.opponentName.charAt(0).toUpperCase()}
                </div>
                <div className="leading-tight">
                  <div className="text-sm font-semibold text-[#f4f4ed] flex items-center gap-2">
                    <span>{activeView.opponentName}</span>
                    {activeView.opponentCount === 1 && (
                      <span className="text-xs font-bold" style={{ color: activeTheme.accent }}>
                        UNO!
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-[#9fb3b0] font-mono-tabular">
                    {activeView.opponentCount} card{activeView.opponentCount === 1 ? '' : 's'}
                    {(() => {
                      const limit = getHandLimit(activeView.difficulty);
                      const warn = limit ? Math.ceil(limit * 0.64) : 0;
                      return limit !== null && activeView.opponentCount >= warn ? (
                        <span className="ml-1.5 font-bold text-[#f43f5e]">
                          ({activeView.opponentCount}/{limit} KO)
                        </span>
                      ) : null;
                    })()}
                    {mode === 'multiplayer' && !activeView.opponentConnected ? ' · waiting' : ''}
                  </div>
                </div>
              </div>
            )}

            {activeView && (
              <div className="md:hidden pointer-events-none absolute top-4 right-4 text-xs font-mono-tabular text-[#d6e2e0]">
                <span className="font-bold" style={{ color: activeTheme.accent }}>
                  {activeView.score.self} : {activeView.score.opponent}
                </span>
              </div>
            )}

            {activeView && (
              <div className="pointer-events-none absolute bottom-4 left-3 sm:bottom-6 sm:left-5 hidden sm:flex items-center gap-3">
                <div
                  className="h-10 w-10 rounded-full flex items-center justify-center font-display font-bold text-base border-2 transition-colors"
                  style={{
                    backgroundColor: isMyTurn
                      ? 'rgba(47, 134, 240, 0.28)'
                      : `${activeTheme.surface}e6`,
                    borderColor: isMyTurn ? activeTheme.accent : activeTheme.surfaceBorder,
                  }}
                >
                  {activeView.selfName.charAt(0).toUpperCase()}
                </div>
                <div className="leading-tight">
                  <div className="text-sm font-semibold text-[#f4f4ed] flex items-center gap-2">
                    <span>{activeView.selfName}</span>
                    {activeView.selfHand.length === 1 && (
                      <span className="text-xs font-bold" style={{ color: activeTheme.accent }}>
                        UNO!
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-[#9fb3b0] font-mono-tabular">
                    {activeView.selfHand.length} card{activeView.selfHand.length === 1 ? '' : 's'}
                    {(() => {
                      const limit = getHandLimit(activeView.difficulty);
                      const warn = limit ? Math.ceil(limit * 0.64) : 0;
                      return limit !== null && activeView.selfHand.length >= warn ? (
                        <span className="ml-1.5 font-bold text-[#f43f5e]">
                          ({activeView.selfHand.length}/{limit} KO)
                        </span>
                      ) : null;
                    })()}
                  </div>
                </div>
              </div>
            )}

            {activeView && screen === 'PLAYING' && (() => {
              const isWaitingLobby = mode === 'multiplayer' && activeView.turn === 'waiting';
              const activeHostIndex = activeView.hostIndex ?? 0;
              const isRoomHost = activeView.selfIndex === activeHostIndex;
              const hostSeatName = activeView.seats[activeHostIndex]?.name ?? 'Host';
              const readySeatsCount = activeView.seats.filter(
                (s) => s.isCpu || (s.occupied ?? s.connected)
              ).length;
              const hasOpenSeats = readySeatsCount < activeView.playerCount;

              if (isWaitingLobby) {
                return (
                  <div
                    className={`pointer-events-none absolute inset-x-0 flex flex-col items-center gap-2 px-4 z-10 ${
                      hudTop === null ? 'bottom-[152px] sm:bottom-[178px]' : ''
                    }`}
                    style={hudTop !== null ? { top: `${hudTop}px` } : undefined}
                  >
                    <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-2">
                      {isRoomHost ? (
                        <>
                          <motion.button
                            whileHover={readySeatsCount >= 2 && !startingMatch ? { scale: 1.04 } : undefined}
                            whileTap={readySeatsCount >= 2 && !startingMatch ? { scale: 0.96 } : undefined}
                            type="button"
                            disabled={readySeatsCount < 2 || startingMatch}
                            onClick={() => handleStartMultiplayerMatch(false)}
                            className="h-10 sm:h-11 px-5 rounded-xl text-[#151c27] text-xs sm:text-sm font-extrabold shadow-lg transition-opacity hover:opacity-90 disabled:opacity-45 whitespace-nowrap inline-flex items-center gap-2 focus-visible:outline-2 focus-visible:outline-white"
                            style={{ backgroundColor: activeTheme.accent }}
                          >
                            <Play className="w-4 h-4 fill-current" />
                            <span>
                              {startingMatch
                                ? 'Starting...'
                                : readySeatsCount >= 2 && hasOpenSeats
                                  ? `Start Game (${readySeatsCount} Players)`
                                  : 'Start Game'}
                            </span>
                          </motion.button>
                          {hasOpenSeats && (
                            <motion.button
                              whileHover={!startingMatch ? { scale: 1.03 } : undefined}
                              whileTap={!startingMatch ? { scale: 0.97 } : undefined}
                              type="button"
                              disabled={startingMatch}
                              onClick={() => handleStartMultiplayerMatch(true)}
                              className="h-10 sm:h-11 px-4 rounded-xl text-xs sm:text-sm font-bold text-[#f4f4ed] border hover:bg-white/10 transition-colors disabled:opacity-45 whitespace-nowrap inline-flex items-center gap-1.5 focus-visible:outline-2 focus-visible:outline-white"
                              style={{
                                backgroundColor: `${activeTheme.surface}eb`,
                                borderColor: activeTheme.surfaceBorder,
                              }}
                            >
                              <Users className="w-4 h-4" style={{ color: activeTheme.accent }} />
                              <span>Start with CPUs</span>
                            </motion.button>
                          )}
                        </>
                      ) : (
                        <div
                          className="h-10 px-4 rounded-xl border text-xs sm:text-sm font-bold text-[#f4f4ed] inline-flex items-center gap-2 shadow-md backdrop-blur-sm"
                          style={{
                            backgroundColor: `${activeTheme.surface}e6`,
                            borderColor: activeTheme.accent,
                          }}
                        >
                          <Clock className="w-4 h-4" style={{ color: activeTheme.accent }} />
                          <span>
                            Waiting for {hostSeatName} to start ({readySeatsCount}/{activeView.playerCount})
                          </span>
                        </div>
                      )}
                    </div>

                    <div
                      className="pointer-events-auto px-3.5 py-1.5 rounded-xl border text-xs sm:text-sm font-medium text-[#e6eeec] text-center max-w-md shadow-md backdrop-blur-sm inline-flex items-center gap-2"
                      style={{
                        backgroundColor: `${activeTheme.surface}e0`,
                        borderColor: activeTheme.surfaceBorder,
                      }}
                    >
                      <span>{networkError || activeView.message}</span>
                    </div>
                  </div>
                );
              }

              const hasStack = activeView.pendingDrawStack > 0;
              const mustCallUno =
                isMyTurn &&
                activeView.selfHand.length === 2 &&
                !activeView.selfUnoArmed &&
                !hasStack;
              const canPressUno =
                isMyTurn &&
                pendingWildUid === null &&
                !activeView.selfUnoArmed &&
                (activeView.selfHand.length === 2 ||
                  (isNoMercyRuleset(activeView.difficulty) &&
                    activeView.selfHand.length >= 2 &&
                    activeView.selfHand.some((c) => c.value === 'Dump')));
              const isLowTime = turnSecondsLeft !== null && turnSecondsLeft <= 5;
              const isWarnTime = turnSecondsLeft !== null && turnSecondsLeft <= 10 && !isLowTime;

              return (
                <>
                  <div
                    className={`pointer-events-none absolute inset-x-0 flex flex-col items-center gap-1.5 px-4 ${
                      hudTop === null ? 'bottom-[152px] sm:bottom-[178px]' : ''
                    }`}
                    style={hudTop !== null ? { top: `${hudTop}px` } : undefined}
                  >
                    <div className="pointer-events-auto flex items-center justify-center gap-2">
                      <motion.button
                        whileHover={isMyTurn ? { scale: 1.04 } : undefined}
                        whileTap={isMyTurn ? { scale: 0.96 } : undefined}
                        type="button"
                        disabled={!isMyTurn || pendingWildUid !== null}
                        onClick={handleDrawOrPass}
                        className={`h-9 sm:h-10 px-5 rounded-xl text-xs sm:text-sm font-bold transition-colors whitespace-nowrap focus-visible:outline-2 focus-visible:outline-white inline-flex items-center gap-1.5 ${
                          isMyTurn
                            ? hasStack
                              ? 'text-white shadow-lg'
                              : 'text-[#151c27] shadow-lg'
                            : 'text-[#7f9391] border cursor-default'
                        }`}
                        style={
                          isMyTurn
                            ? { backgroundColor: hasStack ? '#f43f5e' : activeTheme.accent }
                            : {
                                backgroundColor: `${activeTheme.surface}d9`,
                                borderColor: activeTheme.surfaceBorder,
                              }
                        }
                      >
                        {hasStack && <AlertTriangle className="w-4 h-4" />}
                        <span>
                          {hasStack
                            ? `Take +${activeView.pendingDrawStack} Cards`
                            : activeView.drawnUid !== null
                              ? 'Pass Turn'
                              : 'Draw a Card'}
                        </span>
                      </motion.button>

                      {mode === 'multiplayer' && turnSecondsLeft !== null && (
                        <div
                          className={`h-9 sm:h-10 px-3 rounded-xl border text-xs sm:text-sm font-mono-tabular font-extrabold inline-flex items-center gap-1.5 shadow-md backdrop-blur-sm transition-colors ${
                            isLowTime ? 'animate-pulse text-[#fecdd3]' : isWarnTime ? 'text-[#fde68a]' : 'text-[#e6eeec]'
                          }`}
                          style={{
                            backgroundColor: isLowTime
                              ? 'rgba(244, 63, 94, 0.28)'
                              : `${activeTheme.surface}e6`,
                            borderColor: isLowTime
                              ? '#f43f5e'
                              : isWarnTime
                                ? '#fbbf24'
                                : activeTheme.surfaceBorder,
                          }}
                          title="25-second turn countdown"
                          aria-label={`${turnSecondsLeft} seconds remaining in turn`}
                        >
                          <Clock className="w-3.5 h-3.5 shrink-0" />
                          <span>{turnSecondsLeft}s</span>
                        </div>
                      )}
                    </div>

                    <div
                      className="pointer-events-auto px-3.5 py-1.5 rounded-xl border text-xs sm:text-sm font-medium text-[#e6eeec] text-center max-w-md shadow-md backdrop-blur-sm inline-flex items-center gap-2"
                      style={{
                        backgroundColor: `${activeTheme.surface}e0`,
                        borderColor: hasStack
                          ? '#f43f5e'
                          : mode === 'multiplayer' && wsStatus === 'reconnecting'
                            ? '#f5c84b'
                            : activeTheme.surfaceBorder,
                      }}
                    >
                      {mode === 'multiplayer' &&
                        (wsStatus === 'connecting' || wsStatus === 'reconnecting') && (
                          <Wifi className="w-3.5 h-3.5 text-[#f5c84b] animate-pulse shrink-0" />
                        )}
                      <span>
                        {networkError ||
                          (mode === 'multiplayer' && wsStatus === 'reconnecting'
                            ? 'Reconnecting to multiplayer room...'
                            : activeView.message)}
                      </span>
                    </div>
                  </div>

                  <div className="pointer-events-none absolute right-3 bottom-[122px] sm:bottom-6 sm:right-6 z-10">
                    <motion.button
                      whileHover={canPressUno ? { scale: 1.06 } : undefined}
                      whileTap={canPressUno ? { scale: 0.95 } : undefined}
                      animate={
                        mustCallUno
                          ? {
                              scale: [1, 1.07, 1],
                              boxShadow: [
                                '0 0 0px rgba(244,63,94,0)',
                                '0 0 22px rgba(244,63,94,0.88)',
                                '0 0 0px rgba(244,63,94,0)',
                              ],
                            }
                          : undefined
                      }
                      transition={
                        mustCallUno ? { duration: 1.05, repeat: Infinity, ease: 'easeInOut' } : undefined
                      }
                      type="button"
                      disabled={!canPressUno}
                      onClick={handleCallUno}
                      title="Call UNO before playing down to 1 card (Shortcut: U)"
                      className={`pointer-events-auto h-11 sm:h-12 px-5 rounded-2xl text-xs sm:text-sm font-extrabold tracking-wide transition-colors whitespace-nowrap focus-visible:outline-2 focus-visible:outline-white inline-flex items-center gap-2 border shadow-lg ${
                        activeView.selfUnoArmed
                          ? 'text-[#10141e] border-transparent'
                          : mustCallUno
                            ? 'bg-[#f43f5e] text-white border-[#fda4af]'
                            : canPressUno
                              ? 'text-[#f4f4ed] hover:bg-white/10'
                              : 'text-[#7f9391] opacity-70 cursor-default'
                      }`}
                      style={
                        activeView.selfUnoArmed
                          ? { backgroundColor: '#34d399' }
                          : !mustCallUno
                            ? {
                                backgroundColor: `${activeTheme.surface}eb`,
                                borderColor: activeTheme.surfaceBorder,
                              }
                            : undefined
                      }
                    >
                      <Megaphone className="w-4 h-4" />
                      <span>
                        {activeView.selfUnoArmed
                          ? 'UNO Ready ✓'
                          : mustCallUno
                            ? 'CALL UNO!'
                            : 'UNO!'}
                      </span>
                    </motion.button>
                  </div>
                </>
              );
            })()}
          </div>
        )}
      </main>

      {/* Wild Color Picker Modal */}
      <AnimatePresence>
        {pendingWildUid !== null && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="wild-picker-title"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.88, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 12 }}
              transition={{ type: 'spring', stiffness: 320, damping: 22 }}
              className="w-full max-w-md rounded-2xl border p-6 shadow-2xl text-center"
              style={{
                backgroundColor: activeTheme.surface,
                borderColor: activeTheme.surfaceBorder,
              }}
            >
              <h2 id="wild-picker-title" className="font-display text-2xl font-bold text-[#f4f4ed] mb-4">
                Choose a Color
              </h2>
              <div className="grid grid-cols-4 gap-3">
                {COLORS.map((color, idx) => (
                  <motion.button
                    key={color}
                    whileHover={{ scale: 1.08, y: -3 }}
                    whileTap={{ scale: 0.94 }}
                    type="button"
                    onClick={() => handleWildColorSelect(color)}
                    className="flex flex-col items-center gap-2 p-2 rounded-xl hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-white"
                  >
                    <span
                      className="w-14 h-14 sm:w-16 sm:h-16 rounded-full border-2 border-white shadow-lg"
                      style={{ backgroundColor: activeTheme.suitHex[color] }}
                    />
                    <span className="text-xs font-bold tracking-wide text-[#d6e2e0]">
                      {color} ({idx + 1})
                    </span>
                  </motion.button>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Rafath Kauwa 7.5s Opponent Hand Peek Overlay */}
      <AnimatePresence>
        {screen === 'PLAYING' &&
          activeView?.peekTarget &&
          peekSecondsLeft > 0 &&
          dismissedPeekKey !== `${activeView.peekTarget.targetIndex}-${activeView.peekTarget.expiresAt}` && (() => {
            const peek = activeView.peekTarget!;
            const peekKey = `${peek.targetIndex}-${peek.expiresAt}`;
            const pct = Math.max(0, Math.min(100, (peekSecondsLeft / 7.5) * 100));
            const kauwaArt = getBomboclattCardArtUrl('Rafath Kauwa');
            return (
              <motion.div
                key={peekKey}
                initial={{ opacity: 0, y: -16, scale: 0.94 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -12, scale: 0.94 }}
                transition={{ type: 'spring', stiffness: 320, damping: 24 }}
                className="fixed top-16 left-1/2 -translate-x-1/2 z-[35] w-[94vw] max-w-lg rounded-2xl border p-4 shadow-2xl backdrop-blur-md"
                style={{
                  backgroundColor: 'rgba(15, 19, 26, 0.95)',
                  borderColor: '#94a3b8',
                }}
              >
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    {kauwaArt ? (
                      <img
                        src={kauwaArt}
                        alt="Rafath Kauwa"
                        className="w-7 h-10 rounded object-cover border border-white/25 shrink-0"
                      />
                    ) : (
                      <Eye className="w-4 h-4 text-[#f87171] shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div className="text-xs sm:text-sm font-bold text-[#f8fafc] truncate">
                        Rafath Kauwa · {peek.targetName}&apos;s Hand ({peek.cards.length})
                      </div>
                      <div className="text-[10px] text-[#94a3b8]">
                        Visible only to you
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs font-mono-tabular font-bold text-[#fca5a5]">
                      {peekSecondsLeft.toFixed(1)}s
                    </span>
                    <button
                      type="button"
                      onClick={() => setDismissedPeekKey(peekKey)}
                      className="h-7 w-7 rounded-lg inline-flex items-center justify-center text-[#94a3b8] hover:text-white hover:bg-white/10"
                      aria-label="Close peek overlay"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden mb-3">
                  <div
                    className="h-full bg-[#ef4444] transition-all duration-100"
                    style={{ width: `${pct}%` }}
                  />
                </div>

                <div className="flex flex-wrap gap-2 max-h-44 overflow-y-auto py-0.5">
                  {peek.cards.map((c) => {
                    const artUrl = getBomboclattCardArtUrl(c.value);
                    if (artUrl) {
                      return (
                        <div
                          key={c.uid}
                          className="w-12 h-[68px] rounded-lg overflow-hidden border border-yellow-300/70 shadow-md shrink-0"
                          title={c.value}
                        >
                          <img
                            src={artUrl}
                            alt={c.value}
                            className="w-full h-full object-cover"
                            style={{
                              transform:
                                c.value === 'Gooner Surjo'
                                  ? 'scale(1.18)'
                                  : c.value === 'Rafath Kauwa'
                                    ? 'scale(1.06)'
                                    : 'scale(1.02)',
                            }}
                          />
                        </div>
                      );
                    }
                    const cardBg = activeTheme.suitHex[c.color];
                    const shortVal =
                      c.value === 'Skip All'
                        ? '⊘⊘'
                        : c.value === 'Skip'
                          ? '⊘'
                          : c.value === 'Reverse'
                            ? '↻'
                            : c.value === 'Roulette'
                              ? 'CLR'
                              : c.value === 'Dump'
                                ? 'ALL'
                                : c.value;
                    return (
                      <div
                        key={c.uid}
                        className="w-12 h-[68px] rounded-lg border-2 border-white/80 shadow-md flex flex-col items-center justify-between p-1 text-white shrink-0 relative overflow-hidden"
                        style={{ backgroundColor: cardBg }}
                        title={`${c.color} ${c.value}`}
                      >
                        <span className="self-start text-[9px] font-black leading-none">
                          {shortVal}
                        </span>
                        <span className="font-display italic font-extrabold text-sm leading-none">
                          {shortVal}
                        </span>
                        <span className="self-end text-[9px] font-black leading-none rotate-180">
                          {shortVal}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            );
          })()}
      </AnimatePresence>

      {/* Rizzler Arvin Interactive Pickup Line Modal */}
      <AnimatePresence>
        {screen === 'PLAYING' && activeView?.pendingRizzPrompt && (() => {
          const prompt = activeView.pendingRizzPrompt!;
          const isBusy = rizzBusyPromptId === prompt.promptId;
          const rizzArt = getBomboclattCardArtUrl('Rizzler Arvin');
          const handCards = activeView.selfHand ?? [];
          const pickedUid =
            selectedRizzCardUid !== null && handCards.some((c) => c.uid === selectedRizzCardUid)
              ? selectedRizzCardUid
              : undefined;
          return (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[45] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
              role="dialog"
              aria-modal="true"
              aria-labelledby="rizz-prompt-title"
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.86, y: 16 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 10 }}
                transition={{ type: 'spring', stiffness: 320, damping: 22 }}
                className="w-full max-w-md rounded-2xl border-2 p-5 sm:p-6 shadow-2xl text-center"
                style={{
                  background: 'linear-gradient(160deg, #4c0519 0%, #881337 55%, #be123c 100%)',
                  borderColor: '#fda4af',
                }}
              >
                {rizzArt && (
                  <div className="mx-auto w-24 h-[136px] rounded-xl overflow-hidden border-2 border-[#fecdd3] shadow-xl mb-3">
                    <img
                      src={rizzArt}
                      alt="Rizzler Arvin"
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}

                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-black/30 border border-[#fda4af]/40 text-[#fecdd3] text-[11px] font-extrabold tracking-widest uppercase mb-2.5">
                  <Heart className="w-3.5 h-3.5 fill-current text-[#fb7185]" />
                  <span>Rizzler Arvin · From {prompt.fromName}</span>
                </div>

                <h2
                  id="rizz-prompt-title"
                  className="font-display text-lg sm:text-xl font-extrabold italic text-white leading-snug mb-2.5"
                >
                  &ldquo;{prompt.line}&rdquo;
                </h2>

                <p className="text-xs text-[#ffe4e6] mb-3">
                  Choose <strong>👍</strong> to give {prompt.fromName} 1 card from your pile, or{' '}
                  <strong>👎</strong> to close &amp; continue.
                </p>

                {handCards.length > 0 && (
                  <div className="mb-4 text-left bg-black/25 rounded-xl p-2.5 border border-white/10">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-[#fecdd3] mb-1.5">
                      Card to gift on 👍 (optional — random if none tapped)
                    </div>
                    <div className="flex flex-wrap gap-1.5 max-h-20 overflow-y-auto">
                      {handCards.map((c) => {
                        const isSelected = pickedUid === c.uid;
                        const chipBg = activeTheme.suitHex[c.color];
                        return (
                          <button
                            key={c.uid}
                            type="button"
                            onClick={() =>
                              setSelectedRizzCardUid((prev) => (prev === c.uid ? null : c.uid))
                            }
                            className={`px-2 py-1 rounded-md text-[10px] font-extrabold text-white border transition ${
                              isSelected
                                ? 'ring-2 ring-white scale-105 border-white'
                                : 'border-white/30 opacity-85 hover:opacity-100'
                            }`}
                            style={{ backgroundColor: chipBg }}
                          >
                            {c.color === 'Wild' ? c.value : `${c.color.charAt(0)} ${c.value}`}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <motion.button
                    whileHover={isBusy ? undefined : { scale: 1.04 }}
                    whileTap={isBusy ? undefined : { scale: 0.96 }}
                    type="button"
                    disabled={isBusy}
                    onClick={() => handleRizzPromptChoice(prompt.promptId, true, pickedUid)}
                    className="h-12 rounded-xl bg-[#fff1f2] text-[#9f1239] font-extrabold text-base shadow-lg inline-flex items-center justify-center gap-2 hover:bg-white disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-white"
                  >
                    <ThumbsUp className="w-5 h-5" />
                    <span>👍</span>
                  </motion.button>
                  <motion.button
                    whileHover={isBusy ? undefined : { scale: 1.04 }}
                    whileTap={isBusy ? undefined : { scale: 0.96 }}
                    type="button"
                    disabled={isBusy}
                    onClick={() => handleRizzPromptChoice(prompt.promptId, false)}
                    className="h-12 rounded-xl bg-black/45 border border-[#fda4af]/45 text-white font-extrabold text-base shadow-lg inline-flex items-center justify-center gap-2 hover:bg-black/65 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-white"
                  >
                    <ThumbsDown className="w-5 h-5" />
                    <span>👎</span>
                  </motion.button>
                </div>
              </motion.div>
            </motion.div>
          );
        })()}
      </AnimatePresence>

      {/* Victory Overlay */}
      <AnimatePresence>
        {screen === 'GAME_OVER' && activeView && (() => {
          const isSelfWin = activeView.winner === activeView.selfRole;
          const activeMilestone = isSelfWin ? winMilestone : null;
          const milestoneGold = '#fbbf24';
          const badgeColor =
            activeMilestone === 10
              ? milestoneGold
              : activeMilestone === 5
                ? '#fb923c'
                : activeTheme.accent;

          return (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-30 flex items-center justify-center bg-black/52 backdrop-blur-[3px] p-4 overflow-hidden"
              role="dialog"
              aria-modal="true"
              aria-labelledby="winner-title"
            >
              {/* Ambient rotating halo behind card on victory (visible to all players) */}
              <motion.div
                aria-hidden="true"
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{
                  opacity: activeMilestone === 10 ? 0.55 : activeMilestone ? 0.42 : 0.34,
                  scale: [0.95, 1.08, 0.95],
                  rotate: 360,
                }}
                transition={{
                  opacity: { duration: 0.5 },
                  scale: { duration: 4, repeat: Infinity, ease: 'easeInOut' },
                  rotate: {
                    duration: activeMilestone === 10 ? 12 : 18,
                    repeat: Infinity,
                    ease: 'linear',
                  },
                }}
                className="pointer-events-none absolute w-[460px] h-[460px] rounded-full blur-2xl"
                style={{
                  background:
                    activeMilestone === 10
                      ? `conic-gradient(from 0deg, ${milestoneGold}55, transparent 22%, ${activeTheme.accent}66, transparent 50%, ${milestoneGold}55, transparent 78%, #ffffff33)`
                      : `conic-gradient(from 0deg, ${badgeColor}48, transparent 35%, ${activeTheme.accent}48, transparent 75%)`,
                }}
              />

              <motion.div
                initial={{ opacity: 0, scale: 0.78, y: 24, rotateX: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0, rotateX: 0 }}
                exit={{ opacity: 0, scale: 0.92, y: 12 }}
                transition={{ type: 'spring', stiffness: 260, damping: 18 }}
                className="relative w-full max-w-md rounded-2xl border p-7 shadow-2xl text-center overflow-hidden"
                style={{
                  backgroundColor: `${activeTheme.surface}f2`,
                  borderColor:
                    activeMilestone === 10
                      ? milestoneGold
                      : activeMilestone
                        ? badgeColor
                        : `${activeTheme.accent}88`,
                  boxShadow: `0 25px 60px -12px rgba(0,0,0,0.75), 0 0 42px ${badgeColor}38`,
                }}
              >
                {/* 10th Win sweeping shimmer across top border */}
                {activeMilestone === 10 && (
                  <motion.div
                    aria-hidden="true"
                    animate={{ x: ['-120%', '220%'] }}
                    transition={{ duration: 2.4, repeat: Infinity, repeatDelay: 1.1, ease: 'easeInOut' }}
                    className="pointer-events-none absolute inset-y-0 left-0 w-1/2 -skew-x-12"
                    style={{
                      background:
                        'linear-gradient(90deg, transparent, rgba(251,191,36,0.16), rgba(255,255,255,0.2), transparent)',
                    }}
                  />
                )}

                {/* Victory Emblem (visible on every player's screen) */}
                <div className="relative flex items-center justify-center mb-4 h-24">
                  {/* Pulse rings for round win & milestones */}
                  {(activeMilestone === 1 || activeMilestone === 10 || !activeMilestone) && (
                    <>
                      <motion.span
                        aria-hidden="true"
                        animate={{ scale: [0.8, 1.85], opacity: [0.65, 0] }}
                        transition={{ duration: 1.8, repeat: Infinity, ease: 'easeOut' }}
                        className="absolute w-16 h-16 rounded-full border-2"
                        style={{ borderColor: badgeColor }}
                      />
                      <motion.span
                        aria-hidden="true"
                        animate={{ scale: [0.8, 2.2], opacity: [0.45, 0] }}
                        transition={{ duration: 1.8, delay: 0.6, repeat: Infinity, ease: 'easeOut' }}
                        className="absolute w-16 h-16 rounded-full border"
                        style={{ borderColor: activeTheme.accent }}
                      />
                    </>
                  )}

                  {/* Rotating outer crest ring for 10th win */}
                  {activeMilestone === 10 && (
                    <motion.div
                      aria-hidden="true"
                      animate={{ rotate: 360 }}
                      transition={{ duration: 10, repeat: Infinity, ease: 'linear' }}
                      className="absolute w-24 h-24 rounded-full border-2 border-dashed"
                      style={{ borderColor: `${milestoneGold}aa` }}
                    />
                  )}

                  {/* Orbiting sparkles for standard wins and 1st win */}
                  {(activeMilestone === 1 || !activeMilestone) && (
                    <motion.div
                      aria-hidden="true"
                      animate={{ rotate: 360 }}
                      transition={{ duration: 8, repeat: Infinity, ease: 'linear' }}
                      className="absolute w-24 h-24"
                    >
                      {[0, 1, 2, 3, 4, 5].map((idx) => {
                        const rad = (idx / 6) * Math.PI * 2;
                        return (
                          <span
                            key={idx}
                            className="absolute w-2 h-2 rounded-full"
                            style={{
                              left: `calc(50% + ${Math.cos(rad) * 42}px - 4px)`,
                              top: `calc(50% + ${Math.sin(rad) * 42}px - 4px)`,
                              backgroundColor: idx % 2 === 0 ? activeTheme.accent : '#ffffff',
                            }}
                          />
                        );
                      })}
                    </motion.div>
                  )}

                  {/* Main center icon badge */}
                  <motion.div
                    initial={{ scale: 0, rotate: -25 }}
                    animate={{
                      scale: [1, 1.08, 1],
                      rotate: activeMilestone === 10 ? [0, -4, 4, 0] : [0, -3, 3, 0],
                      y: [0, -4, 0],
                    }}
                    transition={{
                      scale: { duration: 2.2, repeat: Infinity, ease: 'easeInOut' },
                      rotate: { duration: 3, repeat: Infinity, ease: 'easeInOut' },
                      y: { duration: 2.4, repeat: Infinity, ease: 'easeInOut' },
                    }}
                    className="relative w-16 h-16 rounded-2xl flex items-center justify-center border-2 shadow-xl"
                    style={{
                      backgroundColor: `${badgeColor}22`,
                      borderColor: badgeColor,
                      color: badgeColor,
                    }}
                  >
                    {activeMilestone === 10 ? (
                      <Crown className="w-9 h-9" strokeWidth={2.2} />
                    ) : activeMilestone === 5 ? (
                      <Flame className="w-9 h-9" strokeWidth={2.2} />
                    ) : activeMilestone === 1 ? (
                      <Sparkles className="w-9 h-9" strokeWidth={2.2} />
                    ) : (
                      <Trophy className="w-8 h-8" strokeWidth={2.2} />
                    )}
                  </motion.div>
                </div>

                {/* 5th win: 5 popping stars */}
                {activeMilestone === 5 && (
                  <div className="flex items-center justify-center gap-1.5 mb-3" aria-hidden="true">
                    {[0, 1, 2, 3, 4].map((idx) => (
                      <motion.div
                        key={idx}
                        initial={{ scale: 0, y: 12, rotate: -30 }}
                        animate={{ scale: 1, y: 0, rotate: 0 }}
                        transition={{
                          delay: 0.12 + idx * 0.09,
                          type: 'spring',
                          stiffness: 360,
                          damping: 14,
                        }}
                      >
                        <Star
                          className="w-5 h-5 fill-current"
                          style={{ color: idx === 2 ? milestoneGold : '#fb923c' }}
                        />
                      </motion.div>
                    ))}
                  </div>
                )}

                {/* 10th win: 10 golden mini stars */}
                {activeMilestone === 10 && (
                  <div className="flex items-center justify-center gap-1 mb-3" aria-hidden="true">
                    {Array.from({ length: 10 }, (_, idx) => (
                      <motion.div
                        key={idx}
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ scale: [0.9, 1.2, 1], opacity: 1 }}
                        transition={{
                          delay: 0.08 + idx * 0.055,
                          duration: 0.4,
                        }}
                      >
                        <Star className="w-3.5 h-3.5 fill-current text-amber-300" />
                      </motion.div>
                    ))}
                  </div>
                )}

                {/* Milestone or Round Winner callout heading */}
                {activeMilestone ? (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.14 }}
                    className="mb-2"
                  >
                    <span
                      className="inline-block text-[11px] font-extrabold tracking-[0.2em] uppercase px-3 py-1 rounded-full border"
                      style={{
                        color: badgeColor,
                        borderColor: `${badgeColor}66`,
                        backgroundColor: `${badgeColor}18`,
                      }}
                    >
                      {activeMilestone === 1
                        ? 'First Victory!'
                        : activeMilestone === 5
                          ? '5-Win Milestone!'
                          : '10 Wins · Grand Legend'}
                    </span>
                  </motion.div>
                ) : (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.14 }}
                    className="mb-2"
                  >
                    <span
                      className="inline-block text-[11px] font-extrabold tracking-[0.2em] uppercase px-3 py-1 rounded-full border"
                      style={{
                        color: badgeColor,
                        borderColor: `${badgeColor}55`,
                        backgroundColor: `${badgeColor}18`,
                      }}
                    >
                      {isSelfWin ? 'Victory!' : 'Round Winner'}
                    </span>
                  </motion.div>
                )}

                <motion.h2
                  id="winner-title"
                  initial={{ opacity: 0, scale: 0.86 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.08, type: 'spring', stiffness: 260, damping: 16 }}
                  className="font-display text-4xl sm:text-5xl font-extrabold italic mb-1.5"
                  style={{
                    color: isSelfWin
                      ? activeMilestone === 10
                        ? milestoneGold
                        : activeTheme.accent
                      : '#f4f4ed',
                    textShadow: `0 0 28px ${badgeColor}66`,
                  }}
                >
                  {isSelfWin
                    ? 'YOU WIN!'
                    : `${(activeView.winnerName ?? activeView.opponentName).toUpperCase()} WINS!`}
                </motion.h2>

                {activeMilestone && (
                  <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.22 }}
                    className="text-xs sm:text-sm text-[#d6e2e0] mb-4"
                  >
                    {activeMilestone === 1
                      ? 'Your debut win on the table.'
                      : activeMilestone === 5
                        ? 'Five victories — hitting your stride.'
                        : 'Double-digit mastery achieved.'}
                  </motion.p>
                )}

                {activeView.playerCount === 2 ? (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.18 }}
                    className="text-lg font-mono-tabular font-bold text-[#f4f4ed] mt-2 mb-2"
                  >
                    {activeView.selfName} {activeView.score.self} : {activeView.score.opponent}{' '}
                    {activeView.opponentName}
                  </motion.div>
                ) : (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.18 }}
                    className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs font-mono-tabular text-[#d6e2e0] mt-2 mb-2"
                  >
                    {activeView.seats.map((seat) => (
                      <span
                        key={seat.index}
                        style={{
                          color: seat.index === activeView.winnerIndex ? activeTheme.accent : undefined,
                        }}
                      >
                        {seat.name}: {seat.score}
                      </span>
                    ))}
                  </motion.div>
                )}

                {careerWins > 0 && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.26 }}
                    className="text-xs font-mono-tabular text-[#9fb3b0] mb-6"
                  >
                    Total wins: {careerWins}
                  </motion.div>
                )}

                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.24 }}
                  className="flex flex-col sm:flex-row gap-3 mt-4"
                >
                  <motion.button
                    whileHover={{ scale: 1.04 }}
                    whileTap={{ scale: 0.96 }}
                    animate={{
                      boxShadow: [
                        `0 0 0px ${badgeColor}00`,
                        `0 0 22px ${badgeColor}66`,
                        `0 0 0px ${badgeColor}00`,
                      ],
                    }}
                    transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                    type="button"
                    onClick={handleRestartRound}
                    className="flex-1 h-12 px-5 rounded-xl text-[#151c27] font-bold text-sm transition-opacity hover:opacity-90 whitespace-nowrap focus-visible:outline-2 focus-visible:outline-white"
                    style={{ backgroundColor: activeTheme.accent }}
                  >
                    Play Again
                  </motion.button>
                  <motion.button
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.97 }}
                    type="button"
                    onClick={() => {
                      clearSoloTimers();
                      disconnectMultiplayer();
                      modeRef.current = 'solo';
                      roomIdRef.current = null;
                      roomTokenRef.current = null;
                      setRoomId(null);
                      setRoomToken(null);
                      setMultiView(null);
                      setMode('solo');
                      setScreen('TITLE_MENU');
                    }}
                    className="h-12 px-5 rounded-xl text-[#f4f4ed] border font-semibold text-sm transition-colors hover:bg-white/5 whitespace-nowrap focus-visible:outline-2 focus-visible:outline-white"
                    style={{
                      backgroundColor: 'rgba(255,255,255,0.04)',
                      borderColor: activeTheme.surfaceBorder,
                    }}
                  >
                    Menu
                  </motion.button>
                </motion.div>
              </motion.div>
            </motion.div>
          );
        })()}
      </AnimatePresence>

      {/* Display Name Modal */}
      <AnimatePresence>
        {showNameModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="name-modal-title"
          >
            <motion.form
              initial={{ opacity: 0, scale: 0.9, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.92 }}
              transition={{ type: 'spring', stiffness: 320, damping: 24 }}
              onSubmit={handleSaveName}
              className="w-full max-w-sm rounded-2xl border p-6 shadow-2xl"
              style={{
                backgroundColor: activeTheme.surface,
                borderColor: activeTheme.surfaceBorder,
              }}
            >
              <h2 id="name-modal-title" className="font-display text-xl font-bold text-[#f4f4ed] mb-4">
                Player Name
              </h2>
              <input
                type="text"
                maxLength={18}
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                className="w-full h-11 px-4 rounded-xl bg-black/30 border text-[#f4f4ed] text-sm mb-5 focus:outline-none"
                style={{ borderColor: activeTheme.surfaceBorder }}
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowNameModal(false)}
                  className="h-10 px-4 rounded-xl bg-white/5 hover:bg-white/10 text-sm font-semibold text-[#d6e2e0]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="h-10 px-5 rounded-xl text-sm font-bold text-[#151c27] hover:opacity-90"
                  style={{ backgroundColor: activeTheme.accent }}
                >
                  Save
                </button>
              </div>
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Multiplayer Players & Kick Modal */}
      <AnimatePresence>
        {showPlayersModal && mode === 'multiplayer' && multiView && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="players-modal-title"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.92, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 10 }}
              transition={{ type: 'spring', stiffness: 320, damping: 24 }}
              className="w-full max-w-md rounded-2xl border p-6 shadow-2xl max-h-[88dvh] overflow-y-auto"
              style={{
                backgroundColor: activeTheme.surface,
                borderColor: activeTheme.surfaceBorder,
              }}
            >
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 id="players-modal-title" className="font-display text-xl font-bold text-[#f4f4ed]">
                    Room Players
                  </h2>
                  <p className="text-xs font-mono-tabular text-[#9fb3b0] mt-0.5">
                    Room {multiView.roomId} ·{' '}
                    {multiView.seats.filter((s) => s.isCpu || (s.occupied ?? s.connected)).length}/
                    {multiView.playerCount} seated
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowPlayersModal(false)}
                  className="h-10 w-10 inline-flex items-center justify-center rounded-xl text-[#9fb3b0] hover:text-white hover:bg-white/10 transition-colors focus-visible:outline-2 focus-visible:outline-white"
                  aria-label="Close players dialog"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-2 mb-5">
                {(() => {
                  const activeHostIndex = multiView.hostIndex ?? 0;
                  const humanCount = multiView.seats.filter(
                    (s) => !s.isCpu && (s.occupied ?? s.connected)
                  ).length;

                  return multiView.seats.map((seat) => {
                    const isSelf = seat.index === multiView.selfIndex;
                    const isSeatHost = seat.index === activeHostIndex;
                    const isOccupiedHuman = !seat.isCpu && (seat.occupied ?? seat.connected);
                    const canHostKick =
                      multiView.selfIndex === activeHostIndex && !isSeatHost && isOccupiedHuman;
                    const canVoteKick = !isSelf && isOccupiedHuman && humanCount >= 3;
                    const isKicking = kickingSeatIndex === seat.index;
                    const isVoting = votingSeatIndex === seat.index;
                    const votes = seat.kickVotes ?? 0;
                    const required = seat.kickVotesRequired ?? 2;

                    return (
                      <div
                        key={seat.index}
                        className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl border"
                        style={{
                          backgroundColor:
                            seat.connected || isOccupiedHuman
                              ? 'rgba(255,255,255,0.04)'
                              : 'rgba(0,0,0,0.2)',
                          borderColor: activeTheme.surfaceBorder,
                        }}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-sm text-[#f4f4ed] truncate">
                              {seat.name}
                            </span>
                            {isSeatHost && (
                              <span
                                className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/10"
                                style={{ color: activeTheme.accent }}
                              >
                                Host
                              </span>
                            )}
                            {isSelf && (
                              <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/10 text-[#d6e2e0]">
                                You
                              </span>
                            )}
                          </div>
                          <div className="text-xs font-mono-tabular text-[#9fb3b0] mt-0.5">
                            {seat.isCpu
                              ? `CPU · ${seat.cardCount} cards · ${seat.score} wins`
                              : !isOccupiedHuman
                                ? 'Open seat'
                                : seat.eliminated
                                  ? 'Eliminated (Mercy KO)'
                                  : `${seat.connected ? 'Connected' : 'Disconnected'} · ${seat.cardCount} cards · ${seat.score} wins`}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {canVoteKick && (
                            <button
                              type="button"
                              disabled={isVoting}
                              onClick={() => handleVoteKick(seat.index)}
                              aria-label={`Vote to kick ${seat.name}`}
                              title={
                                seat.votedToKickBySelf
                                  ? `Withdraw kick vote (${votes}/${required})`
                                  : `Vote to kick ${seat.name} (${votes}/${required} majority)`
                              }
                              className={`h-9 inline-flex items-center gap-1.5 px-2.5 rounded-lg border text-xs font-bold disabled:opacity-50 transition-colors focus-visible:outline-2 focus-visible:outline-white ${
                                seat.votedToKickBySelf
                                  ? 'bg-[#fb923c]/25 border-[#fb923c]/60 text-[#fed7aa]'
                                  : 'bg-white/5 hover:bg-white/10 border-white/15 text-[#d6e2e0]'
                              }`}
                            >
                              <ThumbsDown className="w-3.5 h-3.5" />
                              <span className="font-mono-tabular">
                                {isVoting ? '...' : `${votes}/${required}`}
                              </span>
                            </button>
                          )}

                          {canHostKick && (
                            <button
                              type="button"
                              disabled={isKicking}
                              onClick={() => handleKickPlayer(seat.index)}
                              aria-label={`Kick ${seat.name}`}
                              className="h-9 inline-flex items-center gap-1.5 px-3 rounded-lg bg-[#ee3f4f]/15 hover:bg-[#ee3f4f]/30 border border-[#ee3f4f]/50 text-xs font-bold text-[#ffb4bc] disabled:opacity-50 transition-colors focus-visible:outline-2 focus-visible:outline-white"
                            >
                              <UserX className="w-3.5 h-3.5" />
                              <span>{isKicking ? 'Kicking...' : 'Kick'}</span>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>

              <div className="flex items-center gap-2">
                {roomId && roomToken && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowPlayersModal(false);
                      setShowQrModal(true);
                    }}
                    className="h-11 px-4 rounded-xl border text-xs sm:text-sm font-semibold text-[#f4f4ed] hover:bg-white/5 inline-flex items-center gap-2 transition-colors"
                    style={{ borderColor: activeTheme.surfaceBorder }}
                  >
                    <QrCode className="w-4 h-4" style={{ color: activeTheme.accent }} />
                    <span>Invite Link / QR</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowPlayersModal(false)}
                  className="flex-1 h-11 px-4 rounded-xl text-[#151c27] font-bold text-sm hover:opacity-90 transition-opacity"
                  style={{ backgroundColor: activeTheme.accent }}
                >
                  Done
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* QR Invite Modal */}
      {showQrModal && roomId && roomToken && (
        <QrInviteModal
          inviteUrl={inviteUrl}
          roomId={roomId}
          playerCount={multiView?.playerCount ?? playerCount}
          seats={multiView?.seats ?? []}
          selfIndex={multiView?.selfIndex ?? 0}
          hostIndex={multiView?.hostIndex ?? 0}
          isHost={multiView ? multiView.selfIndex === (multiView.hostIndex ?? 0) : true}
          isWaiting={multiView ? multiView.turn === 'waiting' : true}
          opponentConnected={Boolean(multiView?.opponentConnected)}
          opponentName={multiView?.opponentName || 'Friend'}
          theme={activeTheme}
          kickingSeatIndex={kickingSeatIndex}
          votingSeatIndex={votingSeatIndex}
          onKickPlayer={handleKickPlayer}
          onVoteKick={handleVoteKick}
          onStartMatch={() => handleStartMultiplayerMatch(false)}
          onStartWithCpus={() => handleStartMultiplayerMatch(true)}
          onClose={() => setShowQrModal(false)}
        />
      )}
    </div>
  );
}
