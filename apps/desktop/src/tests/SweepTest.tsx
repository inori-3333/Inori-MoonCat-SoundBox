import { useEffect, useMemo, useRef, useState } from "react";
import { Check, CirclePause, CirclePlay, Flag, OctagonX } from "lucide-react";
import {
  SWEEP_PROTOCOL,
  groupSweepMarkers,
  reviewFrequencies,
  rewindFrequency,
  sweepDurationFrom,
  type AudioPort,
  type PlaybackProgress,
  type SweepMarker,
  type SweepMarkerKind,
  type SweepResult
} from "@hifi-box/core";
import { terms } from "@hifi-box/content";
import { Term } from "../components/Term";
import { formatFrequency, SweepVisual } from "../components/Visuals";

interface Props {
  audio: AudioPort;
  initial?: SweepResult | undefined;
  onProgress: (value: SweepResult) => void;
  onComplete: (value: SweepResult) => void;
  onMessage: (message: string) => void;
}

const markerOptions: Array<{ value: SweepMarkerKind; label: string }> = [
  { value: "rattle", label: "异响" }, { value: "sharp", label: "突增 / 刺耳" }, { value: "dip", label: "突然变弱" }, { value: "discomfort", label: "不适" }, { value: "other", label: "其他" }
];

export function SweepTest({ audio, initial, onProgress, onComplete, onMessage }: Props) {
  const [result, setResult] = useState<SweepResult>(initial ?? { markers: [], scanCompleted: false, completed: false });
  const [progress, setProgress] = useState<PlaybackProgress>();
  const [markingFrequency, setMarkingFrequency] = useState<number>();
  const [reviewIndex, setReviewIndex] = useState(0);
  const activeId = useRef<string | undefined>(undefined);
  useEffect(() => onProgress(result), [result, onProgress]);
  useEffect(() => audio.subscribe((event) => {
    if (activeId.current && event.playbackId !== activeId.current) return;
    setProgress(event);
    if (event.state === "completed" && event.frequencyHz !== undefined) {
      setResult((value) => ({ ...value, scanCompleted: true }));
    }
    if (event.state === "error") onMessage(event.message ?? "输出设备已中断");
  }), [audio, onMessage]);

  const groups = useMemo(() => groupSweepMarkers(result.markers).slice(0, SWEEP_PROTOCOL.maxReviewGroups), [result.markers]);
  const currentGroup = groups[reviewIndex];
  const scanning = !result.scanCompleted;
  const isPlaying = progress?.state === "playing";

  async function startSweep(startHz: number = SWEEP_PROTOCOL.startHz) {
    const id = await audio.play({ kind: "logSweep", startHz, endHz: SWEEP_PROTOCOL.endHz, durationMs: sweepDurationFrom(startHz) });
    activeId.current = id;
    onMessage(`扫频从 ${formatFrequency(startHz)} 开始`);
  }

  async function markHere() {
    if (result.markers.length >= SWEEP_PROTOCOL.maxReviewGroups) {
      onMessage("本次已达到 8 个标记；请结束扫描并逐项复核");
      return;
    }
    await audio.pause();
    setMarkingFrequency(progress?.frequencyHz ?? SWEEP_PROTOCOL.startHz);
  }

  async function saveMarker(kind: SweepMarkerKind) {
    const frequencyHz = markingFrequency ?? SWEEP_PROTOCOL.startHz;
    const marker: SweepMarker = { id: crypto.randomUUID(), frequencyHz, kind };
    setResult((value) => ({ ...value, markers: [...value.markers, marker] }));
    setMarkingFrequency(undefined);
    await startSweep(rewindFrequency(frequencyHz));
  }

  async function finishScan() {
    await audio.stopAll();
    setResult((value) => ({ ...value, scanCompleted: true }));
    setProgress(undefined);
  }

  async function playReview() {
    if (!currentGroup?.length) return;
    const center = currentGroup.reduce((sum, marker) => sum + marker.frequencyHz, 0) / currentGroup.length;
    activeId.current = await audio.play({ kind: "toneSequence", frequenciesHz: reviewFrequencies(center), toneDurationMs: 900 });
    onMessage(`复核 ${formatFrequency(center)} 附近`);
  }

  function answerReview(reproduced: boolean) {
    if (!currentGroup) return;
    const ids = new Set(currentGroup.map((marker) => marker.id));
    setResult((value) => ({ ...value, markers: value.markers.map((marker) => ids.has(marker.id) ? { ...marker, reproduced } : marker) }));
    setReviewIndex((value) => value + 1);
  }

  if (scanning) {
    return <section className="test-workspace sweep-workspace"><header className="test-heading"><span>01</span><Term note={terms.logarithmicSweep.note}>扫频巡检</Term></header>
      <SweepVisual progress={progress} markerCount={result.markers.length} />
      {!progress || progress.state === "stopped" || progress.state === "completed" ? <button className="primary-action" onClick={() => void startSweep()}><CirclePlay size={20} />开始 40 秒扫频</button> : <div className="sweep-actions">
        <button className="primary-action mark-action" onClick={() => void markHere()} disabled={!isPlaying}><Flag size={20} />标记此处</button>
        <button className="icon-action" onClick={() => void (isPlaying ? audio.pause() : audio.resume())}>{isPlaying ? <CirclePause /> : <CirclePlay />}<span>{isPlaying ? "暂停" : "继续"}</span></button>
        <button className="icon-action" onClick={() => void finishScan()}><OctagonX /><span>结束</span></button>
      </div>}
      <p className="microcopy">只标记突然变化、机械异响或不适；听不到某个高频不等于耳机故障。</p>
      {markingFrequency !== undefined && <div className="marker-sheet" role="dialog" aria-modal="true"><span>标记 {formatFrequency(markingFrequency)} 附近</span><strong>你刚才注意到什么？</strong><div>{markerOptions.map((option) => <button key={option.value} onClick={() => void saveMarker(option.value)}>{option.label}</button>)}</div><button className="text-action" onClick={() => { setMarkingFrequency(undefined); void audio.resume(); }}>取消标记</button></div>}
    </section>;
  }

  if (groups.length === 0 || reviewIndex >= groups.length) {
    return <section className="test-workspace"><header className="test-heading"><span>✓</span><Term note="未标记不等于频响平直；已标记但未复现的现象仍会以低置信度保留。">扫频记录完成</Term></header>
      <div className="completion-mark"><Check size={36} /><strong>{result.markers.length === 0 ? "本次没有主动标记" : `已完成 ${groups.length} 组复核`}</strong><span>结果将按可重复程度生成观察卡片</span></div>
      <button className="primary-action" onClick={() => onComplete({ ...result, completed: true })}>生成结果</button>
    </section>;
  }

  const center = currentGroup ? currentGroup.reduce((sum, marker) => sum + marker.frequencyHz, 0) / currentGroup.length : 0;
  return <section className="test-workspace"><header className="test-heading"><span>02</span><Term note="依次播放中心频率及上下约 1/12 倍频程的三个短音。">异常点复核</Term></header>
    <div className="review-frequency"><span>第 {reviewIndex + 1}/{groups.length} 组</span><strong>{formatFrequency(center)}</strong><small>{currentGroup?.map((marker) => markerOptions.find((option) => option.value === marker.kind)?.label).join(" · ")}</small></div>
    <button className="primary-action" onClick={() => void playReview()}><CirclePlay size={20} />播放三个复核音</button>
    <p className="question-copy">刚才的现象是否再次出现？</p>
    <div className="answer-row"><button onClick={() => answerReview(true)}>是，可以复现</button><button onClick={() => answerReview(false)}>否，没有复现</button></div>
  </section>;
}
