import { useEffect, useMemo, useState } from "react";
import { Check, CirclePlay, RotateCcw } from "lucide-react";
import {
  CENTER_BANDS,
  type AudioPort,
  type BalanceRating,
  type CenterBand,
  type ChannelResult,
  type PhaseChoice,
  type RoutingResponse
} from "@hifi-box/core";
import { terms } from "@hifi-box/content";
import { Term } from "../components/Term";
import { HeadMap, SignalField } from "../components/Visuals";

interface Props {
  audio: AudioPort;
  initial?: ChannelResult | undefined;
  onProgress: (value: ChannelResult) => void;
  onComplete: (value: ChannelResult) => void;
  onMessage: (message: string) => void;
}

const routingSequence: Array<"left" | "right"> = ["left", "right", "right", "left"];
const centerSequence: CenterBand[] = ["low", "mid", "high"];
const balanceOptions: Array<{ value: BalanceRating; label: string }> = [
  { value: -2, label: "左侧" }, { value: -1, label: "略偏左" }, { value: 0, label: "中心" }, { value: 1, label: "略偏右" }, { value: 2, label: "右侧" }
];

export function ChannelTest({ audio, initial, onProgress, onComplete, onMessage }: Props) {
  const [result, setResult] = useState<ChannelResult>(initial ?? { routing: [], center: [], polarity: [], completed: false });
  const [playing, setPlaying] = useState(false);
  useEffect(() => onProgress(result), [result, onProgress]);
  useEffect(() => audio.subscribe((event) => setPlaying(event.state === "playing")), [audio]);

  const baseRouting = result.routing.filter((trial) => !trial.repeated);
  const lastRouting = result.routing.at(-1);
  const needsRoutingRepeat = Boolean(lastRouting && !lastRouting.repeated && lastRouting.response !== lastRouting.expected);
  const routingDone = baseRouting.length >= routingSequence.length && !needsRoutingRepeat;
  const expectedSide = needsRoutingRepeat && lastRouting ? lastRouting.expected : routingSequence[baseRouting.length];

  const pendingCenterRetest = result.center.find((trial) => trial.initial !== 0 && trial.retest === undefined);
  const nextCenterBand = centerSequence.find((band) => !result.center.some((trial) => trial.band === band));
  const centerDone = result.center.length === centerSequence.length && !pendingCenterRetest;
  const currentCenterBand = pendingCenterRetest?.band ?? nextCenterBand;

  const phaseRound = result.polarity.length;
  const aPhase: PhaseChoice = phaseRound % 2 === 0 ? "in_phase" : "out_of_phase";
  const allDone = routingDone && centerDone && phaseRound >= 2;

  async function playRouting() {
    if (!expectedSide) return;
    onMessage(`正在播放${expectedSide === "left" ? "左" : "右"}声道指示`);
    await audio.play({ kind: "channelNoise", side: expectedSide, durationMs: 1_200 });
  }

  function answerRouting(response: RoutingResponse) {
    if (!expectedSide) return;
    setResult((value) => ({ ...value, routing: [...value.routing, { expected: expectedSide, response, repeated: needsRoutingRepeat }] }));
  }

  async function playCenter() {
    if (!currentCenterBand) return;
    const band = CENTER_BANDS[currentCenterBand];
    onMessage(`正在播放${band.label}中心声像`);
    await audio.play({ kind: "bandNoise", lowHz: band.lowHz, highHz: band.highHz, durationMs: 2_400 });
  }

  function answerCenter(rating: BalanceRating) {
    if (!currentCenterBand) return;
    setResult((value) => {
      if (pendingCenterRetest) {
        return { ...value, center: value.center.map((trial) => trial.band === currentCenterBand ? { ...trial, retest: rating } : trial) };
      }
      return { ...value, center: [...value.center, { band: currentCenterBand, initial: rating }] };
    });
  }

  async function playPolarity(slot: "a" | "b") {
    const phase = slot === "a" ? aPhase : opposite(aPhase);
    onMessage(`正在播放版本 ${slot.toUpperCase()}`);
    await audio.play({ kind: "polarityNoise", phase, durationMs: 2_200 });
  }

  function answerPolarity(selected: "a" | "b") {
    const selectedPhase = selected === "a" ? aPhase : opposite(aPhase);
    setResult((value) => ({ ...value, polarity: [...value.polarity, { round: phaseRound, aPhase, selected, selectedPhase }] }));
  }

  if (!routingDone) {
    return <TestFrame index="01" title="左右声道路由" note="确认播放链路没有交换、合并或丢失声道。">
      <SignalField active={playing} />
      <div className="instruction-line"><span>本轮应该只听到</span><strong>{expectedSide === "left" ? "左侧 L" : "右侧 R"}</strong>{needsRoutingRepeat && <em><RotateCcw size={14} /> 复核</em>}</div>
      <button className="primary-action" onClick={() => void playRouting()}><CirclePlay size={20} />播放指示音</button>
      <div className="answer-row four"><button onClick={() => answerRouting("left")}>左侧</button><button onClick={() => answerRouting("right")}>右侧</button><button onClick={() => answerRouting("both")}>双侧</button><button onClick={() => answerRouting("none")}>未听到</button></div>
      <p className="microcopy">听完后选择实际听到的位置。首次不符会自动再播放一次。</p>
    </TestFrame>;
  }

  if (!centerDone && currentCenterBand) {
    const band = CENTER_BANDS[currentCenterBand];
    return <TestFrame index="02" title={terms.centerImage.label} note={terms.centerImage.note}>
      <HeadMap value={pendingCenterRetest?.initial ?? 0} label={band.label} />
      {pendingCenterRetest && <div className="recheck-note"><RotateCcw size={17} /><div><strong>请先重新佩戴耳机</strong><span>让左右位置和密封尽量对称，再复测同一频段。</span></div></div>}
      <button className="primary-action" onClick={() => void playCenter()}><CirclePlay size={20} />播放{band.label}信号</button>
      <div className="position-scale">{balanceOptions.map((option) => <button key={option.value} onClick={() => answerCenter(option.value)}>{option.label}</button>)}</div>
      <p className="microcopy">不要判断音质，只标记声音中心落在哪里。</p>
    </TestFrame>;
  }

  if (phaseRound < 2) {
    return <TestFrame index="03" title={terms.polarity.label} note={terms.polarity.note}>
      <SignalField active={playing} mode="pulse" />
      <div className="ab-controls"><button onClick={() => void playPolarity("a")}><CirclePlay size={20} />播放 A</button><button onClick={() => void playPolarity("b")}><CirclePlay size={20} />播放 B</button></div>
      <p className="question-copy">哪一个版本听起来更集中、更明确地位于中心？</p>
      <div className="answer-row"><button onClick={() => answerPolarity("a")}>选择 A</button><button onClick={() => answerPolarity("b")}>选择 B</button></div>
      <p className="microcopy">第 {phaseRound + 1}/2 轮 · 可反复播放，不需要快速作答。</p>
    </TestFrame>;
  }

  return <TestFrame index="✓" title="声道检查已完成" note="结果会和其他测试一起生成证据与复查建议。">
    <div className="completion-mark"><Check size={36} /><strong>三部分均已记录</strong><span>{result.routing.length} 次路由回答 · {result.center.length} 个频段 · {result.polarity.length} 轮极性</span></div>
    <button className="primary-action" onClick={() => onComplete({ ...result, completed: true })}>继续</button>
  </TestFrame>;
}

function TestFrame({ index, title, note, children }: { index: string; title: string; note: string; children: React.ReactNode }) {
  return <section className="test-workspace"><header className="test-heading"><span>{index}</span><Term note={note}>{title}</Term></header>{children}</section>;
}

function opposite(phase: PhaseChoice): PhaseChoice { return phase === "in_phase" ? "out_of_phase" : "in_phase"; }
