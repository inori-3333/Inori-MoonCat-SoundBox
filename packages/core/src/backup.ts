import { APP_VERSION, STORE_SCHEMA_VERSION } from "./types";
import type { AppStore, BackupDocument } from "./types";

export const EMPTY_STORE: AppStore = {
  schemaVersion: STORE_SCHEMA_VERSION,
  appVersion: APP_VERSION,
  profiles: [],
  sessions: [],
  settings: { expertModeEnabled: false, reducedMotion: false }
};

export function createBackup(store: AppStore, exportedAt = new Date().toISOString()): BackupDocument {
  const snapshot = JSON.parse(JSON.stringify(store)) as AppStore;
  return { ...snapshot, exportedAt };
}

export function parseStore(value: unknown): AppStore {
  if (!value || typeof value !== "object") throw new Error("备份文件不是有效对象");
  const candidate = value as Partial<BackupDocument>;
  if (candidate.schemaVersion !== STORE_SCHEMA_VERSION) throw new Error(`不支持的数据版本：${String(candidate.schemaVersion)}`);
  if (!Array.isArray(candidate.profiles) || !Array.isArray(candidate.sessions)) throw new Error("备份缺少档案或会话列表");
  if (!candidate.settings || typeof candidate.settings !== "object") throw new Error("备份缺少设置");
  return {
    schemaVersion: STORE_SCHEMA_VERSION,
    appVersion: typeof candidate.appVersion === "string" ? candidate.appVersion : APP_VERSION,
    profiles: candidate.profiles,
    sessions: candidate.sessions,
    ...(candidate.draftSession ? { draftSession: candidate.draftSession } : {}),
    settings: {
      expertModeEnabled: Boolean(candidate.settings.expertModeEnabled),
      reducedMotion: Boolean(candidate.settings.reducedMotion)
    }
  };
}
