import { useEffect, useState } from "react";
import { Check, CirclePlay, Headphones, RotateCcw } from "lucide-react";
import type { AudioPort, BalanceRating, HeadphoneForm, SealReading, SealResult } from "@hifi-box/core";
import { terms } from "@hifi-box/content";
import { HeadMap, SignalField } from "../components/Visuals";
import { Term } from "../components/Term";

interface Props {
  audio: AudioPort;
  form: HeadphoneForm;
  initial?: SealResult | undefined;
  onProgress: (value: SealResult) => void;
  onComplete: (value: SealResult) => void;
  onMessage: (message: string) => void;
}

const balanceOptions: Array<{ value: BalanceRating; label: string }> = [
  { value: -2, label: "左侧" }, { value: -1, label: "略偏左" }, { value: 0, label: "中心" }, { value: 1, label: "略偏右" }, { value: 2, label: "右侧" }
];

export function SealTest({ audio, form, initial, onProgress, onComplete, onMessage }: Props) {
  const [result, setResult] = useState<SealResult>(initial ?? { completed: false });
  const [fullness, setFullness] = useState<SealReading["fullness"]>(3);
  const [balance, setBalance] = useState<BalanceRating>(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => onProgress(result), [result, onProgress]);
  useEffect(() => audio.subscribe((event) => setPlaying(event.state === "playing")), [audio]);
  const stage = !result.baseline ? "baseline" : !result.adjusted ? "adjusted" : "complete";

  async function playSequence() {
    onMessage("正在播放 40 / 60 / 80 Hz 与 200 Hz 参考序列");
    await audio.play({ kind: "sealSequence", loops: 2 });
  }

  function submitReading() {
    const reading: SealReading = { fullness, balance };
    setResult((value) => stage === "baseline" ? { ...value, baseline: reading } : { ...value, adjusted: reading });
    setFullness(3); setBalance(0);
  }

  if (stage === "complete") {
    return <section className="test-workspace"><header className="test-heading"><span>✓</span><Term note="只比较同一人在同一会话中的前后变化。">密封对照已完成</Term></header>
      <div className="seal-comparison"><Reading label="调整前" value={result.baseline!} /><div className="comparison-arrow">→</div><Reading label="调整后" value={result.adjusted!} /></div>
      <button className="primary-action" onClick={() => onComplete({ ...result, completed: true })}><Check size={20} />保存对照并继续</button>
    </section>;
  }

  return <section className="test-workspace"><header className="test-heading"><span>{stage === "baseline" ? "01" : "02"}</span><Term note={terms.seal.note}>{stage === "baseline" ? "记录当前低频基线" : "重新佩戴后复测"}</Term></header>
    {stage === "adjusted" ? <AdjustmentGuide form={form} /> : <p className="lead-copy">保持日常佩戴方式，不需要刻意压紧耳机。先听完整个序列，再记录感受。</p>}
    <SignalField active={playing} mode="pulse" />
    <button className="primary-action" onClick={() => void playSequence()}><CirclePlay size={20} />播放低频序列</button>
    <div className="reading-grid">
      <fieldset><legend>低频充实度</legend><div className="rating-row">{([1, 2, 3, 4, 5] as const).map((value) => <button className={fullness === value ? "selected" : ""} onClick={() => setFullness(value)} key={value}>{value}<small>{value === 1 ? "很弱" : value === 5 ? "充足" : ""}</small></button>)}</div></fieldset>
      <fieldset><legend>左右平衡</legend><HeadMap value={balance} label="低频" /><div className="position-scale compact">{balanceOptions.map((option) => <button className={balance === option.value ? "selected" : ""} key={option.value} onClick={() => setBalance(option.value)}>{option.label}</button>)}</div></fieldset>
    </div>
    <button className="secondary-action" onClick={submitReading}>{stage === "baseline" ? "记录基线" : "记录复测"}</button>
  </section>;
}

function AdjustmentGuide({ form }: { form: HeadphoneForm }) {
  return <div className="recheck-note prominent"><RotateCcw size={20} /><div><strong>{form === "in_ear" ? "重新插入左右耳塞" : "重新调整左右耳罩"}</strong><span>{form === "in_ear" ? "保持插入深度一致；确认耳塞套完整贴合，不要边按压边播放。" : "移开耳罩下的头发，留意眼镜腿，并让两侧耳罩位置对称。"}</span></div><Headphones size={22} /></div>;
}

function Reading({ label, value }: { label: string; value: SealReading }) {
  return <div className="reading-summary"><span>{label}</span><strong>{value.fullness}/5</strong><small>{value.balance === 0 ? "中心" : value.balance < 0 ? "偏左" : "偏右"}</small></div>;
}
