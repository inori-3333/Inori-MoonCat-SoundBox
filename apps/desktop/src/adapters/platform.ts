import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  APP_VERSION,
  createBackup,
  type AppStore,
  type AudioPort,
  type OutputDevice,
  type PlaybackProgress,
  type StimulusDescriptor,
  type StoragePort
} from "@hifi-box/core";

export const isTauriRuntime = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

class TauriAudioPort implements AudioPort {
  async listOutputs(): Promise<OutputDevice[]> { return invoke("list_output_devices"); }
  async prepareOutput(deviceId: string, expertMode: boolean): Promise<void> { await invoke("prepare_output", { deviceId, expertMode }); }
  async setSessionGain(levelDbfs: number): Promise<number> { return invoke("set_session_gain", { levelDbfs }); }
  async confirmSessionGain(): Promise<void> { await invoke("confirm_session_gain"); }
  async play(stimulus: StimulusDescriptor): Promise<string> { return invoke("play_stimulus", { stimulus }); }
  async pause(): Promise<void> { await invoke("pause_playback"); }
  async resume(): Promise<void> { await invoke("resume_playback"); }
  async stopAll(): Promise<void> { await invoke("stop_all"); }
  subscribe(listener: (progress: PlaybackProgress) => void): () => void {
    let disposed = false;
    let dispose: (() => void) | undefined;
    void listen<PlaybackProgress>("playback-progress", (event) => listener(event.payload)).then((unlisten) => {
      if (disposed) unlisten(); else dispose = unlisten;
    });
    return () => { disposed = true; dispose?.(); };
  }
}

class PreviewAudioPort implements AudioPort {
  private listeners = new Set<(progress: PlaybackProgress) => void>();
  private timer: number | undefined;
  private startedAt = 0;
  private elapsedBeforePause = 0;
  private paused = false;
  private active: { id: string; stimulus: StimulusDescriptor; duration: number } | undefined;

  async listOutputs(): Promise<OutputDevice[]> {
    return [{ id: "preview-output", name: "浏览器静音预览", channels: 2, sampleRate: 48_000, isDefault: true }];
  }
  async prepareOutput(): Promise<void> {}
  async setSessionGain(levelDbfs: number): Promise<number> { return levelDbfs; }
  async confirmSessionGain(): Promise<void> {}
  async play(stimulus: StimulusDescriptor): Promise<string> {
    await this.stopAll();
    const id = crypto.randomUUID();
    const duration = durationOf(stimulus);
    this.active = { id, stimulus, duration };
    this.startedAt = performance.now();
    this.elapsedBeforePause = 0;
    this.paused = false;
    this.timer = window.setInterval(() => this.tick(), 50);
    this.tick();
    return id;
  }
  async pause(): Promise<void> {
    if (!this.active || this.paused) return;
    this.elapsedBeforePause += performance.now() - this.startedAt;
    this.paused = true;
    this.tick();
  }
  async resume(): Promise<void> {
    if (!this.active || !this.paused) return;
    this.startedAt = performance.now();
    this.paused = false;
    this.tick();
  }
  async stopAll(): Promise<void> {
    if (this.timer) window.clearInterval(this.timer);
    if (this.active) this.emit("stopped", this.elapsed());
    this.timer = undefined;
    this.active = undefined;
  }
  subscribe(listener: (progress: PlaybackProgress) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private elapsed(): number { return this.elapsedBeforePause + (this.paused ? 0 : performance.now() - this.startedAt); }
  private tick(): void {
    if (!this.active) return;
    const elapsed = Math.min(this.active.duration, this.elapsed());
    if (elapsed >= this.active.duration) {
      this.emit("completed", elapsed);
      if (this.timer) window.clearInterval(this.timer);
      this.timer = undefined;
      this.active = undefined;
      return;
    }
    this.emit(this.paused ? "paused" : "playing", elapsed);
  }
  private emit(state: PlaybackProgress["state"], elapsedMs: number): void {
    if (!this.active) return;
    const progress: PlaybackProgress = {
      playbackId: this.active.id,
      state,
      elapsedMs: Math.round(elapsedMs),
      durationMs: this.active.duration,
      ...(this.active.stimulus.kind === "logSweep" ? {
        frequencyHz: this.active.stimulus.startHz * Math.pow(this.active.stimulus.endHz / this.active.stimulus.startHz, elapsedMs / this.active.duration)
      } : {})
    };
    this.listeners.forEach((listener) => listener(progress));
  }
}

class TauriStoragePort implements StoragePort {
  async load(): Promise<AppStore | null> { return invoke("load_store"); }
  async save(store: AppStore): Promise<void> { await invoke("save_store", { payload: store }); }
  async exportBackup(store: AppStore): Promise<string | null> { return invoke("export_backup", { payload: createBackup(store) }); }
  async chooseBackup(): Promise<unknown | null> { return invoke("choose_backup"); }
  async restore(store: AppStore): Promise<void> { await invoke("restore_store", { payload: store }); }
  async clear(): Promise<void> { await invoke("clear_store"); }
}

class BrowserStoragePort implements StoragePort {
  private readonly key = "hifi-box-store";
  async load(): Promise<AppStore | null> {
    const raw = localStorage.getItem(this.key);
    return raw ? JSON.parse(raw) as AppStore : null;
  }
  async save(store: AppStore): Promise<void> { localStorage.setItem(this.key, JSON.stringify(store)); }
  async exportBackup(store: AppStore): Promise<string> {
    const blob = new Blob([JSON.stringify(createBackup(store), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = "hifi-box-backup.json"; anchor.click();
    URL.revokeObjectURL(url);
    return anchor.download;
  }
  async chooseBackup(): Promise<unknown | null> {
    return new Promise((resolve, reject) => {
      const input = document.createElement("input");
      input.type = "file"; input.accept = ".json,application/json";
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) { resolve(null); return; }
        file.text().then((text) => resolve(JSON.parse(text))).catch(reject);
      };
      input.click();
    });
  }
  async restore(store: AppStore): Promise<void> { await this.save(store); }
  async clear(): Promise<void> { localStorage.removeItem(this.key); }
}

function durationOf(stimulus: StimulusDescriptor): number {
  switch (stimulus.kind) {
    case "sealSequence": return stimulus.loops * 4 * 800;
    case "toneSequence": return stimulus.frequenciesHz.length * (stimulus.toneDurationMs + 150);
    default: return stimulus.durationMs;
  }
}

export const audioPort: AudioPort = isTauriRuntime ? new TauriAudioPort() : new PreviewAudioPort();
export const storagePort: StoragePort = isTauriRuntime ? new TauriStoragePort() : new BrowserStoragePort();
export { APP_VERSION };
