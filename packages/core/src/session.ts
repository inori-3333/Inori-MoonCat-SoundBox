import { APP_VERSION, PROTOCOL_VERSION } from "./types";
import type { ChannelResult, SealResult, SweepResult, TestModule, TestSession } from "./types";

export type SessionAction =
  | { type: "record_channel"; value: ChannelResult }
  | { type: "record_seal"; value: SealResult }
  | { type: "record_sweep"; value: SweepResult }
  | { type: "advance" }
  | { type: "complete"; completedAt: string };

export function createSession(input: Omit<TestSession, "appVersion" | "protocolVersion" | "status" | "startedAt" | "answers" | "observations" | "findings" | "currentModule"> & { startedAt?: string }): TestSession {
  return {
    ...input,
    appVersion: APP_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    status: "draft",
    startedAt: input.startedAt ?? new Date().toISOString(),
    currentModule: input.requestedModules[0] ?? "channel",
    answers: {},
    observations: [],
    findings: []
  };
}

export function sessionReducer(session: TestSession, action: SessionAction): TestSession {
  switch (action.type) {
    case "record_channel": return { ...session, answers: { ...session.answers, channel: action.value } };
    case "record_seal": return { ...session, answers: { ...session.answers, seal: action.value } };
    case "record_sweep": return { ...session, answers: { ...session.answers, sweep: action.value } };
    case "advance": {
      const current = session.requestedModules.indexOf(session.currentModule);
      const next = session.requestedModules[current + 1];
      return next ? { ...session, currentModule: next } : session;
    }
    case "complete": return { ...session, status: "complete", completedAt: action.completedAt };
  }
}

export function isModuleComplete(session: TestSession, module: TestModule): boolean {
  return Boolean(session.answers[module]?.completed);
}
