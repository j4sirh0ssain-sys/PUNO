import { motion, useReducedMotion } from 'motion/react';
import { getBomboclattCardArtUrl, type DifficultyLevel, type SuitColor } from '../game/types.ts';
import type { TableTheme } from '../game/themes.ts';

interface PunoLogoProps {
  theme: TableTheme;
  size?: 'sm' | 'md' | 'lg';
}

export function PunoLogo({ theme, size = 'lg' }: PunoLogoProps) {
  if (size === 'sm') {
    return (
      <span className="relative inline-flex items-center justify-center select-none px-1.5 py-0.5">
        <span
          aria-hidden="true"
          className="absolute -left-0.5 -top-0.5 w-3.5 h-5 rounded-[3px] border border-white/80 -rotate-12 shadow-sm pointer-events-none"
          style={{ backgroundColor: theme.suitHex.Blue }}
        />

        <span
          aria-hidden="true"
          className="absolute -right-0.5 -bottom-0.5 w-3.5 h-5 rounded-[3px] border border-white/80 rotate-12 shadow-sm pointer-events-none"
          style={{ backgroundColor: theme.suitHex.Green }}
        />

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
              textShadow: '0 2px 0 #140b0e, 0 3px 6px rgba(0,0,0,0.6)',
            }}
          >
            PUNO
          </span>
        </span>
      </span>
    );
  }

  const isLg = size === 'lg';

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.94, y: -6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 280, damping: 22 }}
      className="relative inline-flex items-center justify-center select-none py-2 px-4"
    >
      <motion.div
        aria-hidden="true"
        animate={{ y: [0, -3, 0], rotate: [-16, -13, -16] }}
        transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
        className={`absolute ${isLg ? '-left-1 -top-1 w-9 h-13' : 'left-0 top-0 w-7 h-10'} rounded-lg border-2 shadow-lg pointer-events-none`}
        style={{
          backgroundColor: theme.suitHex.Blue,
          borderColor: '#ffffffcc',
        }}
      >
        <div className="w-full h-full rounded-md flex items-center justify-center">
          <div className="w-3.5 h-5 rounded-full border border-white/40 bg-white/15 rotate-12" />
        </div>
      </motion.div>

      <motion.div
        aria-hidden="true"
        animate={{ y: [0, 3, 0], rotate: [15, 18, 15] }}
        transition={{ duration: 5.2, delay: 0.4, repeat: Infinity, ease: 'easeInOut' }}
        className={`absolute ${isLg ? '-right-1 -bottom-1 w-9 h-13' : 'right-0 bottom-0 w-7 h-10'} rounded-lg border-2 shadow-lg pointer-events-none`}
        style={{
          backgroundColor: theme.suitHex.Green,
          borderColor: '#ffffffcc',
        }}
      >
        <div className="w-full h-full rounded-md flex items-center justify-center">
          <div className="w-3.5 h-5 rounded-full border border-white/40 bg-white/15 rotate-12" />
        </div>
      </motion.div>

      <div
        className={`relative -rotate-3 rounded-[24px] border-2 shadow-2xl overflow-hidden ${
          isLg ? 'px-7 py-2.5' : 'px-5 py-2'
        }`}
        style={{
          background: `linear-gradient(145deg, ${theme.suitHex.Red} 0%, #991b1b 55%, #450a0a 100%)`,
          borderColor: '#ffffffeb',
          boxShadow: `0 14px 32px rgba(0,0,0,0.52), 0 0 0 2.5px ${theme.accent}66`,
        }}
      >
        <div
          aria-hidden="true"
          className="absolute inset-x-2 inset-y-1 rounded-full -rotate-3 border border-white/25 pointer-events-none"
          style={{
            background: `radial-gradient(ellipse at 35% 30%, ${theme.suitHex.Yellow}2e, transparent 70%)`,
          }}
        />

        <motion.div
          aria-hidden="true"
          animate={{ x: ['-140%', '240%'] }}
          transition={{ duration: 2.2, repeat: Infinity, repeatDelay: 3.6, ease: 'easeInOut' }}
          className="pointer-events-none absolute inset-y-0 left-0 w-1/3 -skew-x-12"
          style={{
            background:
              'linear-gradient(90deg, transparent, rgba(255,255,255,0.26), transparent)',
          }}
        />

        <span
          className={`relative block font-display font-black italic tracking-tight leading-none ${
            isLg ? 'text-5xl' : 'text-4xl'
          }`}
          style={{
            color: theme.suitHex.Yellow,
            WebkitTextStroke: '1.8px #140b0e',
            textShadow: `0 3px 0 #140b0e, 0 6px 12px rgba(0,0,0,0.6)`,
          }}
        >
          PUNO
        </span>
      </div>
    </motion.div>
  );
}

interface AmbientFloatingCardSpec {
  id: string;
  suit: SuitColor | 'Wild';
  label: string;
  kind: 'face' | 'back';
  left: string;
  top: string;
  width: number;
  height: number;
  baseRotate: number;
  driftX: number;
  driftY: number;
  rotateDelta: number;
  duration: number;
  delay: number;
  opacity: number;
  bomboclattLabel?: string;
}

const AMBIENT_CARDS: AmbientFloatingCardSpec[] = [
  { id: 'bg-1', suit: 'Red', label: '+2', kind: 'face', left: '2%', top: '10%', width: 88, height: 128, baseRotate: -18, driftX: 22, driftY: -28, rotateDelta: 9, duration: 11, delay: 0, opacity: 0.34, bomboclattLabel: 'Rizzler Arvin' },
  { id: 'bg-2', suit: 'Blue', label: '⊘', kind: 'face', left: '8%', top: '66%', width: 82, height: 118, baseRotate: 14, driftX: -18, driftY: -26, rotateDelta: -8, duration: 13.5, delay: 1.1, opacity: 0.3, bomboclattLabel: 'Gooner Surjo' },
  { id: 'bg-3', suit: 'Wild', label: '+4', kind: 'face', left: '43%', top: '4%', width: 78, height: 112, baseRotate: 19, driftX: 24, driftY: -20, rotateDelta: 10, duration: 12.2, delay: 0.6, opacity: 0.28, bomboclattLabel: 'Rafath Kauwa' },
  { id: 'bg-4', suit: 'Yellow', label: '7', kind: 'face', left: '88%', top: '8%', width: 92, height: 132, baseRotate: 17, driftX: -24, driftY: -28, rotateDelta: -9, duration: 12.8, delay: 1.7, opacity: 0.34, bomboclattLabel: 'Toothpick Alif' },
  { id: 'bg-5', suit: 'Green', label: '↺', kind: 'face', left: '90%', top: '64%', width: 86, height: 124, baseRotate: -21, driftX: -20, driftY: -24, rotateDelta: 10, duration: 14.5, delay: 0.8, opacity: 0.32 },
  { id: 'bg-6', suit: 'Red', label: '+10', kind: 'face', left: '49%', top: '81%', width: 82, height: 118, baseRotate: -11, driftX: 20, driftY: -26, rotateDelta: 8, duration: 11.8, delay: 1.5, opacity: 0.28 },
  { id: 'bg-7', suit: 'Blue', label: 'PUNO', kind: 'back', left: '22%', top: '82%', width: 74, height: 106, baseRotate: -24, driftX: 16, driftY: -22, rotateDelta: -7, duration: 15, delay: 2.3, opacity: 0.24 },
  { id: 'bg-8', suit: 'Yellow', label: '★', kind: 'face', left: '72%', top: '79%', width: 78, height: 112, baseRotate: 23, driftX: -16, driftY: -22, rotateDelta: 8, duration: 13.2, delay: 0.4, opacity: 0.25 },
  { id: 'bg-9', suit: 'Green', label: '9', kind: 'face', left: '27%', top: '6%', width: 72, height: 104, baseRotate: -14, driftX: 18, driftY: -18, rotateDelta: 7, duration: 14, delay: 2.0, opacity: 0.24 },
  { id: 'bg-10', suit: 'Wild', label: 'ALL', kind: 'face', left: '68%', top: '6%', width: 76, height: 110, baseRotate: -16, driftX: -18, driftY: -20, rotateDelta: -8, duration: 12.5, delay: 1.3, opacity: 0.26 },
];

interface RisingCardStreamSpec {
  id: string;
  suit: SuitColor | 'Wild';
  label: string;
  left: string;
  width: number;
  height: number;
  startRotate: number;
  endRotate: number;
  swayX: number;
  duration: number;
  delay: number;
}

const RISING_CARD_STREAM: RisingCardStreamSpec[] = [
  { id: 'rs-1', suit: 'Red', label: '5', left: '14%', width: 68, height: 98, startRotate: -18, endRotate: 14, swayX: 28, duration: 22, delay: 0 },
  { id: 'rs-2', suit: 'Blue', label: '+2', left: '38%', width: 74, height: 106, startRotate: 12, endRotate: -16, swayX: -26, duration: 26, delay: 6 },
  { id: 'rs-3', suit: 'Yellow', label: '↺', left: '61%', width: 70, height: 100, startRotate: -10, endRotate: 20, swayX: 24, duration: 24, delay: 11 },
  { id: 'rs-4', suit: 'Green', label: '⊘', left: '82%', width: 72, height: 104, startRotate: 16, endRotate: -12, swayX: -24, duration: 25, delay: 3 },
];

interface AmbientMoteSpec {
  id: string;
  left: string;
  top: string;
  size: number;
  riseY: number;
  driftX: number;
  duration: number;
  delay: number;
}

const AMBIENT_MOTES: AmbientMoteSpec[] = [
  { id: 'm1', left: '10%', top: '28%', size: 3, riseY: -65, driftX: 12, duration: 9, delay: 0 },
  { id: 'm2', left: '22%', top: '62%', size: 2.5, riseY: -80, driftX: -10, duration: 11, delay: 1.2 },
  { id: 'm3', left: '34%', top: '20%', size: 3.5, riseY: -55, driftX: 14, duration: 10, delay: 2.4 },
  { id: 'm4', left: '42%', top: '78%', size: 2, riseY: -75, driftX: -12, duration: 12, delay: 0.6 },
  { id: 'm5', left: '58%', top: '34%', size: 3, riseY: -70, driftX: 10, duration: 9.5, delay: 1.9 },
  { id: 'm6', left: '66%', top: '70%', size: 2.5, riseY: -62, driftX: -14, duration: 10.5, delay: 3.1 },
  { id: 'm7', left: '76%', top: '24%', size: 3.5, riseY: -72, driftX: 12, duration: 11.5, delay: 0.9 },
  { id: 'm8', left: '84%', top: '54%', size: 2.5, riseY: -68, driftX: -10, duration: 10, delay: 2.7 },
  { id: 'm9', left: '94%', top: '40%', size: 3, riseY: -58, driftX: -12, duration: 12.5, delay: 1.5 },
  { id: 'm10', left: '14%', top: '88%', size: 2.5, riseY: -74, driftX: 16, duration: 11, delay: 3.8 },
  { id: 'm11', left: '49%', top: '52%', size: 2, riseY: -64, driftX: 10, duration: 9.2, delay: 2.2 },
  { id: 'm12', left: '72%', top: '86%', size: 3, riseY: -78, driftX: -15, duration: 11.8, delay: 0.4 },
];

export function BackdropPunoCardFace({
  theme,
  suit,
  label,
  kind = 'face',
  artUrl,
}: {
  theme: TableTheme;
  suit: SuitColor | 'Wild';
  label: string;
  kind?: 'face' | 'back';
  artUrl?: string | null;
}) {
  if (artUrl) {
    return (
      <div className="w-full h-full rounded-[9px] overflow-hidden bg-[#0f172a]">
        <img
          src={artUrl}
          alt=""
          referrerPolicy="no-referrer"
          draggable={false}
          className="w-full h-full object-cover"
        />
      </div>
    );
  }

  const suitHex = theme.suitHex[suit];

  if (kind === 'back') {
    return (
      <div
        className="w-full h-full rounded-[8px] flex items-center justify-center relative overflow-hidden"
        style={{
          background: `linear-gradient(145deg, #161f2e 0%, #0d121c 100%)`,
        }}
      >
        <div
          className="w-[78%] h-[48%] rounded-full border-2 border-white/40 -rotate-12 flex items-center justify-center"
          style={{ backgroundColor: suitHex }}
        >
          <span className="font-display text-[11px] font-black italic tracking-tight text-[#fde047] drop-shadow">
            PUNO
          </span>
        </div>
      </div>
    );
  }

  const isWild = suit === 'Wild';
  const fillStyle = isWild
    ? {
        background: `conic-gradient(from 35deg, ${theme.suitHex.Red} 0deg 90deg, ${theme.suitHex.Blue} 90deg 180deg, ${theme.suitHex.Yellow} 180deg 270deg, ${theme.suitHex.Green} 270deg 360deg)`,
      }
    : {
        background: `linear-gradient(155deg, ${suitHex} 0%, rgba(10,14,22,0.45) 140%)`,
        backgroundColor: suitHex,
      };

  return (
    <div
      className="w-full h-full rounded-[8px] relative overflow-hidden flex items-center justify-center"
      style={fillStyle}
    >
      <span className="absolute top-1 left-1.5 text-[10px] font-black leading-none text-white drop-shadow-sm">
        {label}
      </span>
      <div className="w-[74%] h-[56%] rounded-full bg-white/90 -rotate-12 shadow-inner flex items-center justify-center border border-black/15">
        <span
          className="font-display text-lg font-black italic leading-none tracking-tight rotate-12"
          style={{ color: isWild ? '#141923' : suitHex }}
        >
          {label}
        </span>
      </div>
      <span className="absolute bottom-1 right-1.5 text-[10px] font-black leading-none text-white rotate-180 drop-shadow-sm">
        {label}
      </span>
    </div>
  );
}

export function HomeBackdrop({
  theme,
  difficulty,
}: {
  theme: TableTheme;
  difficulty?: DifficultyLevel;
}) {
  const prefersReducedMotion = useReducedMotion();

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {/* Architectural deep felt & slate backdrop */}
      <div
        className="absolute inset-0 transition-colors duration-500"
        style={{
          background: `radial-gradient(ellipse 80% 70% at 32% 45%, ${theme.feltMid} 0%, ${theme.bgMid} 54%, ${theme.bgTop} 100%)`,
        }}
      />

      {/* Woven felt micro-dot grain */}
      <div
        className="absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage: `radial-gradient(${theme.railTrim} 1px, transparent 1px)`,
          backgroundSize: '24px 24px',
        }}
      />

      {/* Animated drifting overhead felt lamp glow & secondary bokeh aura */}
      <motion.div
        animate={
          prefersReducedMotion
            ? undefined
            : {
                x: [-24, 28, -24],
                y: [-18, 22, -18],
                scale: [1, 1.08, 1],
                opacity: [0.34, 0.52, 0.34],
              }
        }
        transition={{ duration: 16, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute -left-24 top-8 w-[640px] h-[640px] rounded-full blur-3xl will-change-transform"
        style={{
          background: `radial-gradient(circle, ${theme.accent}24 0%, transparent 68%)`,
        }}
      />
      <motion.div
        animate={
          prefersReducedMotion
            ? undefined
            : {
                x: [24, -28, 24],
                y: [18, -24, 18],
                scale: [1.04, 0.95, 1.04],
                opacity: [0.22, 0.36, 0.22],
              }
        }
        transition={{ duration: 20, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute -right-28 bottom-0 w-[560px] h-[560px] rounded-full blur-3xl will-change-transform"
        style={{
          background: `radial-gradient(circle, ${theme.suitHex.Blue}22 0%, transparent 68%)`,
        }}
      />

      {/* Precision rotating inlaid casino table rings */}
      <motion.div
        animate={prefersReducedMotion ? undefined : { rotate: 360 }}
        transition={{ duration: 110, repeat: Infinity, ease: 'linear' }}
        className="hidden lg:block absolute -left-32 top-1/2 -translate-y-1/2 w-[920px] h-[920px] rounded-full border opacity-[0.15] will-change-transform"
        style={{ borderColor: theme.railTrim }}
      />
      <motion.div
        animate={prefersReducedMotion ? undefined : { rotate: -360 }}
        transition={{ duration: 78, repeat: Infinity, ease: 'linear' }}
        className="hidden lg:block absolute -left-20 top-1/2 -translate-y-1/2 w-[820px] h-[820px] rounded-full border border-dashed opacity-[0.14] will-change-transform"
        style={{ borderColor: theme.accent }}
      />

      {/* Slow rising stream of PUNO cards gliding continuously behind the UI */}
      {!prefersReducedMotion &&
        RISING_CARD_STREAM.map((rc) => (
          <motion.div
            key={rc.id}
            initial={{ y: '108vh', x: 0, rotate: rc.startRotate, opacity: 0 }}
            animate={{
              y: ['108vh', '-26vh'],
              x: [0, rc.swayX, -rc.swayX * 0.6, 0],
              rotate: [rc.startRotate, rc.endRotate],
              opacity: [0, 0.24, 0.24, 0],
            }}
            transition={{
              duration: rc.duration,
              delay: rc.delay,
              repeat: Infinity,
              ease: 'linear',
              opacity: { duration: rc.duration, times: [0, 0.14, 0.84, 1], repeat: Infinity, delay: rc.delay },
            }}
            className="absolute top-0 rounded-xl border-2 p-1 shadow-xl will-change-transform"
            style={{
              left: rc.left,
              width: `${rc.width}px`,
              height: `${rc.height}px`,
              backgroundColor: theme.cardFrame,
              borderColor: theme.cardFrameOutline,
            }}
          >
            <BackdropPunoCardFace theme={theme} suit={rc.suit} label={rc.label} />
          </motion.div>
        ))}

      {/* Floating full-detail PUNO cards & Bomboclatt cards orbiting behind the front UI */}
      {AMBIENT_CARDS.map((c) => {
        const artUrl =
          difficulty === 'bomboclatt' && c.bomboclattLabel
            ? getBomboclattCardArtUrl(c.bomboclattLabel)
            : null;
        return (
          <motion.div
            key={c.id}
            initial={{ rotate: c.baseRotate, opacity: c.opacity }}
            animate={
              prefersReducedMotion
                ? { rotate: c.baseRotate, opacity: c.opacity }
                : {
                    x: [0, c.driftX, -c.driftX * 0.65, 0],
                    y: [0, c.driftY, -c.driftY * 0.45, 0],
                    rotate: [
                      c.baseRotate,
                      c.baseRotate + c.rotateDelta,
                      c.baseRotate - c.rotateDelta * 0.7,
                      c.baseRotate,
                    ],
                    scale: [1, 1.04, 0.98, 1],
                    opacity: [c.opacity * 0.85, c.opacity * 1.18, c.opacity * 0.92, c.opacity * 0.85],
                  }
            }
            transition={{
              duration: c.duration,
              delay: c.delay,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
            className={`absolute rounded-xl border-2 shadow-2xl will-change-transform ${
              artUrl ? 'p-0 overflow-hidden' : 'p-1'
            }`}
            style={{
              left: c.left,
              top: c.top,
              width: `${c.width}px`,
              height: `${c.height}px`,
              backgroundColor: artUrl ? '#0f172a' : theme.cardFrame,
              borderColor: artUrl ? 'rgba(255,255,255,0.45)' : theme.cardFrameOutline,
            }}
          >
            <BackdropPunoCardFace
              theme={theme}
              suit={c.suit}
              label={c.label}
              kind={c.kind}
              artUrl={artUrl}
            />
          </motion.div>
        );
      })}

      {/* Rising ambient gold/felt dust motes */}
      {!prefersReducedMotion &&
        AMBIENT_MOTES.map((m) => (
          <motion.span
            key={m.id}
            animate={{
              x: [0, m.driftX, -m.driftX * 0.5, 0],
              y: [0, m.riseY],
              opacity: [0, 0.42, 0.28, 0],
            }}
            transition={{
              duration: m.duration,
              delay: m.delay,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
            className="absolute rounded-full will-change-transform"
            style={{
              left: m.left,
              top: m.top,
              width: `${m.size}px`,
              height: `${m.size}px`,
              backgroundColor: theme.accent,
              boxShadow: `0 0 8px ${theme.accent}`,
            }}
          />
        ))}

      {/* Measured edge vignette for foreground legibility */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse at center, transparent 48%, rgba(0, 0, 0, 0.52) 100%)',
        }}
      />
    </div>
  );
}
