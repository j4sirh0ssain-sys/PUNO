import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { QrInviteModal } from './components/QrInviteModal.tsx';
import { PunoCanvasEngine } from './game/canvasRenderer.ts';
import {
  canPlayCard,
  chooseCpuCard,
  chooseCpuWildColor,
  dealRound,
  drawColorRoulette,
  drawOneFromDeck,
  getDrawAmount,
  isDifficultyLevel,
  shouldCpuCallUno,
} from './game/engine.ts';
import { soundFx } from './game/sound.ts';
import { TABLE_THEMES, THEME_LIST, type TableTheme, type TableThemeId } from './game/themes.ts';
import {
  COLORS,
  DIFFICULTY_LIST,
  MERCY_HAND_LIMIT,
  type Card,
  type ClientGameView,
  type ClientWsAction,
  type DifficultyLevel,
  type EffectEvent,
  type GameMode,
  type PlayerRole,
  type ServerWsMessage,
  type SuitColor,
  type TurnPhase,
} from './game/types.ts';

type ScreenState = 'TITLE_MENU' | 'PLAYING' | 'GAME_OVER';

interface SoloInternalState {
  difficulty: DifficultyLevel;
  deck: Card[];
  playerHand: Card[];
  cpuHand: Card[];
  discard: Card[];
  currentColor: SuitColor;
  turn: TurnPhase;
  drawnUid: number | null;
  pendingDrawStack: number;
  pendingDrawMin: number;
  playerUnoArmed: boolean;
  cpuUnoArmed: boolean;
  winner: PlayerRole | null;
  score: { player: number; cpu: number };
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
    value === 'aurora'
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
            design === 'obsidian'
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
        </svg>

        <span
          className={`absolute font-display italic font-extrabold leading-none tracking-tight ${
            label.length >= 3 ? 'text-xl' : label.length > 1 ? 'text-2xl' : 'text-3xl'
          }`}
          style={{
            color: centerTextColor,
            textShadow: '0 2px 3px rgba(0,0,0,0.35)',
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
  const [pointerActive, setPointerActive] = useState(false);

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
      const view: ClientGameView = {
        roomId: 'SOLO',
        mode: 'solo',
        difficulty: s.difficulty,
        selfRole: 'host',
        selfName: playerName,
        opponentName: 'CPU',
        opponentConnected: true,
        selfHand: [...s.playerHand],
        opponentCardIds: s.cpuHand.map((c) => c.uid),
        opponentCount: s.cpuHand.length,
        discardPile: s.discard.slice(-5),
        deckCount: s.deck.length,
        currentColor: s.currentColor,
        turn: s.turn,
        drawnUid: s.drawnUid,
        pendingDrawStack: s.pendingDrawStack,
        pendingDrawMin: s.pendingDrawMin,
        selfUnoArmed: s.playerUnoArmed,
        opponentUnoArmed: s.cpuUnoArmed,
        winner: s.winner,
        score: { self: s.score.player, opponent: s.score.cpu },
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
    [playSoundForEffects, playerName]
  );

  const startSoloRound = useCallback(
    (nameOverride?: string, preserveScore = true, difficultyOverride?: DifficultyLevel) => {
      clearSoloTimers();
      setPendingWildUid(null);
      setWinMilestone(null);
      setNetworkError(null);
      const effectiveName = (nameOverride ?? playerName).trim() || 'Player';
      const effectiveDiff = difficultyOverride ?? difficulty;
      const prev = soloRef.current;
      const prevScore = preserveScore && prev ? prev.score : { player: 0, cpu: 0 };
      const nextRoundId = prev ? prev.roundId + 1 : 1;

      const dealt = dealRound(effectiveName, effectiveDiff);
      soloRef.current = {
        difficulty: effectiveDiff,
        deck: dealt.deck,
        playerHand: dealt.hostHand,
        cpuHand: dealt.guestHand,
        discard: dealt.discard,
        currentColor: dealt.currentColor,
        turn: 'dealing',
        drawnUid: null,
        pendingDrawStack: 0,
        pendingDrawMin: 0,
        playerUnoArmed: false,
        cpuUnoArmed: false,
        winner: null,
        score: prevScore,
        message: dealt.jasirBoost
          ? 'j4s1r POWER-UP: 7 power cards dealt!'
          : effectiveDiff === 'no_mercy'
            ? 'NO MERCY MODE — 25+ cards = KO!'
            : 'Shuffling and dealing...',
        roundId: nextRoundId,
      };

      setMode('solo');
      setScreen('PLAYING');
      syncSoloToView([
        { kind: 'deal', isJasirBoost: dealt.jasirBoost, difficulty: effectiveDiff },
      ]);

      scheduleSolo(900, () => {
        const s = soloRef.current;
        if (!s || s.roundId !== nextRoundId) return;
        s.turn = 'host';
        s.message = dealt.jasirBoost
          ? 'j4s1r POWER-UP active — your turn!'
          : effectiveDiff === 'no_mercy'
            ? 'Your turn — stack draw cards or show No Mercy.'
            : 'Your turn — match the color or number.';
        syncSoloToView([
          { kind: 'banner', text: 'YOUR TURN', color: activeTheme.accent, size: 0.55, dur: 0.9 },
        ]);
      });
    },
    [activeTheme.accent, clearSoloTimers, difficulty, playerName, scheduleSolo, syncSoloToView]
  );

  const runCpuTurn = useCallback(
    (expectedRound: number) => {
      const s = soloRef.current;
      if (!s || s.roundId !== expectedRound || s.turn !== 'guest' || s.winner) return;

      const top = s.discard[s.discard.length - 1];
      const chosen = chooseCpuCard(
        s.cpuHand,
        top,
        s.currentColor,
        s.difficulty,
        s.pendingDrawMin,
        s.playerHand.length
      );

      // Must take draw stack if cannot counter-stack
      if (s.pendingDrawStack > 0 && !chosen) {
        const stackCount = s.pendingDrawStack;
        const effs: EffectEvent[] = [];
        for (let i = 0; i < stackCount; i++) {
          const res = drawOneFromDeck(s.deck, s.discard, s.cpuHand);
          if (res.reshuffled) effs.push({ kind: 'reshuffle' });
        }
        s.pendingDrawStack = 0;
        s.pendingDrawMin = 0;
        soundFx.playDraw();

        if (s.difficulty === 'no_mercy' && s.cpuHand.length >= MERCY_HAND_LIMIT) {
          s.turn = 'busy';
          s.message = `MERCY KO! CPU hit ${s.cpuHand.length} cards!`;
          syncSoloToView([
            ...effs,
            { kind: 'mercy_ko', loserName: 'CPU', isSelfLoser: false },
          ]);
          scheduleSolo(800, () => {
            const st = soloRef.current;
            if (!st || st.roundId !== expectedRound) return;
            st.winner = 'host';
            st.turn = 'over';
            st.score = { ...st.score, player: st.score.player + 1 };
            st.message = 'You win by Mercy Rule KO!';
            const milestone = recordSelfWin(`solo-${expectedRound}`);
            syncSoloToView([{ kind: 'win', winnerRole: 'host', milestone }]);
          });
          return;
        }

        s.turn = 'busy';
        s.message = `CPU took +${stackCount} cards! Your turn.`;
        syncSoloToView(effs);
        scheduleSolo(750, () => {
          const st = soloRef.current;
          if (!st || st.roundId !== expectedRound || st.winner) return;
          st.turn = 'host';
          syncSoloToView();
        });
        return;
      }

      if (!chosen) {
        const { card, reshuffled } = drawOneFromDeck(s.deck, s.discard, s.cpuHand);
        const effs: EffectEvent[] = reshuffled ? [{ kind: 'reshuffle' }] : [];
        soundFx.playDraw();

        if (s.difficulty === 'no_mercy' && s.cpuHand.length >= MERCY_HAND_LIMIT) {
          s.turn = 'busy';
          s.message = `MERCY KO! CPU hit ${s.cpuHand.length} cards!`;
          syncSoloToView([
            ...effs,
            { kind: 'mercy_ko', loserName: 'CPU', isSelfLoser: false },
          ]);
          scheduleSolo(800, () => {
            const st = soloRef.current;
            if (!st || st.roundId !== expectedRound) return;
            st.winner = 'host';
            st.turn = 'over';
            st.score = { ...st.score, player: st.score.player + 1 };
            st.message = 'You win by Mercy Rule KO!';
            const milestone = recordSelfWin(`solo-${expectedRound}`);
            syncSoloToView([{ kind: 'win', winnerRole: 'host', milestone }]);
          });
          return;
        }

        if (card && canPlayCard(card, top, s.currentColor)) {
          s.message = 'CPU drew a playable card...';
          syncSoloToView(effs);
          scheduleSolo(750, () => {
            const st = soloRef.current;
            if (!st || st.roundId !== expectedRound || st.winner) return;
            commitCpuCard(card, expectedRound);
          });
        } else {
          s.turn = 'busy';
          s.message = card ? 'CPU drew a card. Your turn!' : 'Deck empty. Your turn!';
          syncSoloToView(effs);
          scheduleSolo(650, () => {
            const st = soloRef.current;
            if (!st || st.roundId !== expectedRound || st.winner) return;
            st.turn = 'host';
            syncSoloToView();
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
      const idx = s.cpuHand.findIndex((c) => c.uid === card.uid);
      if (idx === -1) return;

      s.cpuHand.splice(idx, 1);

      const effects: EffectEvent[] = [];
      const nextColor: SuitColor =
        card.color === 'Wild' ? chooseCpuWildColor(s.cpuHand, s.difficulty) : card.color;

      if (card.value === 'Dump' && card.color !== 'Wild') {
        const extras: Card[] = [];
        for (let i = s.cpuHand.length - 1; i >= 0; i--) {
          if (s.cpuHand[i].color === card.color) {
            const [matched] = s.cpuHand.splice(i, 1);
            extras.push(matched);
          }
        }
        s.discard.push(...extras);
        effects.push({ kind: 'dump', whoName: 'CPU', color: nextColor, count: extras.length + 1 });
      }

      s.discard.push(card);
      s.currentColor = nextColor;
      effects.push({ kind: 'impact', card, activeColor: nextColor });

      if (s.cpuHand.length === 0) {
        s.pendingDrawStack = 0;
        s.pendingDrawMin = 0;
        s.turn = 'busy';
        s.message = 'CPU played its last card!';
        syncSoloToView(effects);
        scheduleSolo(700, () => {
          const st = soloRef.current;
          if (!st || st.roundId !== expectedRound) return;
          st.winner = 'guest';
          st.turn = 'over';
          st.score = { ...st.score, cpu: st.score.cpu + 1 };
          st.message = 'CPU wins this round.';
          setWinMilestone(null);
          syncSoloToView([{ kind: 'win', winnerRole: 'guest' }]);
        });
        return;
      }

      let cpuForgotUno = false;
      if (s.cpuHand.length === 1) {
        if (shouldCpuCallUno(s.difficulty)) {
          effects.push({ kind: 'uno', whoName: 'CPU', isSelf: false });
        } else {
          cpuForgotUno = true;
          for (let i = 0; i < 2; i++) {
            const res = drawOneFromDeck(s.deck, s.discard, s.cpuHand);
            if (res.reshuffled) effects.push({ kind: 'reshuffle' });
          }
          effects.push({ kind: 'uno_penalty', whoName: 'CPU', isSelf: false });
        }
      }

      const drawAmount = getDrawAmount(card);
      if (drawAmount > 0) {
        if (s.difficulty === 'no_mercy') {
          s.pendingDrawStack += drawAmount;
          s.pendingDrawMin = drawAmount;
          s.turn = 'busy';
          s.message = `CPU stacked ${card.value}! Stack +${drawAmount}+ or take +${s.pendingDrawStack}.`;
          syncSoloToView(effects);
          scheduleSolo(750, () => {
            const st = soloRef.current;
            if (!st || st.roundId !== expectedRound || st.winner) return;
            st.turn = 'host';
            syncSoloToView();
          });
        } else {
          s.turn = 'busy';
          s.message = `CPU played ${card.value} — you draw ${drawAmount}!`;
          for (let i = 0; i < drawAmount; i++) {
            const res = drawOneFromDeck(s.deck, s.discard, s.playerHand);
            if (res.reshuffled) effects.push({ kind: 'reshuffle' });
          }
          syncSoloToView(effects);
          scheduleSolo(1100 + drawAmount * 110, () => {
            const st = soloRef.current;
            if (!st || st.roundId !== expectedRound || st.winner) return;
            st.turn = 'guest';
            st.message = `CPU goes again. Color is ${st.currentColor}.`;
            syncSoloToView();
            scheduleSolo(700, () => runCpuTurn(expectedRound));
          });
        }
      } else if (card.value === 'Roulette') {
        s.turn = 'busy';
        const rRes = drawColorRoulette(s.deck, s.discard, s.playerHand, nextColor);
        if (rRes.reshuffled) effects.push({ kind: 'reshuffle' });
        effects.push({
          kind: 'roulette',
          whoName: playerName,
          color: nextColor,
          drawnCount: rRes.drawnCount,
        });

        if (s.difficulty === 'no_mercy' && s.playerHand.length >= MERCY_HAND_LIMIT) {
          s.message = `MERCY KO! You reached ${s.playerHand.length} cards!`;
          effects.push({ kind: 'mercy_ko', loserName: playerName, isSelfLoser: true });
          syncSoloToView(effects);
          scheduleSolo(950, () => {
            const st = soloRef.current;
            if (!st || st.roundId !== expectedRound) return;
            st.winner = 'guest';
            st.turn = 'over';
            st.score = { ...st.score, cpu: st.score.cpu + 1 };
            st.message = 'CPU wins by Mercy Rule KO!';
            setWinMilestone(null);
            syncSoloToView([{ kind: 'win', winnerRole: 'guest' }]);
          });
          return;
        }

        s.message = `Color Roulette (${nextColor}) — you drew ${rRes.drawnCount}! CPU goes again.`;
        syncSoloToView(effects);
        scheduleSolo(1200, () => runCpuTurn(expectedRound));
      } else if (card.value === 'Skip' || card.value === 'Reverse' || card.value === 'Skip All') {
        s.turn = 'guest';
        s.message = cpuForgotUno
          ? 'CPU forgot UNO (+2), but skipped you — goes again.'
          : `CPU played ${card.value} — it goes again.`;
        syncSoloToView(effects);
        scheduleSolo(1150, () => runCpuTurn(expectedRound));
      } else {
        s.turn = 'busy';
        s.message = cpuForgotUno
          ? `CPU forgot to call UNO (+2)! Your turn — ${nextColor}.`
          : s.cpuHand.length === 1
            ? `CPU called UNO! Your turn — color is ${nextColor}.`
            : `Your turn — color is ${nextColor}.`;
        syncSoloToView(effects);
        scheduleSolo(600, () => {
          const st = soloRef.current;
          if (!st || st.roundId !== expectedRound || st.winner) return;
          st.turn = 'host';
          syncSoloToView();
        });
      }
    },
    [playerName, runCpuTurn, scheduleSolo, syncSoloToView]
  );

  const commitSoloPlayerCard = useCallback(
    (cardUid: number, chosenColor: SuitColor) => {
      const s = soloRef.current;
      if (!s || s.turn !== 'host' || s.winner) return;
      const idx = s.playerHand.findIndex((c) => c.uid === cardUid);
      if (idx === -1) return;

      const card = s.playerHand[idx];
      const expectedRound = s.roundId;
      const wasUnoArmed = s.playerUnoArmed;
      s.playerUnoArmed = false;

      s.playerHand.splice(idx, 1);

      const effects: EffectEvent[] = [];
      if (card.value === 'Dump' && card.color !== 'Wild') {
        const extras: Card[] = [];
        for (let i = s.playerHand.length - 1; i >= 0; i--) {
          if (s.playerHand[i].color === card.color) {
            const [matched] = s.playerHand.splice(i, 1);
            extras.push(matched);
          }
        }
        s.discard.push(...extras);
        effects.push({
          kind: 'dump',
          whoName: playerName,
          color: chosenColor,
          count: extras.length + 1,
        });
      }

      s.discard.push(card);
      s.currentColor = chosenColor;
      s.drawnUid = null;
      effects.push({ kind: 'impact', card, activeColor: chosenColor });

      if (s.playerHand.length === 0) {
        s.pendingDrawStack = 0;
        s.pendingDrawMin = 0;
        s.turn = 'busy';
        s.message = 'Final card played!';
        syncSoloToView(effects);
        scheduleSolo(700, () => {
          const st = soloRef.current;
          if (!st || st.roundId !== expectedRound) return;
          st.winner = 'host';
          st.turn = 'over';
          st.score = { ...st.score, player: st.score.player + 1 };
          st.message = 'You win the round!';
          const milestone = recordSelfWin(`solo-${expectedRound}`);
          syncSoloToView([{ kind: 'win', winnerRole: 'host', milestone }]);
        });
        return;
      }

      let penalizedUno = false;
      if (s.playerHand.length === 1) {
        if (wasUnoArmed) {
          effects.push({ kind: 'uno', whoName: playerName, isSelf: true });
        } else {
          penalizedUno = true;
          for (let i = 0; i < 2; i++) {
            const res = drawOneFromDeck(s.deck, s.discard, s.playerHand);
            if (res.reshuffled) effects.push({ kind: 'reshuffle' });
          }
          effects.push({ kind: 'uno_penalty', whoName: playerName, isSelf: true });
        }
      }

      const drawAmount = getDrawAmount(card);
      if (drawAmount > 0) {
        if (s.difficulty === 'no_mercy') {
          s.pendingDrawStack += drawAmount;
          s.pendingDrawMin = drawAmount;
          s.turn = 'guest';
          s.message = penalizedUno
            ? `Forgot UNO (+2)! CPU faces +${s.pendingDrawStack} stack...`
            : `You stacked ${card.value}! CPU faces +${s.pendingDrawStack}...`;
          syncSoloToView(effects);
          scheduleSolo(950, () => runCpuTurn(expectedRound));
        } else {
          s.turn = 'busy';
          s.message = penalizedUno
            ? `Forgot UNO (+2)! CPU also draws ${drawAmount}!`
            : `CPU draws ${drawAmount} — play again!`;
          for (let i = 0; i < drawAmount; i++) {
            const res = drawOneFromDeck(s.deck, s.discard, s.cpuHand);
            if (res.reshuffled) effects.push({ kind: 'reshuffle' });
          }
          syncSoloToView(effects);
          scheduleSolo(1000 + drawAmount * 100, () => {
            const st = soloRef.current;
            if (!st || st.roundId !== expectedRound || st.winner) return;
            st.turn = 'host';
            st.message = 'Your turn again!';
            syncSoloToView();
          });
        }
      } else if (card.value === 'Roulette') {
        s.turn = 'busy';
        const rRes = drawColorRoulette(s.deck, s.discard, s.cpuHand, chosenColor);
        if (rRes.reshuffled) effects.push({ kind: 'reshuffle' });
        effects.push({
          kind: 'roulette',
          whoName: 'CPU',
          color: chosenColor,
          drawnCount: rRes.drawnCount,
        });

        if (s.difficulty === 'no_mercy' && s.cpuHand.length >= MERCY_HAND_LIMIT) {
          s.message = `MERCY KO! CPU hit ${s.cpuHand.length} cards!`;
          effects.push({ kind: 'mercy_ko', loserName: 'CPU', isSelfLoser: false });
          syncSoloToView(effects);
          scheduleSolo(950, () => {
            const st = soloRef.current;
            if (!st || st.roundId !== expectedRound) return;
            st.winner = 'host';
            st.turn = 'over';
            st.score = { ...st.score, player: st.score.player + 1 };
            st.message = 'You win by Mercy Rule KO!';
            const milestone = recordSelfWin(`solo-${expectedRound}`);
            syncSoloToView([{ kind: 'win', winnerRole: 'host', milestone }]);
          });
          return;
        }

        s.message = `Color Roulette (${chosenColor}) — CPU drew ${rRes.drawnCount}! Play again.`;
        syncSoloToView(effects);
        scheduleSolo(1100, () => {
          const st = soloRef.current;
          if (!st || st.roundId !== expectedRound || st.winner) return;
          st.turn = 'host';
          syncSoloToView();
        });
      } else if (card.value === 'Skip' || card.value === 'Reverse' || card.value === 'Skip All') {
        s.turn = 'busy';
        s.message = penalizedUno
          ? 'Forgot UNO (+2)! CPU skipped — play again.'
          : 'CPU skipped — play again!';
        syncSoloToView(effects);
        scheduleSolo(900, () => {
          const st = soloRef.current;
          if (!st || st.roundId !== expectedRound || st.winner) return;
          st.turn = 'host';
          st.message = 'Your turn again!';
          syncSoloToView();
        });
      } else {
        s.turn = 'guest';
        s.message = penalizedUno ? 'Forgot UNO! +2 penalty cards.' : 'CPU is thinking...';
        syncSoloToView(effects);
        scheduleSolo(950, () => runCpuTurn(expectedRound));
      }
    },
    [playerName, recordSelfWin, runCpuTurn, scheduleSolo, syncSoloToView]
  );

  const sendWsAction = useCallback((action: ClientWsAction) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(action));
    }
  }, []);

  const connectMultiplayer = useCallback(
    (targetRoomId: string, targetToken: string, joinName: string) => {
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }

      const clientId = getOrCreateClientId(targetRoomId);
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${proto}//${window.location.host}/ws`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.addEventListener('open', () => {
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
          if (msg.view.opponentConnected && showQrModal) {
            setShowQrModal(false);
          }
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
        if (wsRef.current === ws) {
          reconnectTimerRef.current = window.setTimeout(() => {
            if (mode === 'multiplayer' && roomId === targetRoomId && roomToken === targetToken) {
              connectMultiplayer(targetRoomId, targetToken, joinName);
            }
          }, 1500);
        }
      });
    },
    [mode, playSoundForEffects, recordSelfWin, roomId, roomToken, showQrModal]
  );

  useEffect(() => {
    return () => {
      clearSoloTimers();
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) wsRef.current.close();
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
        body: JSON.stringify({ hostName: cleanName, difficulty }),
      });
      if (!res.ok) throw new Error('Could not create multiplayer room.');
      const data = (await res.json()) as { roomId: string; token: string };
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
    const cleanName = nameDraft.trim() || 'Player 2';
    setPlayerName(cleanName);
    try {
      localStorage.setItem('puno-player-name', cleanName);
    } catch {
      // ignore
    }
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
    if (!s || s.turn !== 'host' || s.playerUnoArmed) return;
    s.playerUnoArmed = true;
    s.message = 'UNO armed! Play your card.';
    syncSoloToView([{ kind: 'uno', whoName: playerName, isSelf: true }]);
  }, [activeView, mode, pendingWildUid, playerName, sendWsAction, syncSoloToView]);

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
    const expectedRound = s.roundId;
    s.playerUnoArmed = false;

    if (s.pendingDrawStack > 0) {
      const stackCount = s.pendingDrawStack;
      const effs: EffectEvent[] = [];
      for (let i = 0; i < stackCount; i++) {
        const res = drawOneFromDeck(s.deck, s.discard, s.playerHand);
        if (res.reshuffled) effs.push({ kind: 'reshuffle' });
      }
      s.pendingDrawStack = 0;
      s.pendingDrawMin = 0;
      s.drawnUid = null;
      soundFx.playDraw();

      if (s.difficulty === 'no_mercy' && s.playerHand.length >= MERCY_HAND_LIMIT) {
        s.turn = 'busy';
        s.message = `MERCY KO! You reached ${s.playerHand.length} cards!`;
        syncSoloToView([
          ...effs,
          { kind: 'mercy_ko', loserName: playerName, isSelfLoser: true },
        ]);
        scheduleSolo(950, () => {
          const st = soloRef.current;
          if (!st || st.roundId !== expectedRound) return;
          st.winner = 'guest';
          st.turn = 'over';
          st.score = { ...st.score, cpu: st.score.cpu + 1 };
          st.message = 'CPU wins by Mercy Rule KO!';
          setWinMilestone(null);
          syncSoloToView([{ kind: 'win', winnerRole: 'guest' }]);
        });
        return;
      }

      s.turn = 'guest';
      s.message = `You took +${stackCount} cards. CPU's turn.`;
      syncSoloToView(effs);
      scheduleSolo(850, () => runCpuTurn(expectedRound));
      return;
    }

    if (s.drawnUid !== null) {
      s.drawnUid = null;
      s.turn = 'guest';
      s.message = "You passed. CPU's turn.";
      syncSoloToView();
      scheduleSolo(850, () => runCpuTurn(expectedRound));
      return;
    }

    const { card, reshuffled } = drawOneFromDeck(s.deck, s.discard, s.playerHand);
    const effects: EffectEvent[] = reshuffled ? [{ kind: 'reshuffle' }] : [];
    soundFx.playDraw();

    if (s.difficulty === 'no_mercy' && s.playerHand.length >= MERCY_HAND_LIMIT) {
      s.turn = 'busy';
      s.message = `MERCY KO! You reached ${s.playerHand.length} cards!`;
      syncSoloToView([
        ...effects,
        { kind: 'mercy_ko', loserName: playerName, isSelfLoser: true },
      ]);
      scheduleSolo(950, () => {
        const st = soloRef.current;
        if (!st || st.roundId !== expectedRound) return;
        st.winner = 'guest';
        st.turn = 'over';
        st.score = { ...st.score, cpu: st.score.cpu + 1 };
        st.message = 'CPU wins by Mercy Rule KO!';
        setWinMilestone(null);
        syncSoloToView([{ kind: 'win', winnerRole: 'guest' }]);
      });
      return;
    }

    if (!card) {
      s.turn = 'guest';
      s.message = 'No cards left to draw — turn passes.';
      syncSoloToView(effects);
      scheduleSolo(850, () => runCpuTurn(expectedRound));
      return;
    }

    s.drawnUid = card.uid;
    const top = s.discard[s.discard.length - 1];
    s.message = canPlayCard(card, top, s.currentColor)
      ? 'You drew a playable card — play it or pass.'
      : 'No match — pass your turn.';
    syncSoloToView(effects);
  }, [activeView, mode, pendingWildUid, playerName, runCpuTurn, scheduleSolo, sendWsAction, syncSoloToView]);

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
      startSoloRound(playerName, true, difficulty);
    }
  }, [difficulty, mode, playerName, sendWsAction, startSoloRound]);

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
    return `${window.location.origin}/?room=${encodeURIComponent(roomId)}&token=${encodeURIComponent(roomToken)}`;
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
              if (wsRef.current) {
                wsRef.current.close();
                wsRef.current = null;
              }
              setScreen('TITLE_MENU');
            }
          }}
          className="font-display text-xl sm:text-2xl font-extrabold italic tracking-tight whitespace-nowrap shrink-0 hover:opacity-90 transition-opacity focus-visible:outline-2 focus-visible:outline-white rounded"
          style={{ color: activeTheme.accent }}
        >
          PUNO
        </button>

        {activeView && screen !== 'TITLE_MENU' ? (
          <div className="hidden md:flex items-center gap-3 text-sm text-[#9fb3b0] font-mono-tabular whitespace-nowrap overflow-hidden">
            <span className="text-[#f4f4ed] font-semibold truncate max-w-[120px]">
              {activeView.selfName}
            </span>
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
          <div className="hidden md:flex items-center gap-3 text-xs text-[#9fb3b0] whitespace-nowrap">
            <span>{activeTheme.label}</span>
          </div>
        )}

        <div className="flex items-center gap-2 shrink-0">
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
          <div
            className="flex-1 flex items-center justify-center p-4 sm:p-8 overflow-y-auto transition-all duration-500"
            style={{
              background: `radial-gradient(ellipse at 50% 35%, ${activeTheme.feltMid} 0%, ${activeTheme.bgMid} 58%, ${activeTheme.bgTop} 100%)`,
            }}
          >
            <div className="w-full max-w-4xl grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
              {/* Left Animated Card Fan Preview (reflects chosen theme's card design) */}
              <div className="hidden lg:flex lg:col-span-5 items-center justify-center py-8">
                <div className="relative w-72 h-72 flex items-center justify-center">
                  <motion.div
                    animate={{ scale: [1, 1.03, 1], opacity: [0.85, 1, 0.85] }}
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

              {/* Right Minimal Setup Card */}
              <motion.div
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                className="lg:col-span-7 w-full rounded-2xl p-6 sm:p-8 shadow-2xl border backdrop-blur-md"
                style={{
                  backgroundColor: `${activeTheme.surface}eb`,
                  borderColor: activeTheme.surfaceBorder,
                }}
              >
                <div className="mb-5">
                  <h1
                    className="font-display text-5xl sm:text-6xl font-extrabold italic tracking-tight mb-1"
                    style={{ color: activeTheme.accent }}
                  >
                    PUNO
                  </h1>
                  {isGuestInvite && (
                    <p className="text-sm text-[#c7d4d2]">
                      Room {inviteRoomParam} invite
                    </p>
                  )}
                </div>

                {/* Theme Swatches */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 mb-5">
                  {THEME_LIST.map((t, idx) => {
                    const selected = t.id === themeId;
                    return (
                      <motion.button
                        key={t.id}
                        type="button"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: idx * 0.04, duration: 0.25 }}
                        whileHover={{ y: -2, scale: 1.02 }}
                        whileTap={{ scale: 0.97 }}
                        onClick={() => selectTheme(t.id)}
                        className={`flex items-center gap-2 rounded-xl h-11 px-3 border transition-colors focus-visible:outline-2 focus-visible:outline-white ${
                          selected ? 'shadow-md' : 'opacity-75 hover:opacity-100'
                        }`}
                        style={{
                          backgroundColor: t.bgMid,
                          borderColor: selected ? t.accent : t.surfaceBorder,
                        }}
                      >
                        <span
                          className="w-3.5 h-3.5 rounded-full border shrink-0"
                          style={{
                            backgroundColor: t.feltCenter,
                            borderColor: t.railTrim,
                          }}
                        />
                        <span className="text-xs font-bold text-[#f4f4ed] truncate">
                          {t.label}
                        </span>
                      </motion.button>
                    );
                  })}
                </div>

                {/* Difficulty Meter */}
                {!isGuestInvite && (
                  <div className="mb-5">
                    <div className="flex items-center justify-between text-xs mb-2">
                      <span className="font-semibold text-[#9fb3b0]">Difficulty Meter</span>
                      <span
                        className="font-bold flex items-center gap-1.5"
                        style={{ color: activeDifficulty.accent }}
                      >
                        {difficulty === 'no_mercy' && <Skull className="w-3.5 h-3.5" />}
                        <span>
                          {activeDifficulty.label} · {activeDifficulty.tier}
                        </span>
                      </span>
                    </div>

                    <div
                      className="grid grid-cols-4 gap-1.5 p-1 rounded-xl border bg-black/25"
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
                            className={`relative h-10 rounded-lg text-xs font-bold transition-all whitespace-nowrap px-2 focus-visible:outline-2 focus-visible:outline-white ${
                              selected ? 'text-[#10141e] shadow-sm' : 'text-[#c7d4d2] hover:text-white'
                            }`}
                            style={
                              selected
                                ? { backgroundColor: d.accent }
                                : { backgroundColor: 'transparent' }
                            }
                          >
                            {d.label}
                          </button>
                        );
                      })}
                    </div>

                    {/* Visual 4-bar meter track */}
                    <div className="grid grid-cols-4 gap-1.5 mt-2" aria-hidden="true">
                      {DIFFICULTY_LIST.map((d) => {
                        const filled = d.level <= activeDifficulty.level;
                        return (
                          <div
                            key={d.id}
                            className="h-1.5 rounded-full transition-all duration-300"
                            style={{
                              backgroundColor: filled
                                ? activeDifficulty.accent
                                : 'rgba(255,255,255,0.1)',
                              boxShadow:
                                filled && difficulty === 'no_mercy'
                                  ? `0 0 10px ${activeDifficulty.accent}99`
                                  : undefined,
                            }}
                          />
                        );
                      })}
                    </div>

                    <p className="mt-2 text-xs text-[#b8cac8] leading-snug">
                      {activeDifficulty.summary}
                    </p>
                  </div>
                )}

                {/* Display Name */}
                <div className="mb-5">
                  <input
                    id="player-name-input"
                    aria-label="Your display name"
                    type="text"
                    maxLength={18}
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    placeholder="Your name"
                    className="w-full h-11 px-4 rounded-xl bg-black/30 border text-[#f4f4ed] text-sm focus:outline-none transition-colors"
                    style={{ borderColor: activeTheme.surfaceBorder }}
                  />
                </div>

                {networkError && (
                  <div className="mb-5 rounded-xl bg-[#ee3f4f]/15 border border-[#ee3f4f]/50 px-4 py-3 text-sm text-[#ffb4bc]">
                    {networkError}
                  </div>
                )}

                {isGuestInvite ? (
                  <div className="flex flex-col sm:flex-row gap-3">
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
                        window.history.replaceState({}, '', '/');
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
                      Play vs CPU
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
                      <span>{roomBusy ? 'Creating...' : 'Host 2P QR'}</span>
                    </motion.button>
                  </div>
                )}
              </motion.div>
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

            {activeView && (
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
                  {isSelfWin ? 'YOU WIN!' : `${activeView.opponentName.toUpperCase()} WINS`}
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

                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.18 }}
                  className="text-lg font-mono-tabular font-bold text-[#f4f4ed] mt-2 mb-2"
                >
                  {activeView.selfName} {activeView.score.self} : {activeView.score.opponent}{' '}
                  {activeView.opponentName}
                </motion.div>

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
                      if (wsRef.current) {
                        wsRef.current.close();
                        wsRef.current = null;
                      }
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
          opponentConnected={Boolean(multiView?.opponentConnected)}
          opponentName={multiView?.opponentName || 'Friend'}
          theme={activeTheme}
          onClose={() => setShowQrModal(false)}
        />
      )}
    </div>
  );
}
