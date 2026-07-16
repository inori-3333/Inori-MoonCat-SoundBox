import type { AppStore, OutputDevice } from "./types";
import type { StimulusDescriptor } from "./protocols";

export interface PlaybackProgress {
  playbackId: string;
  state: "playing" | "paused" | "stopped" | "completed" | "error";
  elapsedMs: number;
  durationMs: number;
  frequencyHz?: number;
  message?: string;
}

export interface AudioPort {
  listOutputs(): Promise<OutputDevice[]>;
  prepareOutput(deviceId: string, expertMode: boolean): Promise<void>;
  setSessionGain(levelDbfs: number): Promise<number>;
  confirmSessionGain(): Promise<void>;
  play(stimulus: StimulusDescriptor): Promise<string>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stopAll(): Promise<void>;
  subscribe(listener: (progress: PlaybackProgress) => void): () => void;
}

export interface StoragePort {
  load(): Promise<AppStore | null>;
  save(store: AppStore): Promise<void>;
  exportBackup(store: AppStore): Promise<string | null>;
  chooseBackup(): Promise<unknown | null>;
  restore(store: AppStore): Promise<void>;
  clear(): Promise<void>;
}
