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
      retro: 'square',
    };

    const voice = themeVoice[themeId];
    const baseVol = voice === 'sawtooth' || voice === 'square' ? 0.05 : 0.09;

    const scales: Record<TableThemeId, number[]> = {
      emerald: [523.25, 659.25, 783.99, 1046.5, 1318.51, 1567.98, 2093.0],
      burgundy: [440.0, 554.37, 659.25, 830.61, 987.77, 1318.51, 1661.22],
      obsidian: [392.0, 523.25, 587.33, 783.99, 1046.5, 1174.66, 1567.98],
      sakura: [440.0, 493.88, 659.25, 739.99, 880.0, 1174.66, 1479.98], // Yo pentatonic feel
      pharaoh: [329.63, 440.0, 493.88, 659.25, 880.0, 987.77, 1318.51],
      aurora: [587.33, 739.99, 880.0, 1108.73, 1318.51, 1479.98, 1760.0],
      retro: [523.25, 659.25, 783.99, 987.77, 1046.5, 1318.51, 1567.98],
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

  public playCrow(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    // Two raspy crow caws: "KAAAW! KAAAW!"
    const cawTimes = [0, 0.27];
    cawTimes.forEach((offset, idx) => {
      const now = ctx.currentTime + offset;
      const dur = idx === 0 ? 0.2 : 0.24;

      // Vocal reed sawtooth dropping in pitch
      const osc = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(idx === 0 ? 640 : 600, now);
      osc.frequency.exponentialRampToValueAtTime(380, now + dur);

      osc2.type = 'square';
      osc2.frequency.setValueAtTime(idx === 0 ? 1290 : 1210, now);
      osc2.frequency.exponentialRampToValueAtTime(740, now + dur);

      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1150, now);
      filter.Q.setValueAtTime(2.6, now);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.11, now + 0.025);
      gain.gain.setValueAtTime(0.095, now + dur * 0.65);
      gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

      osc.connect(filter);
      osc2.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc2.start(now);
      osc.stop(now + dur + 0.02);
      osc2.stop(now + dur + 0.02);

      // Raspy breath noise layer
      const bufSize = Math.floor(ctx.sampleRate * dur);
      const buffer = ctx.createBuffer(1, bufSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufSize; i++) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / bufSize);
      }
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;
      const nFilter = ctx.createBiquadFilter();
      nFilter.type = 'bandpass';
      nFilter.frequency.setValueAtTime(1600, now);
      nFilter.Q.setValueAtTime(3.2, now);
      const nGain = ctx.createGain();
      nGain.gain.setValueAtTime(0.055, now);
      nGain.gain.exponentialRampToValueAtTime(0.001, now + dur);
      noise.connect(nFilter);
      nFilter.connect(nGain);
      nGain.connect(ctx.destination);
      noise.start(now);
    });
  }

  public playRizz(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
      const now = ctx.currentTime + i * 0.065;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(0.075, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.24);
    });
  }

  public playSteal(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(320, now);
    osc.frequency.exponentialRampToValueAtTime(920, now + 0.16);
    gain.gain.setValueAtTime(0.09, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.19);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.2);
  }

  public playEliminate(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const sub = ctx.createOscillator();
    const subGain = ctx.createGain();
    sub.type = 'sawtooth';
    sub.frequency.setValueAtTime(190, now);
    sub.frequency.exponentialRampToValueAtTime(48, now + 0.34);
    subGain.gain.setValueAtTime(0.12, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.36);
    sub.connect(subGain);
    subGain.connect(ctx.destination);
    sub.start(now);
    sub.stop(now + 0.38);
  }
}

export const soundFx = new SoundEffects();
