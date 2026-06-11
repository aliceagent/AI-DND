/** MediaService — the hardware boundary (CLAUDE.md Environments). STT/TTS/
 *  image live behind this interface with mock / mac / spark implementations;
 *  nothing in shared code may assume CUDA or a specific model. The swap is
 *  HERMYS_MEDIA=mock|mac|spark — config, never code.
 *
 *  Owner decision (docs/mac-notes.md): no local AI models on the MacBook,
 *  so `mac` is intentionally unimplemented and mac-week demos run `mock`. */

export interface SpeechResult { text: string }

export interface AudioResult {
  audio: Uint8Array | null;  // null ⇒ client renders text + plays a chime
  mime: string;
  durationMs: number;
}

export interface MediaService {
  readonly kind: "mock" | "mac" | "spark";
  /** PTT clip → transcript. In mock mode the Box sends text alongside the
   *  press, and it passes straight through. */
  stt(input: { audio?: Uint8Array; text?: string }): Promise<SpeechResult>;
  tts(text: string, voiceId?: string): Promise<AudioResult>;
  imageForManifest(manifestRef: string): Promise<{ url: string | null }>;
  /** Character portrait render. Mock returns null url — the prompt is
   *  persisted on the event either way, so the face is repeatable later. */
  portrait(prompt: string, seed: number): Promise<{ url: string | null }>;
}

export class MockMediaService implements MediaService {
  readonly kind = "mock" as const;

  async stt(input: { audio?: Uint8Array; text?: string }): Promise<SpeechResult> {
    return { text: input.text ?? "(unintelligible)" };
  }

  async tts(text: string): Promise<AudioResult> {
    // ~150 wpm narration estimate so the screen's ducking windows behave
    const words = text.split(/\s+/).filter(Boolean).length;
    return { audio: null, mime: "text/plain", durationMs: Math.max(800, Math.round(words / 150 * 60000)) };
  }

  async imageForManifest(): Promise<{ url: string | null }> { return { url: null }; }

  async portrait(): Promise<{ url: string | null }> { return { url: null }; }
}

export function createMediaService(kind = process.env.HERMYS_MEDIA ?? "mock"): MediaService {
  switch (kind) {
    case "mock": return new MockMediaService();
    case "mac":
      throw new Error("mac MediaService not installed: owner decision — no local AI models on the MacBook (docs/mac-notes.md). Use HERMYS_MEDIA=mock.");
    case "spark":
      throw new Error("spark MediaService lands with the Spark (docs/spark-day-one.md step 9).");
    default:
      throw new Error(`unknown HERMYS_MEDIA: ${kind}`);
  }
}
