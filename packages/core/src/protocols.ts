import type { CenterBand, PhaseChoice } from "./types";

export const LEVEL_POLICY = {
  calibrationStartDbfs: -48,
  standardCeilingDbfs: -24,
  expertCeilingDbfs: -12,
  fadeMs: 50
} as const;

export const SWEEP_PROTOCOL = {
  startHz: 20,
  endHz: 16_000,
  durationMs: 40_000,
  rewindOctaves: 1 / 6,
  reviewStepOctaves: 1 / 12,
  maxReviewGroups: 8
} as const;

export const CENTER_BANDS: Record<CenterBand, { lowHz: number; highHz: number; label: string }> = {
  low: { lowHz: 100, highHz: 300, label: "低频" },
  mid: { lowHz: 500, highHz: 2_000, label: "中频" },
  high: { lowHz: 3_000, highHz: 8_000, label: "高频" }
};

export type StimulusDescriptor =
  | { kind: "calibrationNoise"; durationMs: number }
  | { kind: "channelNoise"; side: "left" | "right"; durationMs: number }
  | { kind: "bandNoise"; lowHz: number; highHz: number; durationMs: number }
  | { kind: "polarityNoise"; phase: PhaseChoice; durationMs: number }
  | { kind: "sealSequence"; loops: number }
  | { kind: "logSweep"; startHz: number; endHz: number; durationMs: number }
  | { kind: "toneSequence"; frequenciesHz: number[]; toneDurationMs: number };

export function sweepFrequencyAt(elapsedMs: number, startHz = SWEEP_PROTOCOL.startHz, endHz = SWEEP_PROTOCOL.endHz, durationMs = SWEEP_PROTOCOL.durationMs): number {
  const progress = Math.min(1, Math.max(0, elapsedMs / durationMs));
  return startHz * Math.pow(endHz / startHz, progress);
}

export function sweepDurationFrom(startHz: number): number {
  const totalOctaves = Math.log2(SWEEP_PROTOCOL.endHz / SWEEP_PROTOCOL.startHz);
  const remainingOctaves = Math.log2(SWEEP_PROTOCOL.endHz / startHz);
  return Math.max(1_000, Math.round(SWEEP_PROTOCOL.durationMs * remainingOctaves / totalOctaves));
}

export function rewindFrequency(frequencyHz: number): number {
  return Math.max(SWEEP_PROTOCOL.startHz, frequencyHz / Math.pow(2, SWEEP_PROTOCOL.rewindOctaves));
}

export function reviewFrequencies(frequencyHz: number): number[] {
  const step = Math.pow(2, SWEEP_PROTOCOL.reviewStepOctaves);
  return [frequencyHz / step, frequencyHz, frequencyHz * step].map((value) => Math.round(value));
}
