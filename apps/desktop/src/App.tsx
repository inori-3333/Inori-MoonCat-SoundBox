import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, ArrowLeft, AudioLines, CheckCircle2, ChevronRight, CircleStop, Clock3, Database,
  Download, Ear, FileClock, Headphones, History, Home, Info, Plus, RotateCcw, Settings, ShieldCheck,
  SlidersHorizontal, Trash2, Upload
} from "lucide-react";
import {
  EMPTY_STORE, LEVEL_POLICY, createSession, evaluateSession, parseStore, sessionReducer,
  type AppStore, type AncMode, type ChannelResult, type ConnectionMode, type FindingStatus,
  type HeadphoneForm, type HeadphoneProfile, type OutputDevice, type ProcessingMode, type SealResult,
  type PlaybackProgress, type SessionContext, type SweepResult, type TestModule, type TestSession
} from "@hifi-box/core";
import { copy, terms } from "@hifi-box/content";
import { audioPort, isTauriRuntime, storagePort } from "./adapters/platform";
import { Term } from "./components/Term";
import { SignalField } from "./components/Visuals";
import { ChannelTest } from "./tests/ChannelTest";
import { SealTest } from "./tests/SealTest";
import { SweepTest } from "./tests/SweepTest";
import "./styles.css";

type Screen = "home" | "profile" | "preflight" | "runner" | "result" | "history" | "settings";

export default function App() {
  const [store, setStore] = useState<AppStore>(EMPTY_STORE);
  const [loaded, setLoaded] = useState(false);
  const [screen, setScreen] = useState<Screen>("home");
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [requestedModules, setRequestedModules] = useState<TestModule[]>(["channel", "seal", "sweep"]);
  const [resumeExisting, setResumeExisting] = useState(false);
  const [selectedResult, setSelectedResult] = useState<TestSession>();
  const [status, setStatus] = useState("本地模式 · 未连接任何服务");
  const [playbackState, setPlaybackState] = useState<PlaybackProgress["state"]>("stopped");

  useEffect(() => {
    void storagePort.load().then((value) => {
      const next = value ? parseStore(value) : EMPTY_STORE;
      setStore(next);
      setSelectedProfileId(next.draftSession?.profileId ?? next.profiles[0]?.id ?? "");
    }).catch((error) => setStatus(`本地数据读取失败：${String(error)}`)).finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const timer = window.setTimeout(() => void storagePort.save(store).catch((error) => setStatus(`自动保存失败：${String(error)}`)), 80);
    return () => window.clearTimeout(timer);
  }, [store, loaded]);

  useEffect(() => {
    document.documentElement.dataset.reduceMotion = String(store.settings.reducedMotion);
  }, [store.settings.reducedMotion]);

  useEffect(() => {
    return audioPort.subscribe((event) => {
      setPlaybackState(event.state);
      if (event.state === "error") {
        setStatus(event.message ?? "输出设备已中断，请重新确认");
        if (screen === "runner" && store.draftSession) {
          setRequestedModules(store.draftSession.requestedModules);
          setResumeExisting(true);
          setScreen("preflight");
        }
      }
    });
  }, [screen, store.draftSession]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { void audioPort.stopAll(); setStatus("声音已立即停止"); }
      const target = event.target as HTMLElement | null;
      const isEditing = target?.matches("input, textarea, select, button, [contenteditable='true']") ?? false;
      if (event.code === "Space" && !isEditing && (screen === "runner" || screen === "preflight")) {
        event.preventDefault();
        if (playbackState === "playing") { void audioPort.pause(); setStatus("播放已暂停"); }
        else if (playbackState === "paused") { void audioPort.resume(); setStatus("继续播放"); }
      }
    };
    const onBlur = () => {
      void audioPort.stopAll();
      if (screen === "runner" && store.draftSession) {
        setRequestedModules(store.draftSession.requestedModules);
        setResumeExisting(true);
        setScreen("preflight");
        setStatus("应用失去焦点，已停止声音；继续前请重新确认输出与电平");
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onBlur);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("blur", onBlur); };
  }, [screen, store.draftSession, playbackState]);

  const profile = store.profiles.find((item) => item.id === selectedProfileId);
  const draft = store.draftSession;

  const recordChannel = useCallback((value: ChannelResult) => setStore((current) => current.draftSession ? { ...current, draftSession: sessionReducer(current.draftSession, { type: "record_channel", value }) } : current), []);
  const recordSeal = useCallback((value: SealResult) => setStore((current) => current.draftSession ? { ...current, draftSession: sessionReducer(current.draftSession, { type: "record_seal", value }) } : current), []);
  const recordSweep = useCallback((value: SweepResult) => setStore((current) => current.draftSession ? { ...current, draftSession: sessionReducer(current.draftSession, { type: "record_sweep", value }) } : current), []);

  function navigate(next: Screen) {
    void audioPort.stopAll();
    setScreen(next);
  }

  function begin(modules: TestModule[]) {
    if (!profile) { setScreen("profile"); return; }
    setRequestedModules(modules);
    setResumeExisting(false);
    setScreen("preflight");
  }

  function continueDraft() {
    if (!draft) return;
    setSelectedProfileId(draft.profileId);
    setRequestedModules(draft.requestedModules);
    setResumeExisting(true);
    setScreen("preflight");
  }

  function onPreflightReady(context: SessionContext) {
    if (resumeExisting && store.draftSession) {
      setStore((current) => current.draftSession ? { ...current, draftSession: { ...current.draftSession, context } } : current);
    } else if (profile) {
      const session = createSession({ id: crypto.randomUUID(), profileId: profile.id, requestedModules, context });
      setStore((current) => ({ ...current, draftSession: session }));
    }
    setResumeExisting(false);
    setScreen("runner");
    setStatus("输出与电平已确认");
  }

  function completeModule(module: TestModule, value: ChannelResult | SealResult | SweepResult) {
    const session = store.draftSession;
    if (!session) return;
    let recorded: TestSession;
    if (module === "channel") recorded = sessionReducer(session, { type: "record_channel", value: value as ChannelResult });
    else if (module === "seal") recorded = sessionReducer(session, { type: "record_seal", value: value as SealResult });
    else recorded = sessionReducer(session, { type: "record_sweep", value: value as SweepResult });
    const currentIndex = recorded.requestedModules.indexOf(module);
    const next = recorded.requestedModules[currentIndex + 1];
    if (next) {
      const advanced = sessionReducer(recorded, { type: "advance" });
      setStore((current) => ({ ...current, draftSession: advanced }));
      setStatus(`${moduleLabel(module)}完成，进入${moduleLabel(next)}`);
      return;
    }
    const completedBase = sessionReducer(recorded, { type: "complete", completedAt: new Date().toISOString() });
    const completed = { ...completedBase, findings: evaluateSession(completedBase) };
    setStore((current) => {
      const { draftSession: _draft, ...withoutDraft } = current;
      return { ...withoutDraft, sessions: [...current.sessions, completed] };
    });
    setSelectedResult(completed);
    setScreen("result");
    setStatus("体检结果已保存到本机");
    void audioPort.stopAll();
  }

  if (!loaded) return <div className="loading-screen"><SignalField active /><strong>HiFi Box</strong><span>正在打开本地工作台…</span></div>;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => navigate("home")} aria-label="回到首页"><span><AudioLines /></span><div><strong>{copy.productName}</strong><small>{copy.productSubtitle}</small></div></button>
        <nav aria-label="主导航">
          <NavButton active={screen === "home"} icon={<Home />} label="体检" onClick={() => navigate("home")} />
          <NavButton active={screen === "history"} icon={<History />} label="历史" onClick={() => navigate("history")} />
          <NavButton active={screen === "settings"} icon={<Settings />} label="设置" onClick={() => navigate("settings")} />
        </nav>
        <div className="offline-indicator"><i /><span>完全离线</span><small>数据仅存本机</small></div>
      </aside>

      <main className="main-shell">
        <header className="topbar">
          <div><span>{profile ? `${profile.brand} ${profile.model}`.trim() : "尚未选择耳机"}</span><small>{status}</small></div>
          {(screen === "preflight" || screen === "runner") && <button className="emergency" onClick={() => { void audioPort.stopAll(); setStatus("声音已立即停止"); }}><CircleStop size={18} />立即静音 <kbd>Esc</kbd></button>}
        </header>

        <div className="screen-stage">
          {screen === "home" && <HomeScreen store={store} selectedProfileId={selectedProfileId} onSelectProfile={setSelectedProfileId} onAddProfile={() => setScreen("profile")} onBegin={begin} onContinue={continueDraft} />}
          {screen === "profile" && <ProfileScreen onCancel={() => setScreen("home")} onSave={(created) => { setStore((current) => ({ ...current, profiles: [...current.profiles, created] })); setSelectedProfileId(created.id); setScreen("home"); setStatus("耳机档案已创建"); }} />}
          {screen === "preflight" && profile && <PreflightScreen audio={audioPort} profile={profile} modules={requestedModules} expertMode={store.settings.expertModeEnabled} onReady={onPreflightReady} onCancel={() => setScreen("home")} onStatus={setStatus} />}
          {screen === "runner" && draft && profile && <Runner session={draft} profile={profile} onRecordChannel={recordChannel} onRecordSeal={recordSeal} onRecordSweep={recordSweep} onComplete={completeModule} onStatus={setStatus} onExit={() => { void audioPort.stopAll(); setScreen("home"); setStatus("进度已保存，可稍后继续"); }} />}
          {screen === "result" && selectedResult && <ResultScreen session={selectedResult} store={store} onHome={() => setScreen("home")} />}
          {screen === "history" && <HistoryScreen store={store} onOpen={(session) => { setSelectedResult(session); setSelectedProfileId(session.profileId); setScreen("result"); }} />}
          {screen === "settings" && <SettingsScreen store={store} setStore={setStore} setStatus={setStatus} />}
        </div>
      </main>
    </div>
  );
}

function NavButton({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return <button className={active ? "active" : ""} onClick={onClick}>{icon}<span>{label}</span></button>;
}

function HomeScreen({ store, selectedProfileId, onSelectProfile, onAddProfile, onBegin, onContinue }: {
  store: AppStore; selectedProfileId: string; onSelectProfile: (id: string) => void; onAddProfile: () => void;
  onBegin: (modules: TestModule[]) => void; onContinue: () => void;
}) {
  const selected = store.profiles.find((item) => item.id === selectedProfileId);
  return <div className="home-layout">
    <section className="home-primary">
      <div className="eyebrow"><span>GUIDED CHECK</span><i />约 6–9 分钟</div>
      <h1>先确认播放链路，<br />再相信你的听感。</h1>
      <p>{copy.limitation}</p>
      <div className="profile-strip">
        {store.profiles.length > 0 ? <label><span>当前耳机</span><select value={selectedProfileId} onChange={(event) => onSelectProfile(event.target.value)}>{store.profiles.map((item) => <option key={item.id} value={item.id}>{item.brand} {item.model} · {item.form === "in_ear" ? "入耳式" : "头戴式"}</option>)}</select></label> : <div><strong>先建立一份耳机档案</strong><span>型号只用于整理本机历史，不会上传。</span></div>}
        <button onClick={onAddProfile}><Plus size={18} />新建档案</button>
      </div>
      {store.draftSession && <button className="draft-banner" onClick={onContinue}><RotateCcw /><span><strong>继续未完成的体检</strong><small>{moduleLabel(store.draftSession.currentModule)} · 已自动保存</small></span><ChevronRight /></button>}
      <button className="start-button" disabled={!selected} onClick={() => onBegin(["channel", "seal", "sweep"])}><span>开始完整体检</span><small>声道 · 密封 · 扫频</small><ChevronRight /></button>
    </section>
    <aside className="home-inspector">
      <div className="headphone-orbit"><Headphones /><i /><i /><i /></div>
      <span className="inspector-index">03 / FIXED PROTOCOLS</span>
      <div className="protocol-list">
        <ProtocolItem index="01" title="声道与中心声像" note="检查路由、跨频段偏移和极性感知" onClick={() => onBegin(["channel"])} disabled={!selected} />
        <ProtocolItem index="02" title="佩戴与低频密封" note="比较重新佩戴前后的变化" onClick={() => onBegin(["seal"])} disabled={!selected} />
        <ProtocolItem index="03" title="扫频巡检" note="标记并复核可感知的瞬时现象" onClick={() => onBegin(["sweep"])} disabled={!selected} />
      </div>
    </aside>
  </div>;
}

function ProtocolItem({ index, title, note, onClick, disabled }: { index: string; title: string; note: string; onClick: () => void; disabled: boolean }) {
  return <button className="protocol-item" onClick={onClick} disabled={disabled}><span>{index}</span><div><strong>{title}</strong><small>{note}</small></div><ChevronRight /></button>;
}

function ProfileScreen({ onCancel, onSave }: { onCancel: () => void; onSave: (profile: HeadphoneProfile) => void }) {
  const [brand, setBrand] = useState(""); const [model, setModel] = useState(""); const [form, setForm] = useState<HeadphoneForm>("in_ear"); const [notes, setNotes] = useState("");
  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!brand.trim() && !model.trim()) return;
    const now = new Date().toISOString();
    onSave({ id: crypto.randomUUID(), brand: brand.trim(), model: model.trim(), form, notes: notes.trim(), createdAt: now, updatedAt: now });
  }
  return <section className="form-screen"><button className="back-link" onClick={onCancel}><ArrowLeft />返回</button><div className="form-heading"><span>HEADPHONE PROFILE</span><h1>建立耳机档案</h1><p>档案只用于整理本机复测记录。</p></div>
    <form onSubmit={submit} className="profile-form"><div className="form-columns"><label><span>品牌</span><input value={brand} onChange={(event) => setBrand(event.target.value)} placeholder="例如 Sennheiser" autoFocus /></label><label><span>型号</span><input value={model} onChange={(event) => setModel(event.target.value)} placeholder="例如 HD 600" /></label></div>
      <fieldset><legend>佩戴形态</legend><div className="segmented"><button type="button" className={form === "in_ear" ? "selected" : ""} onClick={() => setForm("in_ear")}><Ear />入耳式<small>耳塞、IEM</small></button><button type="button" className={form === "over_ear" ? "selected" : ""} onClick={() => setForm("over_ear")}><Headphones />头戴式<small>包耳、压耳</small></button></div></fieldset>
      <label><span>备注（可选）</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="耳塞套、线材或其他便于复测的信息" /></label>
      <button className="primary-action" disabled={!brand.trim() && !model.trim()} type="submit">保存档案</button></form>
  </section>;
}

function PreflightScreen({ audio, profile, modules, expertMode, onReady, onCancel, onStatus }: {
  audio: typeof audioPort; profile: HeadphoneProfile; modules: TestModule[]; expertMode: boolean;
  onReady: (context: SessionContext) => void; onCancel: () => void; onStatus: (value: string) => void;
}) {
  const [devices, setDevices] = useState<OutputDevice[]>([]); const [deviceId, setDeviceId] = useState("");
  const [connection, setConnection] = useState<ConnectionMode>("analog"); const [anc, setAnc] = useState<AncMode>("not_available");
  const [spatial, setSpatial] = useState<ProcessingMode>("disabled"); const [enhancements, setEnhancements] = useState<ProcessingMode>("disabled");
  const [level, setLevel] = useState<number>(LEVEL_POLICY.calibrationStartDbfs); const [prepared, setPrepared] = useState(false); const [heard, setHeard] = useState(false); const [busy, setBusy] = useState(false);
  useEffect(() => { void audio.listOutputs().then((values) => { setDevices(values); setDeviceId(values.find((item) => item.isDefault)?.id ?? values[0]?.id ?? ""); }).catch((error) => onStatus(`无法枚举输出设备：${String(error)}`)); }, [audio, onStatus]);
  const selected = devices.find((item) => item.id === deviceId);
  async function prepare() { if (!deviceId) return; setBusy(true); try { await audio.prepareOutput(deviceId, expertMode); setPrepared(true); setHeard(false); setLevel(LEVEL_POLICY.calibrationStartDbfs); onStatus("输出已准备，请从低电平试听"); } catch (error) { onStatus(String(error)); } finally { setBusy(false); } }
  async function changeLevel(value: number) { try { setLevel(await audio.setSessionGain(value)); } catch (error) { onStatus(String(error)); } }
  async function audition() { try { await audio.play({ kind: "calibrationNoise", durationMs: 3_000 }); onStatus("正在播放低电平校准信号"); } catch (error) { onStatus(String(error)); } }
  async function confirm() {
    if (!selected || !heard) return;
    try { await audio.confirmSessionGain(); onReady({ outputDevice: selected, connectionMode: connection, ancMode: anc, windowsSpatial: spatial, enhancements, sessionMode: expertMode ? "expert_override" : "standard", confirmedLevelDbfs: level }); } catch (error) { onStatus(String(error)); }
  }
  return <section className="preflight-screen"><button className="back-link" onClick={onCancel}><ArrowLeft />保存并返回</button><div className="preflight-grid"><div className="preflight-main"><div className="eyebrow"><span>PRE-FLIGHT</span><i />{modules.map(moduleLabel).join(" · ")}</div><h1>确认输出与听音电平</h1><p>{copy.safety}</p>
    {!isTauriRuntime && <div className="warning-line"><AlertTriangle />当前为浏览器静音预览；真实测试音频只在 Tauri 桌面应用中输出。</div>}
    <div className="device-section"><label><span>输出设备</span><select value={deviceId} onChange={(event) => { setDeviceId(event.target.value); setPrepared(false); setHeard(false); }}>{devices.map((device) => <option key={device.id} value={device.id}>{device.name} · {device.channels} ch</option>)}</select></label><button className="secondary-action" onClick={() => void prepare()} disabled={!deviceId || busy}>{prepared ? <CheckCircle2 /> : <Headphones />}{prepared ? "已准备" : "准备输出"}</button></div>
    <div className="context-grid"><SelectField label="连接方式" value={connection} onChange={(value) => setConnection(value as ConnectionMode)} options={[['analog','3.5 mm / 模拟'],['usb','USB / DAC'],['bluetooth','蓝牙']]} /><SelectField label="耳机处理" value={anc} onChange={(value) => setAnc(value as AncMode)} options={[['not_available','无 / 不适用'],['off','关闭'],['anc','ANC'],['transparency','通透']]} /><SelectField label="Windows 空间音效" value={spatial} onChange={(value) => setSpatial(value as ProcessingMode)} options={[['disabled','已关闭'],['enabled','保持开启'],['unknown','不确定']]} /><SelectField label="音频增强" value={enhancements} onChange={(value) => setEnhancements(value as ProcessingMode)} options={[['disabled','已关闭'],['enabled','保持开启'],['unknown','不确定']]} /></div>
    <div className={`level-console ${prepared ? "ready" : ""}`}><div><Term note={terms.dbfs.note}>应用内测试电平</Term><strong>{level} <small>dBFS peak</small></strong></div><input type="range" min={LEVEL_POLICY.calibrationStartDbfs} max={expertMode ? LEVEL_POLICY.expertCeilingDbfs : LEVEL_POLICY.standardCeilingDbfs} value={level} onChange={(event) => void changeLevel(Number(event.target.value))} disabled={!prepared} /><div className="level-scale"><span>-48 很小</span><span>{expertMode ? "-12 专家硬上限" : "-24 标准上限"}</span></div><button className="primary-action" onClick={() => void audition()} disabled={!prepared}>播放 3 秒校准信号</button></div>
    <label className="safety-check"><input type="checkbox" checked={heard} onChange={(event) => setHeard(event.target.checked)} disabled={!prepared} /><span><strong>我已在偏低且舒适的音量下清楚听到信号</strong><small>完成后，标准模式只能降低应用内电平。</small></span></label>
    <button className="start-button compact-start" disabled={!heard || !selected} onClick={() => void confirm()}><span>确认并进入测试</span><small>{expertMode ? "专家覆盖会被标记为非标准会话" : "标准固定协议"}</small><ChevronRight /></button></div>
    <aside className="preflight-aside"><ShieldCheck /><strong>先保护听觉，再记录现象</strong><ol><li>先把 DAC 或系统音量调低</li><li>播放应用内低电平信号</li><li>只升到清晰、偏低且舒适</li></ol><div><span>固定协议</span><strong>{expertMode ? "专家覆盖" : "标准模式"}</strong></div></aside></div></section>;
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: Array<[string, string]>; onChange: (value: string) => void }) {
  return <label><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}>{options.map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>;
}

function Runner({ session, profile, onRecordChannel, onRecordSeal, onRecordSweep, onComplete, onStatus, onExit }: {
  session: TestSession; profile: HeadphoneProfile; onRecordChannel: (value: ChannelResult) => void; onRecordSeal: (value: SealResult) => void;
  onRecordSweep: (value: SweepResult) => void; onComplete: (module: TestModule, value: ChannelResult | SealResult | SweepResult) => void;
  onStatus: (value: string) => void; onExit: () => void;
}) {
  const currentIndex = session.requestedModules.indexOf(session.currentModule);
  const [expertLevel, setExpertLevel] = useState(session.context.confirmedLevelDbfs);
  return <div className="runner-layout"><div className="runner-main"><div className="runner-header"><button className="back-link" onClick={onExit}><ArrowLeft />保存并退出</button><div className="module-progress"><span>{String(currentIndex + 1).padStart(2, "0")} / {String(session.requestedModules.length).padStart(2, "0")}</span><div>{session.requestedModules.map((module, index) => <i key={module} className={index <= currentIndex ? "active" : ""} />)}</div><strong>{moduleLabel(session.currentModule)}</strong></div></div>
    <div key={session.currentModule} className="test-transition">
      {session.currentModule === "channel" && <ChannelTest audio={audioPort} initial={session.answers.channel} onProgress={onRecordChannel} onComplete={(value) => onComplete("channel", value)} onMessage={onStatus} />}
      {session.currentModule === "seal" && <SealTest audio={audioPort} form={profile.form} initial={session.answers.seal} onProgress={onRecordSeal} onComplete={(value) => onComplete("seal", value)} onMessage={onStatus} />}
      {session.currentModule === "sweep" && <SweepTest audio={audioPort} initial={session.answers.sweep} onProgress={onRecordSweep} onComplete={(value) => onComplete("sweep", value)} onMessage={onStatus} />}
    </div></div>
    <aside className="runner-inspector"><div className="method-index"><span>PROTOCOL</span><strong>{session.currentModule === "channel" ? "CH-01" : session.currentModule === "seal" ? "SE-02" : "SW-03"}</strong></div><Term note={moduleTerm(session.currentModule).note}>{moduleTerm(session.currentModule).label}</Term><p>{copy.limitation}</p>
      <div className="session-meta"><span>输出</span><strong>{session.context.outputDevice.name}</strong><span>连接</span><strong>{connectionLabel(session.context.connectionMode)} · {ancLabel(session.context.ancMode)}</strong><span>协议</span><strong>{session.context.sessionMode === "standard" ? "标准" : "专家覆盖"}</strong></div>
      {session.context.sessionMode === "expert_override" && <div className="expert-control"><label><span>专家电平</span><strong>{expertLevel} dBFS</strong></label><input type="range" min={-48} max={-12} value={expertLevel} onChange={(event) => { const value = Number(event.target.value); setExpertLevel(value); void audioPort.setSessionGain(value).catch((error) => onStatus(String(error))); }} /><small>仍受 -12 dBFS 硬上限保护；本会话不参与直接历史对比。</small></div>}
    </aside></div>;
}

function ResultScreen({ session, store, onHome }: { session: TestSession; store: AppStore; onHome: () => void }) {
  const profile = store.profiles.find((item) => item.id === session.profileId);
  const previous = useMemo(() => store.sessions.filter((item) => item.profileId === session.profileId && item.id !== session.id && item.protocolVersion === session.protocolVersion && item.context.sessionMode === "standard").sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""))[0], [store.sessions, session]);
  const comparable = session.context.sessionMode === "standard" ? previous : undefined;
  const mismatch = comparable && (comparable.context.connectionMode !== session.context.connectionMode || comparable.context.ancMode !== session.context.ancMode || comparable.context.enhancements !== session.context.enhancements);
  return <section className="result-screen"><div className="result-heading"><div><span>LOCAL RESULT · {formatDate(session.completedAt)}</span><h1>{profile?.brand} {profile?.model}</h1><p>没有总分。每条结论只说明本次流程中记录到了什么，以及下一步如何复查。</p></div><button className="secondary-action" onClick={onHome}>返回工作台</button></div>
    {session.context.sessionMode === "expert_override" && <div className="warning-line"><AlertTriangle />本次使用专家电平覆盖，结果保留但不参与历史直接对比。</div>}
    <div className="findings-list">{session.findings.map((finding) => <article className={`finding finding-${finding.status}`} key={finding.id}><div className="finding-status"><StatusIcon status={finding.status} /><span>{statusLabel(finding.status)}</span><small>{confidenceLabel(finding.confidence)}置信度</small></div><div className="finding-body"><strong>{finding.title}</strong><ul>{finding.evidence.map((line) => <li key={line}>{line}</li>)}</ul><div className="finding-advice"><span>下一步</span><p>{finding.advice}</p></div><small>{finding.limitation}</small></div></article>)}</div>
    <section className="comparison-section"><header><FileClock /><div><strong>最近两次证据对照</strong><span>只选择同一协议下的标准会话</span></div></header>{comparable ? <><div className="compare-dates"><span>上次 · {formatDate(comparable.completedAt)}</span><span>本次 · {formatDate(session.completedAt)}</span></div>{mismatch && <div className="warning-line compact-warning"><Info />连接或音频处理状态不同，只能参考，不能直接比较。</div>}<div className="compare-list">{session.findings.map((finding) => { const old = comparable.findings.find((item) => item.module === finding.module && item.id.split("-").slice(0,2).join("-") === finding.id.split("-").slice(0,2).join("-")); return <div key={finding.id}><span>{moduleLabel(finding.module)}</span><strong>{old?.title ?? "上次无对应记录"}</strong><ChevronRight /><strong>{finding.title}</strong></div>; })}</div></> : <p className="empty-copy">还没有可直接比较的历史标准会话。完成下一次同协议体检后，这里会逐项对照证据。</p>}</section>
  </section>;
}

function HistoryScreen({ store, onOpen }: { store: AppStore; onOpen: (session: TestSession) => void }) {
  const sessions = [...store.sessions].sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));
  return <section className="history-screen"><div className="page-heading"><span>LOCAL ARCHIVE</span><h1>历史记录</h1><p>所有记录只保存在这台电脑上。</p></div>{sessions.length === 0 ? <div className="empty-state"><Clock3 /><strong>还没有完成的体检</strong><span>完成一次完整或单项测试后，记录会出现在这里。</span></div> : <div className="history-list">{sessions.map((session) => { const profile = store.profiles.find((item) => item.id === session.profileId); return <button key={session.id} onClick={() => onOpen(session)}><span>{formatDate(session.completedAt)}</span><div><strong>{profile?.brand} {profile?.model}</strong><small>{session.requestedModules.map(moduleLabel).join(" · ")} · {session.context.sessionMode === "standard" ? "标准协议" : "专家覆盖"}</small></div><em>{session.findings.filter((item) => item.status === "observed" || item.status === "recheck").length} 项关注</em><ChevronRight /></button>; })}</div>}</section>;
}

function SettingsScreen({ store, setStore, setStatus }: { store: AppStore; setStore: React.Dispatch<React.SetStateAction<AppStore>>; setStatus: (value: string) => void }) {
  async function exportData() { try { const path = await storagePort.exportBackup(store); if (path) setStatus(`备份已导出：${path}`); } catch (error) { setStatus(`导出失败：${String(error)}`); } }
  async function importData() { try { const value = await storagePort.chooseBackup(); if (!value) return; const restored = parseStore(value); if (!window.confirm(`将使用备份中的 ${restored.profiles.length} 个档案和 ${restored.sessions.length} 条记录替换当前数据。继续吗？`)) return; await storagePort.restore(restored); setStore(restored); setStatus("备份已恢复，旧数据已自动保留为恢复前快照"); } catch (error) { setStatus(`恢复失败：${String(error)}`); } }
  async function clearData() { if (!window.confirm("清空全部本地档案、历史和草稿？此操作不能撤销。")) return; await storagePort.clear(); setStore(EMPTY_STORE); setStatus("全部本地数据已清空"); }
  return <section className="settings-screen"><div className="page-heading"><span>LOCAL PREFERENCES</span><h1>设置与方法</h1><p>协议参数固定；这里只管理安全覆盖、显示和本地数据。</p></div>
    <div className="settings-groups"><section><header><SlidersHorizontal /><div><strong>测试偏好</strong><span>更改会在下一次体检生效</span></div></header><label className="toggle-row"><span><strong>专家电平覆盖</strong><small>允许测试中重新调节，硬上限 -12 dBFS；会话不参与直接历史对比。</small></span><input type="checkbox" checked={store.settings.expertModeEnabled} onChange={(event) => setStore((current) => ({ ...current, settings: { ...current.settings, expertModeEnabled: event.target.checked } }))} /></label><label className="toggle-row"><span><strong>减少动态效果</strong><small>关闭测试切换与结果揭示中的非必要过渡。</small></span><input type="checkbox" checked={store.settings.reducedMotion} onChange={(event) => setStore((current) => ({ ...current, settings: { ...current.settings, reducedMotion: event.target.checked } }))} /></label></section>
      <section><header><Database /><div><strong>本地数据</strong><span>{store.profiles.length} 个档案 · {store.sessions.length} 条完成记录</span></div></header><div className="settings-actions"><button onClick={() => void exportData()}><Download />导出 JSON 备份</button><button onClick={() => void importData()}><Upload />恢复 JSON 备份</button><button className="danger-text" onClick={() => void clearData()}><Trash2 />清空全部数据</button></div></section>
      <section><header><Info /><div><strong>方法与限制</strong><span>HiFi Box 0.1.0 · Protocol 1.0.0</span></div></header><div className="method-copy"><p>{copy.limitation}</p><ul><li>不使用麦克风，也不测量频响、THD 或真实声压。</li><li>不将高频听不到解释为耳机延伸或个人听力结论。</li><li>没有账户、云同步、遥测、在线素材或自动更新。</li><li>系统空间音效、音频增强、蓝牙编解码和 ANC 状态都会影响复测。</li></ul></div></section></div>
  </section>;
}

function StatusIcon({ status }: { status: FindingStatus }) { return status === "normal" ? <CheckCircle2 /> : status === "recheck" ? <RotateCcw /> : status === "observed" ? <AudioLines /> : <Info />; }
function statusLabel(value: FindingStatus): string { return ({ normal: "正常", observed: "观察到", recheck: "需复查", inconclusive: "不确定" })[value]; }
function confidenceLabel(value: string): string { return ({ low: "低", medium: "中", high: "高" } as Record<string, string>)[value] ?? value; }
function moduleLabel(value: TestModule): string { return ({ channel: "声道与中心声像", seal: "佩戴与低频密封", sweep: "扫频巡检" })[value]; }
function moduleTerm(value: TestModule) { return value === "channel" ? terms.centerImage : value === "seal" ? terms.seal : terms.logarithmicSweep; }
function connectionLabel(value: ConnectionMode): string { return ({ analog: "模拟", usb: "USB", bluetooth: "蓝牙" })[value]; }
function ancLabel(value: AncMode): string { return ({ off: "ANC 关闭", anc: "ANC 开启", transparency: "通透", not_available: "无处理" })[value]; }
function formatDate(value?: string): string { if (!value) return "未完成"; return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }
