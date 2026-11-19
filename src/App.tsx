import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle,
  Crown,
  Flame,
  Megaphone,
  Palette,
  QrCode,
  RotateCcw,
  Skull,
  Sparkles,
  Star,
  Trophy,
  User,
  Users,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { HomeBackdrop, PunoLogo } from './components/HomeVisuals.tsx';
import { QrInviteModal } from './components/QrInviteModal.tsx';
import { PunoCanvasEngine } from './game/canvasRenderer.ts';
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
  shouldCpuCallUno,
} from './game/engine.ts';
import { soundFx } from './game/sound.ts';
import { TABLE_THEMES, THEME_LIST, type TableTheme, type TableThemeId } from './game/themes.ts';
import {
  COLORS,
  DIFFICULTY_LIST,
  MAX_PLAYERS,
  MERCY_HAND_LIMIT,
  MIN_PLAYERS,
  type Card,
  type ClientGameView,
  type ClientWsAction,
  type DifficultyLevel,
  type EffectEvent,
  type GameMode,
  type PlayerRole,
  type SeatInfo,
  type ServerWsMessage,
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
  winner: PlayerRole | null;
  winnerIndex: number | null;
  winnerName: string | null;
  message: string;
  roundId: number;
}

function getOrCreateClientId(scopeKey: string): string {
  const storageKey = `puno-client-${scopeKey}`;
  try {
    const existing = localStorage.getItem(storageKey);
    if (existing) return existing;
    const generated =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(storageKey, generated);
    return generated;
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
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
  const suitColor = theme.suitHex[suit];
  const design = theme.cardDesign;
  const isDarkFace = design === 'obsidian' || design === 'sunburst';
  const isWild = suit === 'Wild';
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
        backgroundColor: theme.cardFrame,
        borderColor: theme.cardFrameOutline,
        boxShadow: design === 'comic' ? '6px 8px 0 rgba(12, 14, 26, 0.85)' : undefined,
      }}
      className="absolute w-28 h-40 rounded-xl p-1.5 shadow-2xl border-2 cursor-pointer select-none"
    >
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
    </motion.div>
  );
}

export default function App() {
  const urlParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const inviteRoomParam = urlParams.get('room');
  const inviteTokenParam = urlParams.get('token');
  const isGuestInvite = Boolean(inviteRoomParam && inviteTokenParam);

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
  const [showQrModal, setShowQrModal] = useState(false);
  const [roomBusy, setRoomBusy] = useState(false);
  const [networkError, setNetworkError] = useState<string | null>(null);
  const [multiView, setMultiView] = useState<ClientGameView | null>(null);

  const soloRef = useRef<SoloInternalState | null>(null);
  const [soloView, setSoloView] = useState<ClientGameView | null>(null);
  const timersRef = useRef<number[]>([]);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<PunoCanvasEngine | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const modeRef = useRef<GameMode>(mode);
  const roomIdRef = useRef<string | null>(roomId);
  const roomTokenRef = useRef<string | null>(roomToken);
  const prevWaitingRef = useRef(true);
  const [pointerActive, setPointerActive] = useState(false);

  modeRef.current = mode;
  roomIdRef.current = roomId;
  roomTokenRef.current = roomToken;

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
      } else if (eff.kind === 'impact') {
        if (['+6', '+10', 'Roulette', 'Dump', 'Skip All'].includes(eff.card.value)) {
          soundFx.playMegaPower();
        } else {
          const isPower = ['Skip', 'Reverse', '+2', '+4', 'Wild'].includes(eff.card.value);
          soundFx.playCard(isPower);
        }
      } else if (eff.kind === 'uno') {
        soundFx.playUno();
      } else if (eff.kind === 'uno_penalty' || eff.kind === 'mercy_ko') {
        soundFx.playPenalty();
      } else if (eff.kind === 'roulette' || eff.kind === 'dump') {
        soundFx.playMegaPower();
      } else if (eff.kind === 'win') {
        soundFx.playWin(eff.milestone);
      }
    }
  }, []);

  const syncSoloToView = useCallback(
    (effects: EffectEvent[] = []) => {
      const s = soloRef.current;
      if (!s) return;
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
      };
      setSoloView(view);
      if (s.turn === 'over' && s.winner) {
        setScreen('GAME_OVER');
      }
      engineRef.current?.syncView(view, effects);
      playSoundForEffects(effects);
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
        winner: null,
        winnerIndex: null,
        winnerName: null,
        message: jasirBoost
          ? 'j4s1r POWER-UP: 7 power cards dealt!'
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
    s.deck.unshift(...hand.splice(0, hand.length));
  };

  const triggerSoloMercyKo = (
    s: SoloInternalState,
    loserSeat: SoloSeat,
    expectedRound: number,
    baseEffects: EffectEvent[]
  ): boolean => {
    if (s.difficulty !== 'no_mercy' || loserSeat.hand.length < MERCY_HAND_LIMIT) {
      return false;
    }
    loserSeat.eliminated = true;
    recycleSoloHand(s, loserSeat.hand);
    const alive = s.seats.filter((seat) => !seat.eliminated);
    const isSelfLoser = loserSeat.index === 0;
    const koEffects: EffectEvent[] = [
      ...baseEffects,
      { kind: 'mercy_ko', loserName: loserSeat.name, isSelfLoser },
    ];

    if (alive.length <= 1 || isSelfLoser) {
      const winnerSeat = isSelfLoser
        ? alive[0] ?? s.seats[1]
        : alive[0] ?? s.seats[0];
      s.turn = 'busy';
      s.message = `MERCY KO! ${loserSeat.name} reached 25+ cards!`;
      syncSoloToView(koEffects);
      scheduleSolo(900, () => {
        const st = soloRef.current;
        if (!st || st.roundId !== expectedRound) return;
        winnerSeat.score += 1;
        st.winner = winnerSeat.index === 0 ? 'host' : 'guest';
        st.winnerIndex = winnerSeat.index;
        st.winnerName = winnerSeat.name;
        st.turn = 'over';
        st.message = `${winnerSeat.name} wins by Mercy Rule KO!`;
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
        const effs: EffectEvent[] = [];
        for (let i = 0; i < stackCount; i++) {
          const res = drawOneFromDeck(s.deck, s.discard, cpuSeat.hand);
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
        const { card, reshuffled } = drawOneFromDeck(s.deck, s.discard, cpuSeat.hand);
        const effs: EffectEvent[] = reshuffled ? [{ kind: 'reshuffle' }] : [];
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
        });
      }

      s.discard.push(card);
      s.currentColor = nextColor;
      effects.push({ kind: 'impact', card, activeColor: nextColor });

      if (cpuSeat.hand.length === 0) {
        s.pendingDrawStack = 0;
        s.pendingDrawMin = 0;
        s.turn = 'busy';
        s.message = `${cpuSeat.name} played its last card!`;
        syncSoloToView(effects);
        scheduleSolo(700, () => {
          const st = soloRef.current;
          if (!st || st.roundId !== expectedRound) return;
          cpuSeat.score += 1;
          st.winner = 'guest';
          st.winnerIndex = cpuSeat.index;
          st.winnerName = cpuSeat.name;
          st.turn = 'over';
          st.message = `${cpuSeat.name} wins this round.`;
          setWinMilestone(null);
          syncSoloToView([
            {
              kind: 'win',
              winnerRole: 'guest',
              winnerIndex: cpuSeat.index,
              winnerName: cpuSeat.name,
            },
          ]);
        });
        return;
      }

      let cpuForgotUno = false;
      if (cpuSeat.hand.length === 1) {
        if (shouldCpuCallUno(s.difficulty)) {
          effects.push({ kind: 'uno', whoName: cpuSeat.name, isSelf: false });
        } else {
          cpuForgotUno = true;
          for (let i = 0; i < 2; i++) {
            const res = drawOneFromDeck(s.deck, s.discard, cpuSeat.hand);
            if (res.reshuffled) effects.push({ kind: 'reshuffle' });
          }
          effects.push({ kind: 'uno_penalty', whoName: cpuSeat.name, isSelf: false });
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

      const aliveCount = s.seats.filter((seat) => !seat.eliminated).length;
      const drawAmount = getDrawAmount(card);

      if (drawAmount > 0) {
        if (s.difficulty === 'no_mercy') {
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
            const res = drawOneFromDeck(s.deck, s.discard, victimSeat.hand);
            if (res.reshuffled) effects.push({ kind: 'reshuffle' });
          }
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
        if (rRes.reshuffled) effects.push({ kind: 'reshuffle' });
        effects.push({
          kind: 'roulette',
          whoName: victimSeat.name,
          color: nextColor,
          drawnCount: rRes.drawnCount,
        });

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
        });
      }

      s.discard.push(card);
      s.currentColor = chosenColor;
      s.drawnUid = null;
      effects.push({ kind: 'impact', card, activeColor: chosenColor });

      if (selfSeat.hand.length === 0) {
        s.pendingDrawStack = 0;
        s.pendingDrawMin = 0;
        s.turn = 'busy';
        s.message = 'Final card played!';
        syncSoloToView(effects);
        scheduleSolo(700, () => {
          const st = soloRef.current;
          if (!st || st.roundId !== expectedRound) return;
          selfSeat.score += 1;
          st.winner = 'host';
          st.winnerIndex = 0;
          st.winnerName = selfSeat.name;
          st.turn = 'over';
          st.message = 'You win the round!';
          const milestone = recordSelfWin(`solo-${expectedRound}`);
          syncSoloToView([
            {
              kind: 'win',
              winnerRole: 'host',
              winnerIndex: 0,
              winnerName: selfSeat.name,
              milestone,
            },
          ]);
        });
        return;
      }

      let penalizedUno = false;
      if (selfSeat.hand.length === 1) {
        if (wasUnoArmed) {
          effects.push({ kind: 'uno', whoName: selfSeat.name, isSelf: true });
        } else {
          penalizedUno = true;
          for (let i = 0; i < 2; i++) {
            const res = drawOneFromDeck(s.deck, s.discard, selfSeat.hand);
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

      const aliveCount = s.seats.filter((seat) => !seat.eliminated).length;
      const drawAmount = getDrawAmount(card);

      if (drawAmount > 0) {
        if (s.difficulty === 'no_mercy') {
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
            const res = drawOneFromDeck(s.deck, s.discard, victimSeat.hand);
            if (res.reshuffled) effects.push({ kind: 'reshuffle' });
          }
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
        if (rRes.reshuffled) effects.push({ kind: 'reshuffle' });
        effects.push({
          kind: 'roulette',
          whoName: victimSeat.name,
          color: chosenColor,
          drawnCount: rRes.drawnCount,
        });

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
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(action));
    }
  }, []);

  const connectMultiplayer = useCallback(
    (targetRoomId: string, targetToken: string, joinName: string, retryCount = 0) => {
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        const oldWs = wsRef.current;
        wsRef.current = null;
        oldWs.close();
      }

      const clientId = getOrCreateClientId(targetRoomId);
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${proto}//${window.location.host}/ws`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      let opened = false;

      ws.addEventListener('open', () => {
        opened = true;
        setNetworkError(null);
        ws.send(
          JSON.stringify({
            type: 'join',
            roomId: targetRoomId,
            token: targetToken,
            clientId,
            name: joinName,
          } satisfies ClientWsAction)
        );
      });

      ws.addEventListener('message', (event) => {
        let msg: ServerWsMessage;
        try {
          msg = JSON.parse(String(event.data)) as ServerWsMessage;
        } catch {
          return;
        }

        if (msg.type === 'error') {
          setNetworkError(msg.message);
          soundFx.playError();
          return;
        }

        if (msg.type === 'state') {
          setNetworkError(null);
          setMultiView(msg.view);
          setScreen(msg.view.turn === 'over' ? 'GAME_OVER' : 'PLAYING');
          if (msg.view.turn !== 'over') {
            setWinMilestone(null);
          }
          if (prevWaitingRef.current && msg.view.turn !== 'waiting') {
            setShowQrModal(false);
          }
          prevWaitingRef.current = msg.view.turn === 'waiting';
          const enrichedEffects = msg.effects.map((eff) => {
            if (eff.kind === 'win' && eff.winnerRole === msg.view.selfRole) {
              const milestone = recordSelfWin(`mp-${msg.view.roomId}-${msg.view.roundId}`);
              return { ...eff, milestone };
            }
            if (eff.kind === 'win') {
              setWinMilestone(null);
            }
            return eff;
          });
          engineRef.current?.syncView(msg.view, enrichedEffects);
          playSoundForEffects(enrichedEffects);
        }
      });

      ws.addEventListener('close', () => {
        if (wsRef.current !== ws) return;
        const shouldReconnect =
          modeRef.current === 'multiplayer' &&
          roomIdRef.current === targetRoomId &&
          roomTokenRef.current === targetToken;
        if (!shouldReconnect) return;

        if (!opened && retryCount >= 2) {
          setNetworkError('Live multiplayer server is unavailable here. Use Solo vs CPU instead.');
          return;
        }

        reconnectTimerRef.current = window.setTimeout(() => {
          if (
            modeRef.current === 'multiplayer' &&
            roomIdRef.current === targetRoomId &&
            roomTokenRef.current === targetToken
          ) {
            connectMultiplayer(targetRoomId, targetToken, joinName, opened ? 0 : retryCount + 1);
          }
        }, 1500);
      });
    },
    [playSoundForEffects, recordSelfWin]
  );

  useEffect(() => {
    return () => {
      clearSoloTimers();
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) {
        const oldWs = wsRef.current;
        wsRef.current = null;
        oldWs.close();
      }
    };
  }, [clearSoloTimers]);

  const handleHostMultiplayer = async () => {
    const cleanName = nameDraft.trim() || playerName;
    setPlayerName(cleanName);
    try {
      localStorage.setItem('puno-player-name', cleanName);
    } catch {
      // ignore
    }
    setRoomBusy(true);
    setNetworkError(null);
    clearSoloTimers();
    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostName: cleanName, difficulty, playerCount }),
      });
      if (res.status === 404 || res.status === 405) {
        throw new Error('Multiplayer QR rooms require the Node server. Solo vs CPU works everywhere!');
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
      setNetworkError(err instanceof Error ? err.message : 'Failed to create room.');
    } finally {
      setRoomBusy(false);
    }
  };

  const handleJoinInvite = () => {
    if (!inviteRoomParam || !inviteTokenParam) return;
    const cleanName = nameDraft.trim() || 'Player';
    setPlayerName(cleanName);
    try {
      localStorage.setItem('puno-player-name', cleanName);
    } catch {
      // ignore
    }
    modeRef.current = 'multiplayer';
    roomIdRef.current = inviteRoomParam;
    roomTokenRef.current = inviteTokenParam;
    prevWaitingRef.current = true;
    setMode('multiplayer');
    setRoomId(inviteRoomParam);
    setRoomToken(inviteTokenParam);
    connectMultiplayer(inviteRoomParam, inviteTokenParam, cleanName);
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
        const res = drawOneFromDeck(s.deck, s.discard, selfSeat.hand);
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

    const { card, reshuffled } = drawOneFromDeck(s.deck, s.discard, selfSeat.hand);
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
      return;
    }
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const engine = new PunoCanvasEngine(canvas, themeId);
    engineRef.current = engine;
    if (activeView) {
      engine.syncView(activeView, []);
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
    if (activeView && engineRef.current) {
      engineRef.current.syncView(activeView, []);
    }
  }, [activeView]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (showNameModal || showQrModal || screen === 'TITLE_MENU') return;
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
        } else {
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
    handleCallUno,
    handleDrawOrPass,
    handleRestartRound,
    handleWildColorSelect,
    pendingWildUid,
    screen,
    showNameModal,
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
    if (!engine || !canvas || screen !== 'PLAYING' || pendingWildUid !== null) return;
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
    return `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(roomId)}&token=${encodeURIComponent(roomToken)}`;
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
              if (reconnectTimerRef.current) {
                window.clearTimeout(reconnectTimerRef.current);
                reconnectTimerRef.current = null;
              }
              if (wsRef.current) {
                const oldWs = wsRef.current;
                wsRef.current = null;
                oldWs.close();
              }
              modeRef.current = 'solo';
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
                      key={`${themeId}-${difficulty === 'no_mercy' ? 'nm' : 'std'}`}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      transition={{ duration: 0.2 }}
                      className="relative flex items-center justify-center w-full h-full"
                    >
                      <ShowcaseCard
                        theme={activeTheme}
                        suit="Blue"
                        label={difficulty === 'no_mercy' ? '⊘⊘' : '7'}
                        rotate={-16}
                        xOffset={-56}
                        yOffset={10}
                        zIndex={1}
                        floatDelay={0}
                      />
                      <ShowcaseCard
                        theme={activeTheme}
                        suit="Red"
                        label={difficulty === 'no_mercy' ? 'ALL' : '+2'}
                        rotate={0}
                        xOffset={0}
                        yOffset={-8}
                        zIndex={2}
                        floatDelay={0.5}
                      />
                      <ShowcaseCard
                        theme={activeTheme}
                        suit="Wild"
                        label={difficulty === 'no_mercy' ? '+10' : '+4'}
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
                          <span>{activeDifficulty.tier}</span>
                        </span>
                      </div>

                      <div
                        className="grid grid-cols-4 gap-1 p-1 rounded-xl border bg-black/25"
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
                              className={`h-9 rounded-lg text-xs font-bold transition-all whitespace-nowrap px-1.5 focus-visible:outline-2 focus-visible:outline-white ${
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

                  {networkError && (
                    <div className="rounded-xl bg-[#ee3f4f]/15 border border-[#ee3f4f]/50 px-4 py-2.5 text-xs text-[#ffb4bc]">
                      {networkError}
                    </div>
                  )}

                  {/* Play Actions */}
                  {isGuestInvite ? (
                    <div className="flex flex-col sm:flex-row gap-3 pt-1">
                      <motion.button
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        type="button"
                        onClick={handleJoinInvite}
                        className="flex-1 h-12 px-6 rounded-xl text-[#151c27] font-bold text-sm transition-opacity hover:opacity-90 whitespace-nowrap focus-visible:outline-2 focus-visible:outline-white"
                        style={{ backgroundColor: activeTheme.accent }}
                      >
                        Join Match
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
                    <div className="flex flex-col sm:flex-row gap-3 pt-1">
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
                        <span>{roomBusy ? 'Creating...' : `Host ${playerCount}P QR`}</span>
                      </motion.button>
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
                    {activeView.difficulty === 'no_mercy' && activeView.opponentCount >= 16 ? (
                      <span className="ml-1.5 font-bold text-[#f43f5e]">
                        ({activeView.opponentCount}/{MERCY_HAND_LIMIT} KO)
                      </span>
                    ) : null}
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
                    {activeView.difficulty === 'no_mercy' && activeView.selfHand.length >= 16 ? (
                      <span className="ml-1.5 font-bold text-[#f43f5e]">
                        ({activeView.selfHand.length}/{MERCY_HAND_LIMIT} KO)
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            )}

            {activeView && screen === 'PLAYING' && (() => {
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
                  (activeView.difficulty === 'no_mercy' &&
                    activeView.selfHand.length >= 2 &&
                    activeView.selfHand.some((c) => c.value === 'Dump')));

              return (
                <>
                  <div className="pointer-events-none absolute inset-x-0 bottom-[178px] sm:bottom-[206px] flex flex-col items-center gap-2 px-4">
                    <motion.button
                      whileHover={isMyTurn ? { scale: 1.04 } : undefined}
                      whileTap={isMyTurn ? { scale: 0.96 } : undefined}
                      type="button"
                      disabled={!isMyTurn || pendingWildUid !== null}
                      onClick={handleDrawOrPass}
                      className={`pointer-events-auto h-10 px-5 rounded-xl text-xs sm:text-sm font-bold transition-colors whitespace-nowrap focus-visible:outline-2 focus-visible:outline-white inline-flex items-center gap-1.5 ${
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

                    <div
                      className="pointer-events-auto px-4 py-1.5 rounded-xl border text-xs sm:text-sm font-medium text-[#e6eeec] text-center max-w-md shadow-md backdrop-blur-sm"
                      style={{
                        backgroundColor: `${activeTheme.surface}e0`,
                        borderColor: hasStack ? '#f43f5e' : activeTheme.surfaceBorder,
                      }}
                    >
                      {networkError || activeView.message}
                    </div>
                  </div>

                  <div className="pointer-events-none absolute right-3 bottom-[262px] sm:bottom-6 sm:right-6 z-10">
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
              className="fixed inset-0 z-30 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4 overflow-hidden"
              role="dialog"
              aria-modal="true"
              aria-labelledby="winner-title"
            >
              {/* Ambient rotating halo behind card on victory */}
              {isSelfWin && (
                <motion.div
                  aria-hidden="true"
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{
                    opacity: activeMilestone === 10 ? 0.55 : activeMilestone ? 0.42 : 0.28,
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
                        : `conic-gradient(from 0deg, ${badgeColor}44, transparent 35%, ${activeTheme.accent}44, transparent 75%)`,
                  }}
                />
              )}

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
                        : activeTheme.surfaceBorder,
                  boxShadow: isSelfWin
                    ? `0 25px 60px -12px rgba(0,0,0,0.75), 0 0 42px ${badgeColor}33`
                    : undefined,
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

                {/* Victory Emblem */}
                {isSelfWin && (
                  <div className="relative flex items-center justify-center mb-4 h-24">
                    {/* Pulse rings for 1st and 10th milestones */}
                    {(activeMilestone === 1 || activeMilestone === 10) && (
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

                    {/* Orbiting sparkles for 1st win */}
                    {activeMilestone === 1 && (
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
                )}

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

                {/* Milestone callout heading */}
                {activeMilestone && (
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
                    textShadow: isSelfWin ? `0 0 28px ${badgeColor}55` : undefined,
                  }}
                >
                  {isSelfWin
                    ? 'YOU WIN!'
                    : `${(activeView.winnerName ?? activeView.opponentName).toUpperCase()} WINS`}
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
                    animate={
                      isSelfWin
                        ? {
                            boxShadow: [
                              `0 0 0px ${badgeColor}00`,
                              `0 0 22px ${badgeColor}66`,
                              `0 0 0px ${badgeColor}00`,
                            ],
                          }
                        : undefined
                    }
                    transition={
                      isSelfWin ? { duration: 2, repeat: Infinity, ease: 'easeInOut' } : undefined
                    }
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
                      if (reconnectTimerRef.current) {
                        window.clearTimeout(reconnectTimerRef.current);
                        reconnectTimerRef.current = null;
                      }
                      if (wsRef.current) {
                        const oldWs = wsRef.current;
                        wsRef.current = null;
                        oldWs.close();
                      }
                      modeRef.current = 'solo';
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

      {/* QR Invite Modal */}
      {showQrModal && roomId && roomToken && (
        <QrInviteModal
          inviteUrl={inviteUrl}
          roomId={roomId}
          playerCount={multiView?.playerCount ?? playerCount}
          seats={multiView?.seats ?? []}
          isHost={multiView ? multiView.selfIndex === 0 : true}
          isWaiting={multiView ? multiView.turn === 'waiting' : true}
          opponentConnected={Boolean(multiView?.opponentConnected)}
          opponentName={multiView?.opponentName || 'Friend'}
          theme={activeTheme}
          onStartWithCpus={() => {
            sendWsAction({ type: 'start_now' });
            setShowQrModal(false);
          }}
          onClose={() => setShowQrModal(false)}
        />
      )}
    </div>
  );
}
