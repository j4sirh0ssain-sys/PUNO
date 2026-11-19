import type { TableThemeId } from './themes.ts';

class SoundEffects {
  private ctx: AudioContext | null = null;
  public muted = false;

  private ensureContext(): AudioContext | null {
    if (this.muted) return null;
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  public playDeal(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(320, now);
    osc.frequency.exponentialRampToValueAtTime(190, now + 0.055);
    gain.gain.setValueAtTime(0.05, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.065);
  }

  public playCard(isPower = false): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = isPower ? 'sawtooth' : 'sine';
    osc.frequency.setValueAtTime(isPower ? 440 : 280, now);
    osc.frequency.exponentialRampToValueAtTime(isPower ? 660 : 420, now + 0.09);
    gain.gain.setValueAtTime(isPower ? 0.08 : 0.07, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.15);
  }

  public playDraw(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(340, now + 0.08);
    gain.gain.setValueAtTime(0.055, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.1);
  }

  public playError(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(175, now);
    osc.frequency.exponentialRampToValueAtTime(125, now + 0.1);
    gain.gain.setValueAtTime(0.07, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.12);
  }

  public playUno(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const notes = [523.25, 659.25, 783.99];
    notes.forEach((freq, i) => {
      const now = ctx.currentTime + i * 0.075;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.21);
    });
  }

  public playWin(milestone?: 1 | 5 | 10, themeId: TableThemeId = 'emerald'): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const scheduleNote = (
      freq: number,
      delay: number,
      dur: number,
      vol: number,
      type: OscillatorType = 'triangle'
    ) => {
      const now = ctx.currentTime + delay;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(vol, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + dur + 0.02);
    };

    const themeVoice: Record<TableThemeId, OscillatorType> = {
      emerald: 'triangle',
      burgundy: 'sine',
      obsidian: 'sawtooth',
      sakura: 'sine',
      pharaoh: 'triangle',
      aurora: 'sine',
    };

    const voice = themeVoice[themeId];
    const baseVol = voice === 'sawtooth' ? 0.055 : 0.09;

    const scales: Record<TableThemeId, number[]> = {
      emerald: [523.25, 659.25, 783.99, 1046.5, 1318.51, 1567.98, 2093.0],
      burgundy: [440.0, 554.37, 659.25, 830.61, 987.77, 1318.51, 1661.22],
      obsidian: [392.0, 523.25, 587.33, 783.99, 1046.5, 1174.66, 1567.98],
      sakura: [440.0, 493.88, 659.25, 739.99, 880.0, 1174.66, 1479.98], // Yo pentatonic feel
      pharaoh: [329.63, 440.0, 493.88, 659.25, 880.0, 987.77, 1318.51],
      aurora: [587.33, 739.99, 880.0, 1108.73, 1318.51, 1479.98, 1760.0],
    };

    const scale = scales[themeId];

    if (milestone === 10) {
      scale.forEach((f, i) => scheduleNote(f, i * 0.072, 0.58, baseVol, voice));
      [scale[0], scale[2], scale[3], scale[5]].forEach((f) =>
        scheduleNote(f, 0.52, 0.9, 0.05, 'sine')
      );
      return;
    }

    if (milestone === 5) {
      scale.slice(0, 6).forEach((f, i) => scheduleNote(f, i * 0.078, 0.46, baseVol, voice));
      scheduleNote(scale[3], 0.45, 0.65, 0.055, 'sine');
      return;
    }

    if (milestone === 1) {
      scale.slice(0, 5).forEach((f, i) => scheduleNote(f, i * 0.084, 0.42, baseVol, voice));
      return;
    }

    scale.slice(0, 4).forEach((f, i) => scheduleNote(f, i * 0.09, 0.35, baseVol, voice));
  }

  public playPenalty(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    [220, 145].forEach((freq, i) => {
      const now = ctx.currentTime + i * 0.11;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.72, now + 0.12);
      gain.gain.setValueAtTime(0.085, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.15);
    });
  }

  public playMegaPower(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    [330, 493.88, 659.25, 880].forEach((freq, i) => {
      const now = ctx.currentTime + i * 0.05;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(0.075, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.25);
    });
  }
}

export const soundFx = new SoundEffects();
