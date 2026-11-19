import { motion } from 'motion/react';
import type { TableTheme } from '../game/themes.ts';

interface PunoLogoProps {
  theme: TableTheme;
  size?: 'sm' | 'md' | 'lg';
}

export function PunoLogo({ theme, size = 'lg' }: PunoLogoProps) {
  if (size === 'sm') {
    return (
      <span className="relative inline-flex items-center justify-center select-none px-1.5 py-0.5">
        {/* Left peeking mini suit card */}
        <span
          aria-hidden="true"
          className="absolute -left-0.5 -top-0.5 w-3.5 h-5 rounded-[3px] border border-white/80 -rotate-12 shadow-sm pointer-events-none"
          style={{ backgroundColor: theme.suitHex.Blue }}
        />

        {/* Right peeking mini suit card */}
        <span
          aria-hidden="true"
          className="absolute -right-0.5 -bottom-0.5 w-3.5 h-5 rounded-[3px] border border-white/80 rotate-12 shadow-sm pointer-events-none"
          style={{ backgroundColor: theme.suitHex.Green }}
        />

        {/* Tilted Crest Plate */}
        <span
          className="relative -rotate-3 rounded-xl border-[1.5px] px-2.5 py-0.5 shadow-md overflow-hidden inline-flex items-center justify-center"
          style={{
            background: `linear-gradient(145deg, ${theme.suitHex.Red} 0%, #991b1b 55%, #450a0a 100%)`,
            borderColor: '#ffffffeb',
            boxShadow: `0 4px 12px rgba(0,0,0,0.45), 0 0 0 1.5px ${theme.accent}66`,
          }}
        >
          <span
            aria-hidden="true"
            className="absolute inset-x-1 inset-y-0.5 rounded-full -rotate-3 border border-white/25 pointer-events-none"
            style={{
              background: `radial-gradient(ellipse at 35% 30%, ${theme.suitHex.Yellow}2e, transparent 70%)`,
            }}
          />
          <motion.span
            aria-hidden="true"
            animate={{ x: ['-140%', '240%'] }}
            transition={{ duration: 2.2, repeat: Infinity, repeatDelay: 3.4, ease: 'easeInOut' }}
            className="pointer-events-none absolute inset-y-0 left-0 w-1/3 -skew-x-12"
            style={{
              background:
                'linear-gradient(90deg, transparent, rgba(255,255,255,0.28), transparent)',
            }}
          />
          <span
            className="relative font-display text-lg sm:text-xl font-black italic tracking-tight leading-none"
            style={{
              color: theme.suitHex.Yellow,
              WebkitTextStroke: '1px #140b0e',
              textShadow: `0 2px 0 #140b0e, 0 3px 6px rgba(0,0,0,0.6)`,
            }}
          >
            PUNO
          </span>
        </span>

        {/* Tiny 4-suit corner gem */}
        <span
          aria-hidden="true"
          className="absolute -bottom-1 right-1 flex items-center gap-0.5 px-1 py-[1px] rounded-full border shadow-sm"
          style={{
            backgroundColor: theme.bgTop,
            borderColor: theme.surfaceBorder,
          }}
        >
          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: theme.suitHex.Red }} />
          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: theme.suitHex.Blue }} />
          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: theme.suitHex.Green }} />
          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: theme.suitHex.Yellow }} />
        </span>
      </span>
    );
  }

  const isLg = size === 'lg';

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9, y: -8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 20 }}
      className="relative inline-flex items-center justify-center select-none py-2 px-5"
    >
      {/* Ambient aura glow behind logo */}
      <motion.div
        aria-hidden="true"
        animate={{ scale: [0.96, 1.06, 0.96], opacity: [0.45, 0.72, 0.45] }}
        transition={{ duration: 4.2, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute inset-0 rounded-full blur-2xl pointer-events-none"
        style={{
          background: `radial-gradient(circle, ${theme.suitHex.Red}66 0%, ${theme.accent}40 55%, transparent 75%)`,
        }}
      />

      {/* Left peeking suit card */}
      <motion.div
        aria-hidden="true"
        animate={{ y: [0, -4, 0], rotate: [-18, -14, -18] }}
        transition={{ duration: 4.5, repeat: Infinity, ease: 'easeInOut' }}
        className={`absolute ${isLg ? '-left-2 -top-1 w-10 h-14' : 'left-0 top-0 w-8 h-11'} rounded-lg border-2 shadow-lg pointer-events-none`}
        style={{
          backgroundColor: theme.suitHex.Blue,
          borderColor: '#ffffffcc',
        }}
      >
        <div className="w-full h-full rounded-md flex items-center justify-center">
          <div className="w-4 h-6 rounded-full border border-white/40 bg-white/15 rotate-12" />
        </div>
      </motion.div>

      {/* Right peeking suit card */}
      <motion.div
        aria-hidden="true"
        animate={{ y: [0, 4, 0], rotate: [16, 20, 16] }}
        transition={{ duration: 4.8, delay: 0.5, repeat: Infinity, ease: 'easeInOut' }}
        className={`absolute ${isLg ? '-right-2 -bottom-1 w-10 h-14' : 'right-0 bottom-0 w-8 h-11'} rounded-lg border-2 shadow-lg pointer-events-none`}
        style={{
          backgroundColor: theme.suitHex.Green,
          borderColor: '#ffffffcc',
        }}
      >
        <div className="w-full h-full rounded-md flex items-center justify-center">
          <div className="w-4 h-6 rounded-full border border-white/40 bg-white/15 rotate-12" />
        </div>
      </motion.div>

      {/* Tilted Crest Plate */}
      <div
        className={`relative -rotate-3 rounded-[28px] border-2 shadow-2xl overflow-hidden ${
          isLg ? 'px-7 py-2.5' : 'px-6 py-2'
        }`}
        style={{
          background: `linear-gradient(145deg, ${theme.suitHex.Red} 0%, #991b1b 55%, #450a0a 100%)`,
          borderColor: '#ffffffeb',
          boxShadow: `0 14px 34px rgba(0,0,0,0.55), 0 0 0 3px ${theme.accent}66`,
        }}
      >
        {/* Diagonal tilted inner oval like classic card crest */}
        <div
          aria-hidden="true"
          className="absolute inset-x-2 inset-y-1 rounded-full -rotate-3 border border-white/25 pointer-events-none"
          style={{
            background: `radial-gradient(ellipse at 35% 30%, ${theme.suitHex.Yellow}2e, transparent 70%)`,
          }}
        />

        {/* Sweeping gloss gleam */}
        <motion.div
          aria-hidden="true"
          animate={{ x: ['-140%', '240%'] }}
          transition={{ duration: 2.2, repeat: Infinity, repeatDelay: 3.4, ease: 'easeInOut' }}
          className="pointer-events-none absolute inset-y-0 left-0 w-1/3 -skew-x-12"
          style={{
            background:
              'linear-gradient(90deg, transparent, rgba(255,255,255,0.28), transparent)',
          }}
        />

        {/* Multi-layer extruded PUNO title */}
        <h1
          className={`relative font-display font-black italic tracking-tight leading-none ${
            isLg ? 'text-6xl' : 'text-5xl'
          }`}
          style={{
            color: theme.suitHex.Yellow,
            WebkitTextStroke: '2px #140b0e',
            textShadow: `0 4px 0 #140b0e, 0 7px 14px rgba(0,0,0,0.65), 0 0 24px ${theme.accent}55`,
          }}
        >
          PUNO
        </h1>
      </div>

      {/* Tiny 4-suit corner gem */}
      <div
        aria-hidden="true"
        className="absolute -bottom-1 right-5 flex items-center gap-1 px-1.5 py-0.5 rounded-full border shadow-md"
        style={{
          backgroundColor: theme.bgTop,
          borderColor: theme.surfaceBorder,
        }}
      >
        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: theme.suitHex.Red }} />
        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: theme.suitHex.Blue }} />
        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: theme.suitHex.Green }} />
        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: theme.suitHex.Yellow }} />
      </div>
    </motion.div>
  );
}

interface FloatingCardSpec {
  id: number;
  left: string;
  top: string;
  suit: 'Red' | 'Blue' | 'Green' | 'Yellow';
  symbol: string;
  rotate: number;
  driftX: number;
  driftY: number;
  duration: number;
  delay: number;
  scale: number;
}

const AMBIENT_CARDS: FloatingCardSpec[] = [
  { id: 1, left: '5%', top: '12%', suit: 'Red', symbol: '+4', rotate: -18, driftX: 16, driftY: -22, duration: 9.5, delay: 0, scale: 0.9 },
  { id: 2, left: '15%', top: '76%', suit: 'Blue', symbol: '↺', rotate: 14, driftX: -14, driftY: -26, duration: 11, delay: 0.8, scale: 0.85 },
  { id: 3, left: '84%', top: '12%', suit: 'Yellow', symbol: '7', rotate: 22, driftX: -18, driftY: 20, duration: 10.2, delay: 0.4, scale: 0.95 },
  { id: 4, left: '84%', top: '76%', suit: 'Green', symbol: '+2', rotate: -14, driftX: 14, driftY: -24, duration: 12, delay: 1.2, scale: 0.85 },
  { id: 5, left: '46%', top: '8%', suit: 'Green', symbol: '⊘', rotate: 10, driftX: 18, driftY: 16, duration: 13, delay: 1.7, scale: 0.72 },
  { id: 6, left: '52%', top: '86%', suit: 'Red', symbol: '9', rotate: -22, driftX: -20, driftY: -18, duration: 11.5, delay: 0.6, scale: 0.75 },
  { id: 7, left: '28%', top: '20%', suit: 'Yellow', symbol: '+10', rotate: -8, driftX: 12, driftY: 20, duration: 14, delay: 2.1, scale: 0.68 },
  { id: 8, left: '72%', top: '82%', suit: 'Blue', symbol: '★', rotate: 16, driftX: -12, driftY: -16, duration: 12.5, delay: 1.5, scale: 0.72 },
];

export function HomeBackdrop({ theme }: { theme: TableTheme }) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {/* Base deep felt radial backdrop */}
      <div
        className="absolute inset-0 transition-colors duration-700"
        style={{
          background: `radial-gradient(ellipse at 50% 40%, ${theme.feltMid} 0%, ${theme.bgMid} 56%, ${theme.bgTop} 100%)`,
        }}
      />

      {/* Drifting ambient suit glows */}
      <motion.div
        animate={{
          x: ['-6%', '8%', '-6%'],
          y: ['-4%', '10%', '-4%'],
          scale: [1, 1.18, 1],
        }}
        transition={{ duration: 16, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute -top-24 -left-24 w-[420px] h-[420px] rounded-full blur-3xl opacity-25"
        style={{ backgroundColor: theme.suitHex.Blue }}
      />
      <motion.div
        animate={{
          x: ['6%', '-10%', '6%'],
          y: ['6%', '-8%', '6%'],
          scale: [1.05, 0.9, 1.05],
        }}
        transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute -bottom-28 -right-24 w-[460px] h-[460px] rounded-full blur-3xl opacity-25"
        style={{ backgroundColor: theme.suitHex.Red }}
      />
      <motion.div
        animate={{
          x: ['-8%', '10%', '-8%'],
          y: ['8%', '-6%', '8%'],
          opacity: [0.14, 0.24, 0.14],
        }}
        transition={{ duration: 14, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[520px] h-[340px] rounded-full blur-3xl"
        style={{ backgroundColor: theme.accent }}
      />

      {/* Slowly rotating subtle table rings */}
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 68, repeat: Infinity, ease: 'linear' }}
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[780px] h-[780px] rounded-full border border-dashed opacity-15"
        style={{ borderColor: theme.railTrim }}
      />
      <motion.div
        animate={{ rotate: -360 }}
        transition={{ duration: 92, repeat: Infinity, ease: 'linear' }}
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[1040px] h-[1040px] rounded-full border opacity-10"
        style={{ borderColor: theme.accent }}
      />

      {/* Subtle felt dot grid texture */}
      <div
        className="absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage: `radial-gradient(${theme.railTrim} 1px, transparent 1px)`,
          backgroundSize: '28px 28px',
        }}
      />

      {/* Floating ambient silhouette cards */}
      {AMBIENT_CARDS.map((card, index) => {
        const suitColor = theme.suitHex[card.suit];
        return (
          <motion.div
            key={card.id}
            initial={{ opacity: 0 }}
            animate={{
              opacity: [0.14, 0.26, 0.14],
              x: [0, card.driftX, 0],
              y: [0, card.driftY, 0],
              rotate: [card.rotate - 4, card.rotate + 5, card.rotate - 4],
            }}
            transition={{
              duration: card.duration,
              delay: card.delay,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
            className={`absolute w-12 h-18 sm:w-16 sm:h-24 rounded-xl p-1 border shadow-xl ${
              index >= 4 ? 'hidden sm:block' : 'block'
            }`}
            style={{
              left: card.left,
              top: card.top,
              scale: card.scale,
              backgroundColor: theme.cardFrame,
              borderColor: 'rgba(255,255,255,0.22)',
            }}
          >
            <div
              className="w-full h-full rounded-lg flex items-center justify-center relative overflow-hidden border border-white/25"
              style={{ backgroundColor: suitColor }}
            >
              <div className="w-8 h-12 sm:w-10 sm:h-14 rounded-full border border-white/35 bg-white/15 rotate-12" />
              <span className="absolute font-display font-black italic text-sm sm:text-base text-white drop-shadow">
                {card.symbol}
              </span>
            </div>
          </motion.div>
        );
      })}

      {/* Soft edge vignette for foreground legibility */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse at center, transparent 45%, rgba(0, 0, 0, 0.46) 100%)',
        }}
      />
    </div>
  );
}
