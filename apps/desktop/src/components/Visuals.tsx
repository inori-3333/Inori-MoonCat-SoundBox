import type { BalanceRating, PlaybackProgress } from "@hifi-box/core";

export function SignalField({ active = false, mode = "wave" }: { active?: boolean; mode?: "wave" | "pulse" }) {
  return (
    <div className={`signal-field ${active ? "is-active" : ""} signal-${mode}`} aria-hidden="true">
      <div className="signal-axis" />
      {Array.from({ length: 17 }, (_, index) => <i key={index} style={{ "--bar": index } as React.CSSProperties} />)}
      <div className="signal-orbit"><span /></div>
    </div>
  );
}

export function HeadMap({ value = 0, label = "中心" }: { value?: BalanceRating; label?: string }) {
  return (
    <div className="head-map" aria-hidden="true">
      <div className="ear ear-left">L</div>
      <div className="head-line" />
      <div className="image-dot" style={{ transform: `translateX(${value * 72}px)` }}><span>{label}</span></div>
      <div className="ear ear-right">R</div>
    </div>
  );
}

export function SweepVisual({ progress, markerCount }: { progress?: PlaybackProgress | undefined; markerCount: number }) {
  const frequency = progress?.frequencyHz ?? 20;
  const ratio = Math.max(0, Math.min(1, Math.log2(frequency / 20) / Math.log2(16_000 / 20)));
  return (
    <div className="sweep-visual" style={{ "--sweep-progress": ratio } as React.CSSProperties}>
      <div className="sweep-halo" />
      <div className="sweep-readout"><strong>{formatFrequency(frequency)}</strong><span>当前频率</span></div>
      <div className="sweep-track"><i /></div>
      <div className="sweep-scale"><span>20 Hz</span><span>100</span><span>1k</span><span>10k</span><span>16 kHz</span></div>
      <div className="sweep-mark-count">{markerCount.toString().padStart(2, "0")} <span>标记</span></div>
    </div>
  );
}

export function formatFrequency(value: number): string {
  return value >= 1_000 ? `${(value / 1_000).toFixed(value >= 10_000 ? 1 : 2)} kHz` : `${Math.round(value)} Hz`;
}
