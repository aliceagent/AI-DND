/** The Web Audio mixer — ON THE SHARED-SCREEN CLIENT (build plan §4.2:
 *  never a server-side mixer). Music bed with crossfade, narration ducking
 *  via gain automation, and a synthesized SFX bus (no bundled assets —
 *  load any library MP3 for the bed; chimes and stings are oscillators). */

export class Mixer {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;   // ducking happens here
  private sfxBus!: GainNode;
  private bed: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private duckUntil = 0;

  /** Must be called from a user gesture (autoplay policy). */
  ensure(): AudioContext {
    if (this.ctx) return this.ctx;
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.musicBus = this.ctx.createGain();
    this.musicBus.connect(this.master);
    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = 0.5;
    this.sfxBus.connect(this.master);
    return this.ctx;
  }

  get running(): boolean { return !!this.ctx; }

  /** Crossfade the music bed to a new looped track (any local audio file). */
  async playMusic(file: File): Promise<void> {
    const ctx = this.ensure();
    const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.8, ctx.currentTime + 2.5);
    gain.connect(this.musicBus);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.connect(gain);
    src.start();
    if (this.bed) {                       // fade the old bed out, then stop it
      const old = this.bed;
      old.gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 2.5);
      setTimeout(() => old.src.stop(), 2700);
    }
    this.bed = { src, gain };
  }

  setMusicVolume(v: number): void {
    if (this.ctx) this.musicBus.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  /** Sidechain-style ducking: drop the bed while Pip speaks, recover after. */
  duck(durationMs: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const end = t + durationMs / 1000;
    this.duckUntil = Math.max(this.duckUntil, end);
    this.musicBus.gain.cancelScheduledValues(t);
    this.musicBus.gain.setTargetAtTime(0.22, t, 0.15);
    this.musicBus.gain.setTargetAtTime(1.0, this.duckUntil, 0.6);
  }

  /** Narration chime — the mock MediaService has no TTS audio, so the room
   *  still gets an audio cue that Pip "spoke". */
  chime(): void {
    this.tone([[880, 0], [659.25, 0.12]], 0.35, "triangle", 0.18);
  }

  /** check_resolved sting: success rises, failure lands flat. */
  sting(success: boolean): void {
    if (success) this.tone([[523.25, 0], [783.99, 0.1]], 0.4, "sine", 0.22);
    else this.tone([[196, 0], [185, 0.12]], 0.45, "sawtooth", 0.12);
  }

  private tone(steps: [number, number][], duration: number, type: OscillatorType, peak: number): void {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    for (const [freq, at] of steps)
      at === 0 ? osc.frequency.setValueAtTime(freq, t) : osc.frequency.exponentialRampToValueAtTime(freq, t + at);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(peak, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(gain);
    gain.connect(this.sfxBus);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }
}

export const mixer = new Mixer();
