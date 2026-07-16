import { describe, expect, it } from "vitest";
import {
  EMPTY_STORE,
  createBackup,
  evaluateChannel,
  evaluateSeal,
  evaluateSweep,
  groupSweepMarkers,
  parseStore,
  rewindFrequency,
  reviewFrequencies,
  sweepFrequencyAt
} from "../src";

describe("protocol math", () => {
  it("maps logarithmic sweep endpoints", () => {
    expect(sweepFrequencyAt(0)).toBe(20);
    expect(sweepFrequencyAt(40_000)).toBe(16_000);
    expect(sweepFrequencyAt(20_000)).toBeCloseTo(Math.sqrt(20 * 16_000), 5);
  });

  it("rewinds and creates semitone-adjacent reviews", () => {
    expect(rewindFrequency(1_000)).toBeLessThan(1_000);
    expect(reviewFrequencies(1_000)).toEqual([944, 1000, 1059]);
  });
});

describe("finding rules", () => {
  it("requires a repeated routing mismatch", () => {
    const findings = evaluateChannel({
      routing: [
        { expected: "left", response: "right", repeated: false },
        { expected: "left", response: "right", repeated: true }
      ],
      center: [{ band: "low", initial: 0 }, { band: "mid", initial: 0 }, { band: "high", initial: 0 }],
      polarity: [
        { round: 0, aPhase: "in_phase", selected: "a", selectedPhase: "in_phase" },
        { round: 1, aPhase: "out_of_phase", selected: "b", selectedPhase: "in_phase" }
      ], completed: true
    });
    expect(findings[0]?.status).toBe("recheck");
  });

  it("detects a meaningful seal change", () => {
    const finding = evaluateSeal({ baseline: { fullness: 2, balance: -1 }, adjusted: { fullness: 4, balance: 0 }, completed: true })[0];
    expect(finding?.status).toBe("observed");
    expect(finding?.confidence).toBe("medium");
  });

  it("groups nearby sweep markers and distinguishes reproduction", () => {
    const markers = [
      { id: "a", frequencyHz: 1000, kind: "rattle" as const, reproduced: true },
      { id: "b", frequencyHz: 1080, kind: "rattle" as const },
      { id: "c", frequencyHz: 4000, kind: "sharp" as const, reproduced: false }
    ];
    expect(groupSweepMarkers(markers)).toHaveLength(2);
    expect(evaluateSweep({ markers, scanCompleted: true, completed: true }).map((item) => item.confidence)).toEqual(["medium", "low"]);
  });
});

describe("backup", () => {
  it("round-trips the versioned store", () => {
    const backup = createBackup(EMPTY_STORE, "2026-01-01T00:00:00.000Z");
    expect(parseStore(backup)).toEqual(EMPTY_STORE);
  });

  it("rejects an unknown schema", () => {
    expect(() => parseStore({ ...createBackup(EMPTY_STORE), schemaVersion: 99 })).toThrow("不支持");
  });
});
