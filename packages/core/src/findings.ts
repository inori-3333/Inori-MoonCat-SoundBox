import { CENTER_BANDS } from "./protocols";
import type { ChannelResult, Finding, SealResult, SweepMarker, SweepResult, TestSession } from "./types";

const LIMITATION = "该结果同时受个人听觉、佩戴、播放链路和耳机影响，不能替代实验室测量。";

function base(module: Finding["module"], suffix: string): Pick<Finding, "id" | "module" | "limitation"> {
  return { id: `${module}-${suffix}`, module, limitation: LIMITATION };
}

export function evaluateChannel(result: ChannelResult): Finding[] {
  const findings: Finding[] = [];
  const persistentRouting = result.routing.filter((trial) => trial.repeated && trial.response !== trial.expected);
  findings.push(persistentRouting.length > 0 ? {
    ...base("channel", "routing"), status: "recheck", confidence: "medium", title: "声道路由需要复查",
    evidence: persistentRouting.map((trial) => `应播放${trial.expected === "left" ? "左" : "右"}声道，复测仍报告为${routingLabel(trial.response)}`),
    advice: "检查系统声道映射、转接线和插头连接，再使用另一播放设备交叉验证。"
  } : {
    ...base("channel", "routing"), status: "normal", confidence: "medium", title: "左右声道路由符合预期",
    evidence: ["左右声道指示在复核后均与播放方向一致。"], advice: "无需处理；更换线材或播放设备后可再次快速复查。"
  });

  const persistentCenter = result.center.filter((trial) => trial.initial !== 0 && trial.retest === trial.initial);
  if (persistentCenter.length > 0) {
    findings.push({
      ...base("channel", "center"), status: "observed", confidence: persistentCenter.length > 1 ? "medium" : "low",
      title: "记录到持续的中心声像偏移",
      evidence: persistentCenter.map((trial) => `${CENTER_BANDS[trial.band].label}在重新佩戴后仍偏向${balanceLabel(trial.initial)}`),
      advice: "确认耳机佩戴对称、系统左右平衡为零；若偏移长期固定，可用其他耳机或播放器交叉验证。"
    });
  } else {
    findings.push({
      ...base("channel", "center"), status: result.center.some((trial) => trial.initial !== 0) ? "inconclusive" : "normal",
      confidence: "low", title: result.center.some((trial) => trial.initial !== 0) ? "初次偏移未在复测中稳定出现" : "三个频段的中心声像均居中",
      evidence: [result.center.some((trial) => trial.initial !== 0) ? "重新佩戴后，偏移方向消失或发生变化。" : "低、中、高频均报告为中心位置。"],
      advice: "保持当前佩戴方式；如果日常音乐仍明显偏移，可在安静环境下再次复查。"
    });
  }

  const reverseCount = result.polarity.filter((trial) => trial.selectedPhase === "out_of_phase").length;
  findings.push(reverseCount === 2 ? {
    ...base("channel", "polarity"), status: "recheck", confidence: "medium", title: "极性感知结果反常",
    evidence: ["两轮均将反相信号判断为更集中、更居中。"], advice: "关闭空间音效与音频增强，检查线材或转接设备后复测。"
  } : reverseCount === 1 ? {
    ...base("channel", "polarity"), status: "inconclusive", confidence: "low", title: "极性感知不确定",
    evidence: ["两轮选择不一致。"], advice: "休息后在更安静的环境复测，不需要据此判断耳机故障。"
  } : {
    ...base("channel", "polarity"), status: "normal", confidence: "medium", title: "极性感知符合预期",
    evidence: ["两轮均将同相信号判断为更集中。"], advice: "无需处理。"
  });
  return findings;
}

export function evaluateSeal(result: SealResult): Finding[] {
  if (!result.baseline || !result.adjusted) return [];
  const delta = result.adjusted.fullness - result.baseline.fullness;
  const centered = result.baseline.balance !== 0 && result.adjusted.balance === 0;
  if (delta >= 2 || centered) {
    return [{ ...base("seal", "change"), status: "observed", confidence: "medium", title: "佩戴密封明显影响低频感受",
      evidence: [`低频充实度由 ${result.baseline.fullness}/5 变为 ${result.adjusted.fullness}/5。`, centered ? "重新佩戴后左右平衡回到中心。" : "前后变化达到两档。"],
      advice: "保留当前佩戴方式；入耳式可固定耳塞尺寸，头戴式注意眼镜腿、头发和耳罩位置。" }];
  }
  if (delta === 1) {
    return [{ ...base("seal", "change"), status: "inconclusive", confidence: "low", title: "佩戴调整可能略有帮助",
      evidence: [`低频充实度提升一档至 ${result.adjusted.fullness}/5。`], advice: "变化较小，建议换一个安静时段重复一次再作判断。" }];
  }
  if (result.baseline.fullness >= 3) {
    return [{ ...base("seal", "stable"), status: "normal", confidence: "low", title: "本次调整未带来明显变化",
      evidence: [`前后评分为 ${result.baseline.fullness}/5 与 ${result.adjusted.fullness}/5。`], advice: "当前佩戴较稳定；该结论不代表耳机低频性能优劣。" }];
  }
  return [{ ...base("seal", "unclear"), status: "inconclusive", confidence: "low", title: "低频感受偏弱，但原因无法确定",
    evidence: [`调整前后均为 ${result.adjusted.fullness}/5 或更低。`], advice: "可尝试不同耳塞或移除影响耳罩贴合的物品，并用其他耳机或播放器交叉验证。" }];
}

export function groupSweepMarkers(markers: SweepMarker[]): SweepMarker[][] {
  const sorted = [...markers].sort((a, b) => a.frequencyHz - b.frequencyHz);
  const groups: SweepMarker[][] = [];
  for (const marker of sorted) {
    const group = groups.at(-1);
    const anchor = group?.[0];
    if (group && anchor && Math.abs(Math.log2(marker.frequencyHz / anchor.frequencyHz)) <= 1 / 6) group.push(marker);
    else groups.push([marker]);
  }
  return groups;
}

export function evaluateSweep(result: SweepResult): Finding[] {
  if (result.markers.length === 0) {
    return [{ ...base("sweep", "clear"), status: "normal", confidence: "low", title: "本次扫频未记录异常点",
      evidence: ["20 Hz–16 kHz 扫频过程中未主动标记现象。"], advice: "这只代表本次主观巡检；不等于频响平直或覆盖全部频率。" }];
  }
  return groupSweepMarkers(result.markers).map((group, index) => {
    const reproduced = group.some((marker) => marker.reproduced === true);
    const center = Math.round(group.reduce((sum, marker) => sum + marker.frequencyHz, 0) / group.length);
    return {
      ...base("sweep", `group-${index}`), status: reproduced ? "observed" : "inconclusive", confidence: reproduced ? "medium" : "low",
      title: `${formatFrequency(center)} 附近${reproduced ? "可重复出现现象" : "的标记未稳定复现"}`,
      evidence: group.map((marker) => `${markerLabel(marker.kind)} · ${formatFrequency(marker.frequencyHz)}${marker.reproduced === true ? " · 已复现" : marker.reproduced === false ? " · 未复现" : ""}`),
      advice: reproduced ? "降低音量后复查，并用其他播放设备或耳机交叉验证；如为机械异响，检查插头、线材和外壳接触。" : "保留为低置信度观察，不据此判断耳机故障。",
      limitation: LIMITATION
    };
  });
}

export function evaluateSession(session: TestSession): Finding[] {
  return [
    ...(session.answers.channel ? evaluateChannel(session.answers.channel) : []),
    ...(session.answers.seal ? evaluateSeal(session.answers.seal) : []),
    ...(session.answers.sweep ? evaluateSweep(session.answers.sweep) : [])
  ];
}

function routingLabel(value: string): string { return ({ left: "左侧", right: "右侧", both: "双侧", none: "未听到" } as Record<string, string>)[value] ?? value; }
function balanceLabel(value: number): string { return value < -1 ? "左侧" : value === -1 ? "略偏左" : value > 1 ? "右侧" : "略偏右"; }
function markerLabel(value: string): string { return ({ rattle: "异响", sharp: "突增/刺耳", dip: "突然变弱", discomfort: "不适", other: "其他" } as Record<string, string>)[value] ?? value; }
function formatFrequency(value: number): string { return value >= 1_000 ? `${(value / 1_000).toFixed(value >= 10_000 ? 1 : 2)} kHz` : `${Math.round(value)} Hz`; }
