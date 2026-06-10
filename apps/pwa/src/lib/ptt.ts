/** Push-to-talk capture. Mic access needs a secure context — that's the
 *  whole reason for mkcert. In mock mode the recording is made (proving the
 *  HTTPS + permission path on real phones) but the transcript comes from
 *  the Box's text field; the spark MediaService will consume the audio. */

export interface PttState { recording: boolean; micOk: boolean | null; error: string | null }

export class Ptt {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  state: PttState = { recording: false, micOk: null, error: null };

  async start(onState: (s: PttState) => void): Promise<void> {
    this.state = { ...this.state, recording: true, error: null };
    onState(this.state);
    if (!("mediaDevices" in navigator) || !window.isSecureContext) {
      this.state = { ...this.state, micOk: false, error: window.isSecureContext ? "no mic API" : "needs HTTPS (run setup-https)" };
      onState(this.state);
      return; // text fallback still works
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.chunks = [];
      this.recorder = new MediaRecorder(stream);
      this.recorder.ondataavailable = e => this.chunks.push(e.data);
      this.recorder.start();
      this.state = { ...this.state, micOk: true };
    } catch (e) {
      this.state = { ...this.state, micOk: false, error: String((e as Error).message) };
    }
    onState(this.state);
  }

  async stop(onState: (s: PttState) => void): Promise<Blob | null> {
    this.state = { ...this.state, recording: false };
    onState(this.state);
    const rec = this.recorder;
    if (!rec || rec.state === "inactive") return null;
    const done = new Promise<Blob | null>(resolve => {
      rec.onstop = () => resolve(this.chunks.length ? new Blob(this.chunks, { type: rec.mimeType }) : null);
    });
    rec.stop();
    rec.stream.getTracks().forEach(t => t.stop());
    this.recorder = null;
    return done;
  }
}
