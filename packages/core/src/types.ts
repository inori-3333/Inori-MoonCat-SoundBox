export const APP_VERSION = "0.1.0";
export const PROTOCOL_VERSION = "1.0.0";
export const STORE_SCHEMA_VERSION = 1;

export type HeadphoneForm = "in_ear" | "over_ear";
export type ConnectionMode = "analog" | "usb" | "bluetooth";
export type AncMode = "off" | "anc" | "transparency" | "not_available";
export type ProcessingMode = "disabled" | "enabled" | "unknown";
export type SessionMode = "standard" | "expert_override";
export type TestModule = "channel" | "seal" | "sweep";

export interface HeadphoneProfile {
  id: string;
  brand: string;
  model: string;
  form: HeadphoneForm;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface OutputDevice {
  id: string;
  name: string;
  channels: number;
  sampleRate?: number;
  isDefault: boolean;
}

export interface SessionContext {
  outputDevice: OutputDevice;
  connectionMode: ConnectionMode;
  ancMode: AncMode;
  windowsSpatial: ProcessingMode;
  enhancements: ProcessingMode;
  sessionMode: SessionMode;
  confirmedLevelDbfs: number;
}

export type RoutingResponse = "left" | "right" | "both" | "none";
export type BalanceRating = -2 | -1 | 0 | 1 | 2;
export type CenterBand = "low" | "mid" | "high";
export type PhaseChoice = "in_phase" | "out_of_phase";
export type SweepMarkerKind = "rattle" | "sharp" | "dip" | "discomfort" | "other";

export interface RoutingTrial {
  expected: "left" | "right";
  response: RoutingResponse;
  repeated: boolean;
}

export interface CenterTrial {
  band: CenterBand;
  initial: BalanceRating;
  retest?: BalanceRating;
}

export interface PolarityTrial {
  round: number;
  aPhase: PhaseChoice;
  selected: "a" | "b";
  selectedPhase: PhaseChoice;
}

export interface ChannelResult {
  routing: RoutingTrial[];
  center: CenterTrial[];
  polarity: PolarityTrial[];
  completed: boolean;
}

export interface SealReading {
  fullness: 1 | 2 | 3 | 4 | 5;
  balance: BalanceRating;
}

export interface SealResult {
  baseline?: SealReading;
  adjusted?: SealReading;
  completed: boolean;
}

export interface SweepMarker {
  id: string;
  frequencyHz: number;
  kind: SweepMarkerKind;
  reproduced?: boolean;
}

export interface SweepResult {
  markers: SweepMarker[];
  scanCompleted: boolean;
  completed: boolean;
}

export interface SessionAnswers {
  channel?: ChannelResult;
  seal?: SealResult;
  sweep?: SweepResult;
}

export type FindingStatus = "normal" | "observed" | "recheck" | "inconclusive";
export type FindingConfidence = "low" | "medium" | "high";

export interface Observation {
  id: string;
  module: TestModule;
  summary: string;
  value?: number | string;
}

export interface Finding {
  id: string;
  module: TestModule;
  status: FindingStatus;
  confidence: FindingConfidence;
  title: string;
  evidence: string[];
  advice: string;
  limitation: string;
}

export interface TestSession {
  id: string;
  profileId: string;
  appVersion: string;
  protocolVersion: string;
  requestedModules: TestModule[];
  currentModule: TestModule;
  status: "draft" | "complete";
  startedAt: string;
  completedAt?: string;
  context: SessionContext;
  answers: SessionAnswers;
  observations: Observation[];
  findings: Finding[];
}

export interface AppSettings {
  expertModeEnabled: boolean;
  reducedMotion: boolean;
}

export interface BackupDocument {
  schemaVersion: number;
  exportedAt: string;
  appVersion: string;
  profiles: HeadphoneProfile[];
  sessions: TestSession[];
  draftSession?: TestSession;
  settings: AppSettings;
}

export interface AppStore extends Omit<BackupDocument, "exportedAt"> {}
