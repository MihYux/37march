import { useEffect, useMemo, useState } from "react";
import "../operator/release-console.css";
import {
  ArrowRight, ChartLineUp, Check, CheckCircle, ClipboardText,
  Globe, PaperPlaneTilt, Plus, ShieldCheck, Sparkle, SpinnerGap, UploadSimple,
  Warning, X,
} from "@phosphor-icons/react";
import type { ReleaseOperatorApi, ReviewDecision } from "../operator/api";
import type {
  CharacterDirective, ReleaseTask, ReleaseTaskInput, ReleaseWorkspaceSnapshot,
} from "../operator/release-types";

type Page = "tasks" | "region" | "release" | "optimization";
const pages: Array<{ id: Page; number: string; label: string; icon: typeof Globe }> = [
  { id: "tasks", number: "01", label: "版本任务", icon: ClipboardText },
  { id: "region", number: "02", label: "区域数据", icon: Globe },
  { id: "release", number: "03", label: "灰度发布", icon: PaperPlaneTilt },
  { id: "optimization", number: "04", label: "效果优化", icon: ChartLineUp },
];

function blankTask(data: ReleaseWorkspaceSnapshot): ReleaseTaskInput {
  return {
    title: "", objective: "launch", theme: "", narrative: "",
    ownerId: data.activeOperatorId,
    reviewerId: data.operators.find((item) => item.role === "reviewer")?.id ?? "",
    timeWindow: "", consentConfirmed: false,
    facts: [{ id: crypto.randomUUID(), label: "核心事实", value: "", source: "" }],
  };
}
function taskInput(task: ReleaseTask): ReleaseTaskInput {
  return {
    id: task.id, title: task.title, objective: task.objective, theme: task.theme,
    narrative: task.narrative, ownerId: task.ownerId, reviewerId: task.reviewerId,
    timeWindow: task.timeWindow, consentConfirmed: task.gate.consent,
    facts: task.facts.length ? task.facts : [{ id: crypto.randomUUID(), label: "核心事实", value: "", source: "" }],
  };
}
function Card({ title, children, className = "" }: { title?: string; children: React.ReactNode; className?: string }) {
  return <section className={`release-card ${className}`}>{title && <h3>{title}</h3>}{children}</section>;
}
function Empty({ text }: { text: string }) {
  return <div className="release-empty"><Sparkle weight="duotone" /><p>{text}</p></div>;
}
function Field({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return <label className={wide ? "wide" : ""}><span>{label}</span>{children}</label>;
}

function seededUnit(seed: string, offset: number) {
  let hash = 2166136261 ^ offset;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function linePoints(values: number[]) {
  return values.map((value, index) => {
    const x = 48 + index * (504 / Math.max(1, values.length - 1));
    const y = 184 - value * 1.45;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

function buildSimulatedReport(
  seed: string,
  rolloutPercent: number,
  agentNames: string[],
) {
  const reached = Math.max(
    18,
    Math.round((4600 + seededUnit(seed, 1) * 2800) * rolloutPercent / 100),
  );
  const readRate = 0.76 + seededUnit(seed, 2) * 0.1;
  const conversationRate = 0.27 + seededUnit(seed, 3) * 0.09;
  const intentRate = 0.15 + seededUnit(seed, 4) * 0.08;
  const experienceRate = 0.1 + seededUnit(seed, 5) * 0.08;
  const continuedRate = 0.55 + seededUnit(seed, 6) * 0.14;
  const unsubscribeRate = 0.002 + seededUnit(seed, 7) * 0.004;
  const complaintRate = 0.0003 + seededUnit(seed, 8) * 0.0012;
  const relationshipScore = Math.round(86 + seededUnit(seed, 9) * 9);
  const labels = ["D1", "D2", "D3", "D4", "D5", "D6", "D7"];
  const trend = labels.map((label, index) => ({
    label,
    natural: Math.round(18 + index * 2.3 + seededUnit(seed, 20 + index) * 5),
    intent: Math.round(8 + index * 1.7 + seededUnit(seed, 30 + index) * 4),
    positive: Math.round(65 + index * 1.8 + seededUnit(seed, 40 + index) * 7),
  }));
  const funnel = [
    { label: "方案触达", value: reached },
    { label: "打开对话", value: Math.round(reached * readRate) },
    { label: "自然交流", value: Math.round(reached * conversationRate) },
    { label: "产生体验意向", value: Math.round(reached * intentRate) },
    { label: "进入版本体验", value: Math.round(reached * experienceRate) },
  ];
  const agents = agentNames.map((name, index) => ({
    name,
    conversation: Math.round(24 + seededUnit(seed, 60 + index) * 15),
    intent: Math.round(13 + seededUnit(seed, 70 + index) * 12),
  }));
  const accepted = Math.round(64 + seededUnit(seed, 80) * 10);
  const curious = Math.round(12 + seededUnit(seed, 81) * 6);
  const refused = Math.round(2 + seededUnit(seed, 83) * 3);
  const deferred = 100 - accepted - curious - refused;
  return {
    reached,
    readRate,
    conversationRate,
    intentRate,
    experienceRate,
    continuedRate,
    unsubscribeRate,
    complaintRate,
    relationshipScore,
    trend,
    funnel,
    agents,
    outcome: [
      { label: "自然接受", value: accepted, tone: "positive" },
      { label: "继续追问", value: curious, tone: "curious" },
      { label: "暂时搁置", value: deferred, tone: "neutral" },
      { label: "明确拒绝", value: refused, tone: "negative" },
    ],
  };
}

export function ReleaseConsole({ api, data, onChange }: {
  api: ReleaseOperatorApi;
  data: ReleaseWorkspaceSnapshot;
  onChange: (data: ReleaseWorkspaceSnapshot) => void;
}) {
  const [page, setPage] = useState<Page>("tasks");
  const workspace = data.workspaces[data.activeRegionId];
  const region = data.regions.find((item) => item.id === data.activeRegionId)!;
  const operator = data.operators.find((item) => item.id === data.activeOperatorId)!;
  const [selectedTaskId, setSelectedTaskId] = useState(workspace.tasks[0]?.id ?? "");
  const task = selectedTaskId ? workspace.tasks.find((item) => item.id === selectedTaskId) ?? null : null;
  const latestPlanRelease = workspace.planReleases?.find((item) => item.taskId === task?.id) ?? null;
  const [taskDraft, setTaskDraft] = useState<ReleaseTaskInput>(() => task ? taskInput(task) : blankTask(data));
  const [newRegionDraft, setNewRegionDraft] = useState({
    name: "", code: "", language: "zh-CN", timeZone: "Asia/Shanghai",
  });
  const [rolloutPercent, setRolloutPercent] = useState(5);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [regionDialog, setRegionDialog] = useState(false);

  useEffect(() => {
    const next = workspace.tasks[0];
    setSelectedTaskId(next?.id ?? "");
    setTaskDraft(next ? taskInput(next) : blankTask(data));
  }, [data.activeRegionId]);

  const mutate = async (key: string, action: () => Promise<ReleaseWorkspaceSnapshot>, success: string) => {
    setBusy(key); setNotice(null);
    try {
      const next = await action();
      onChange(next);
      setNotice({ kind: "success", text: success });
      return next;
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : String(error) });
      return null;
    } finally { setBusy(""); }
  };
  const chooseTask = (next: ReleaseTask) => {
    setSelectedTaskId(next.id); setTaskDraft(taskInput(next)); setNotice(null);
  };
  const newTask = () => {
    setSelectedTaskId(""); setTaskDraft(blankTask(data)); setPage("tasks"); setNotice(null);
  };
  const saveTask = async () => {
    const next = await mutate("task", () => api.saveTask(region.id, taskDraft), taskDraft.id ? "版本任务已更新。" : "新版本任务已创建。");
    if (next) {
      const saved = taskDraft.id
        ? next.workspaces[region.id].tasks.find((item) => item.id === taskDraft.id)
        : next.workspaces[region.id].tasks[0];
      if (saved) chooseTask(saved);
    }
  };
  const importPlan = async () => {
    setBusy("plan"); setNotice(null);
    try {
      const result = await api.importPlan(region.id, task?.id);
      onChange(result.data);
      if (result.canceled) return;
      const imported = result.data.workspaces[region.id].tasks.find((item) => item.id === result.taskId);
      if (imported) chooseTask(imported);
      setNotice({ kind: "success", text: "方案已解析并填入版本任务，请核对后保存。" });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : String(error) });
    } finally { setBusy(""); }
  };
  const createRegion = async () => {
    setBusy("add-region"); setNotice(null);
    try {
      const createdData = await api.addRegion({
        ...newRegionDraft,
        quietHours: { start: "22:00", end: "08:00" },
      });
      const created = createdData.regions.find(
        (item) => item.code === newRegionDraft.code.trim().toUpperCase(),
      );
      if (!created) throw new Error("新区域创建后未找到。");
      const next = await api.switchRegion(created.id);
      onChange(next);
      setNewRegionDraft({ name: "", code: "", language: "zh-CN", timeZone: "Asia/Shanghai" });
      setRegionDialog(false);
      setNotice({ kind: "success", text: `已添加并切换到${created.name}。` });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : String(error) });
    } finally { setBusy(""); }
  };


  const renderTasks = () => <>
    <div className="release-title-actions">
      <div><span>版本任务是整个发行流程的起点</span><p>每个版本独立保存方案、指令、审核、灰度和效果数据。</p></div>
      <button className="primary" onClick={newTask}><Plus />新建版本任务</button>
    </div>
    {workspace.tasks.length > 0 && <div className="version-list">{workspace.tasks.map((item) =>
      <button key={item.id} className={item.id === task?.id && taskDraft.id ? "active" : ""} onClick={() => chooseTask(item)}>
        <span>{item.status === "ready" ? "可发行" : "草稿"}</span><b>{item.title}</b><small>{item.timeWindow || "未设置时间"}</small>
      </button>)}</div>}
    <Card title={taskDraft.id ? "编辑版本任务" : "创建版本任务"}>
      <div className="plan-upload">
        <div className="plan-upload-icon"><UploadSimple weight="duotone" /></div>
        <div><strong>上传区域角色共生发行方案</strong><p>支持 DOCX、PDF、Markdown、TXT，自动提取版本任务和固定事实。</p>{task?.sourceDocument && <small>已导入：{task.sourceDocument.name}</small>}</div>
        <button onClick={importPlan} disabled={operator.role === "reviewer"}><UploadSimple />{task?.sourceDocument ? "重新上传" : "选择方案"}</button>
      </div>
      <div className="release-form spacious">
        <Field label="版本任务名称"><input value={taskDraft.title} onChange={(e) => setTaskDraft({ ...taskDraft, title: e.target.value })} placeholder="例如：3.0 版本共生发行" /></Field>
        <Field label="发行目标"><select value={taskDraft.objective} onChange={(e) => setTaskDraft({ ...taskDraft, objective: e.target.value })}><option value="preheat">版本预热</option><option value="launch">版本上线</option><option value="sustain">持续运营</option><option value="recall">玩家召回</option></select></Field>
        <Field label="版本主题" wide><input value={taskDraft.theme} onChange={(e) => setTaskDraft({ ...taskDraft, theme: e.target.value })} placeholder="这次版本希望三月七和玩家建立怎样的关系" /></Field>
        <Field label="角色叙事方式" wide><textarea value={taskDraft.narrative} onChange={(e) => setTaskDraft({ ...taskDraft, narrative: e.target.value })} /></Field>
        <Field label="发行时间"><input value={taskDraft.timeWindow} onChange={(e) => setTaskDraft({ ...taskDraft, timeWindow: e.target.value })} placeholder="2026-08-01 至 2026-08-14" /></Field>
        {taskDraft.facts.map((fact, index) => <div className="fact-row wide" key={fact.id}>
          <input value={fact.label} onChange={(e) => setTaskDraft({ ...taskDraft, facts: taskDraft.facts.map((item, i) => i === index ? { ...item, label: e.target.value } : item) })} />
          <input value={fact.value} onChange={(e) => setTaskDraft({ ...taskDraft, facts: taskDraft.facts.map((item, i) => i === index ? { ...item, value: e.target.value } : item) })} placeholder="固定事实" />
          <input value={fact.source} onChange={(e) => setTaskDraft({ ...taskDraft, facts: taskDraft.facts.map((item, i) => i === index ? { ...item, source: e.target.value } : item) })} placeholder="来源" />
        </div>)}
        <label className="release-check wide"><input type="checkbox" checked={taskDraft.consentConfirmed} onChange={(e) => setTaskDraft({ ...taskDraft, consentConfirmed: e.target.checked })} /><span>确认方案只使用玩家允许的内容范围</span></label>
      </div>
      <div className="release-actions"><button className="primary" onClick={saveTask}><Check />{taskDraft.id ? "保存版本任务" : "创建版本任务"}</button></div>
    </Card>
  </>;

  const renderRegion = () => {
    const eligible = workspace.segments.reduce((sum, item) => sum + item.eligible, 0);
    const authorized = workspace.segments.reduce((sum, item) => sum + item.authorized, 0);
    const reachable = workspace.segments.reduce((sum, item) => sum + item.reachable, 0);
    return <>
      <div className="region-data-toolbar">
        <div><span>{region.code}</span><h2>{region.name}区域数据</h2><p>{region.language} · {region.timeZone}</p></div>
        <div><button onClick={() => setRegionDialog(true)}><Globe />切换区域</button>{operator.role === "release_lead" && <button className="primary" onClick={() => setRegionDialog(true)}><Plus />添加区域</button>}</div>
      </div>
      <div className="release-summary-strip region-data-summary">
        <div><strong>{eligible}</strong><span>符合条件</span></div>
        <div><strong>{authorized}</strong><span>已授权</span></div>
        <div><strong>{reachable}</strong><span>可触达</span></div>
        <div><strong>{workspace.segments.length}</strong><span>玩家分群</span></div>
      </div>
      <Card title="当前区域">
        <dl className="release-facts">
          <div><dt>区域</dt><dd>{region.name}（{region.code}）</dd></div>
          <div><dt>语言</dt><dd>{region.language}</dd></div>
          <div><dt>时区</dt><dd>{region.timeZone}</dd></div>
          <div><dt>静默时段</dt><dd>{region.quietHours.start} — {region.quietHours.end}</dd></div>
        </dl>
      </Card>
    </>;
  };

  const renderRelease = () => {
    if (!task) return <Empty text="请先在“版本任务”中新建并保存一个区域发行方案。" />;
    const planSource = workspace.planSources.find((item) => item.taskId === task.id);
    const canPublish = !workspace.emergencyStoppedAt;
    return <>
      <div className="plan-release-summary">
        <div><span>当前区域方案</span><h2>{task.title}</h2><p>{task.theme}</p></div>
        <dl><div><dt>区域</dt><dd>{region.name}</dd></div><div><dt>方案来源</dt><dd>{planSource?.name || "控制台手工填写"}</dd></div><div><dt>固定事实</dt><dd>{task.facts.length} 条</dd></div></dl>
      </div>
      <Card title="设置本次发布灰度">
        <p className="muted">该比例会随区域发行方案一起发送给所有共生式发行 AI，由发行执行 AI 按比例控制首次触达。</p>
        <div className="rollout-presets">{[1, 5, 10, 25, 50, 100].map((value) => <button className={rolloutPercent === value ? "active" : ""} key={value} onClick={() => setRolloutPercent(value)}>{value}%</button>)}</div>
        <div className="single-rollout"><input type="range" min="1" max="100" value={rolloutPercent} onChange={(e) => setRolloutPercent(Number(e.target.value))} /><label><input type="number" min="1" max="100" value={rolloutPercent} onChange={(e) => setRolloutPercent(Number(e.target.value))} /><span>%</span></label></div>
      </Card>
      <div className="release-publish-only">
        <div className="release-actions release-publish-actions">
          <button className="primary publish" disabled={!canPublish || operator.role !== "release_lead" || Boolean(busy)} onClick={() => mutate("publish-plan", () => api.publishPlanToAgents(region.id, task.id, rolloutPercent), `区域发行方案已按 ${rolloutPercent}% 灰度发布。`)}><PaperPlaneTilt weight="fill" />发布方案</button>
          <button className="example-publish" disabled={!canPublish || operator.role !== "release_lead" || Boolean(busy)} onClick={() => mutate("publish-example", () => api.publishExamplePlan(region.id, task.id), "示例方案已按 100% 发布，并跳过主动触达频控。")}><Sparkle weight="fill" />示例发布</button>
          <small>演示专用：固定 100% 命中并跳过 24 小时及一周版本触达频控；授权、静默时段、暂停与安全护栏仍然有效。</small>
        </div>
      </div>
    </>;
  };

  const renderOptimization = () => {
    if (!latestPlanRelease || !task) {
      return <Empty text="发布区域发行方案后，这里会自动生成共生式角色执行效果看板。" />;
    }
    const enabledAgents = region.releaseAgents
      .filter((item) => item.enabled)
      .map((item) => item.name);
    const report = buildSimulatedReport(
      `${region.id}:${task.id}:${latestPlanRelease.id}`,
      latestPlanRelease.rolloutPercent,
      enabledAgents,
    );
    const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
    const maxFunnel = report.funnel[0].value;
    return <>
      <section className="sim-result-hero">
        <div>
          <span className="sim-badge">SIMULATED · 模拟数据</span>
          <h2>关系健康稳定，可以继续观察并逐步扩大</h2>
          <p>共生式角色以低打扰方式执行“{task.title}”，自然对话与版本体验意向持续上升，当前未触发关系风险护栏。</p>
        </div>
        <dl>
          <div><dt>区域</dt><dd>{region.name}</dd></div>
          <div><dt>灰度</dt><dd>{latestPlanRelease.rolloutPercent}%</dd></div>
          <div><dt>观察周期</dt><dd>近 7 天</dd></div>
        </dl>
      </section>

      <section className="sim-kpi-grid" aria-label="核心模拟指标">
        <article><span>灰度触达</span><strong>{report.reached.toLocaleString()}</strong><small>个共生式角色</small></article>
        <article><span>自然交流率</span><strong>{pct(report.conversationRate)}</strong><small>较首日 +6.8%</small></article>
        <article><span>版本体验率</span><strong>{pct(report.experienceRate)}</strong><small>温和引导后进入体验</small></article>
        <article className="health"><span>关系健康分</span><strong>{report.relationshipScore}</strong><small>安全 · 无护栏告警</small></article>
      </section>

      <div className="sim-dashboard-grid">
        <Card className="sim-chart-card">
          <div className="sim-card-head"><div><span>执行趋势</span><h3>角色交流与体验意向</h3></div><div className="sim-legend"><span className="natural">自然交流</span><span className="intent">体验意向</span><span className="positive">正向反馈</span></div></div>
          <svg className="sim-line-chart" viewBox="0 0 600 220" role="img" aria-label="近七天执行趋势折线图">
            {[20, 40, 60, 80, 100].map((value) => <g key={value}><line x1="48" x2="570" y1={184 - value * 1.45} y2={184 - value * 1.45} /><text x="8" y={188 - value * 1.45}>{value}%</text></g>)}
            <polyline className="natural" points={linePoints(report.trend.map((item) => item.natural))} />
            <polyline className="intent" points={linePoints(report.trend.map((item) => item.intent))} />
            <polyline className="positive" points={linePoints(report.trend.map((item) => item.positive))} />
            {report.trend.map((item, index) => <text className="day" key={item.label} x={48 + index * 84} y="210">{item.label}</text>)}
          </svg>
        </Card>

        <Card className="sim-health-card">
          <div className="sim-card-head"><div><span>关系健康</span><h3>低打扰执行质量</h3></div></div>
          <div className="sim-health-body">
            <div className="sim-donut" style={{ background: `conic-gradient(#7d5f87 ${report.relationshipScore * 3.6}deg, #eee8f0 0)` }}><div><strong>{report.relationshipScore}</strong><span>/ 100</span></div></div>
            <dl>
              <div><dt>持续对话</dt><dd>{pct(report.continuedRate)}</dd></div>
              <div><dt>退订</dt><dd>{pct(report.unsubscribeRate)}</dd></div>
              <div><dt>投诉</dt><dd>{pct(report.complaintRate)}</dd></div>
            </dl>
          </div>
          <p className="sim-safe-note"><CheckCircle weight="fill" />所有关系指标均处于安全阈值内</p>
        </Card>

        <Card className="sim-funnel-card">
          <div className="sim-card-head"><div><span>转化漏斗</span><h3>从方案触达到版本体验</h3></div></div>
          <div className="sim-funnel">
            {report.funnel.map((item, index) => <div key={item.label}><span>{item.label}</span><div><i style={{ width: `${Math.max(8, item.value / maxFunnel * 100)}%` }} /></div><strong>{item.value.toLocaleString()}</strong>{index > 0 && <small>{(item.value / report.funnel[index - 1].value * 100).toFixed(1)}%</small>}</div>)}
          </div>
        </Card>

        <Card className="sim-outcome-card">
          <div className="sim-card-head"><div><span>玩家回应</span><h3>交流结果分布</h3></div></div>
          <div className="sim-stacked" aria-label="玩家回应分布">
            {report.outcome.map((item) => <i className={item.tone} key={item.label} style={{ width: `${item.value}%` }} title={`${item.label} ${item.value}%`} />)}
          </div>
          <div className="sim-outcome-list">{report.outcome.map((item) => <div key={item.label}><i className={item.tone} /><span>{item.label}</span><strong>{item.value}%</strong></div>)}</div>
        </Card>
      </div>



      <section className="sim-insights">
        <div><span>01</span><p><b>自然衔接有效</b>引用授权记忆的角色更容易开启持续对话，建议保持低打扰开场。</p></div>
        <div><span>02</span><p><b>体验意向稳定上升</b>D4 后增长趋稳，可在关系健康不下降的前提下逐步扩大灰度。</p></div>
        <div><span>03</span><p><b>拒绝反馈较低</b>明确拒绝后停止引导的策略有效，继续保留当前退出边界。</p></div>
      </section>
      <p className="sim-disclaimer">以上数据为产品演示模拟值，由区域、任务、发布批次和灰度比例稳定生成，不代表真实玩家行为。</p>
    </>;
  };

  const content = { tasks: renderTasks, region: renderRegion, release: renderRelease, optimization: renderOptimization }[page]();
  const pageIndex = pages.findIndex((item) => item.id === page);
  return <main className="release-console">
    <aside className="release-sidebar">
      <div className="release-brand"><div>3/7</div><span><b>共生式发行</b><small>Regional release console</small></span></div>
      <nav>{pages.map(({ id, number, label, icon: Icon }) => <button key={id} className={page === id ? "active" : ""} onClick={() => setPage(id)}><span>{number}</span><Icon weight={page === id ? "fill" : "regular"} /><b>{label}</b></button>)}</nav>
      <div className="release-principle"><span>工作流</span><p>版本任务<br />区域数据<br />灰度发布<br />效果优化</p></div>
    </aside>
    <section className="release-main">
      <header className="release-topbar">
        <div className="release-context">
          <button className="context-select" onClick={() => setRegionDialog(true)} aria-label="切换当前区域">
            <span className="context-icon"><Globe weight="duotone" /></span>
            <span className="context-copy"><small>当前区域</small><b>{region.name}</b></span>
            <ArrowRight className="context-arrow" />
          </button>
        </div>
        <button className={workspace.emergencyStoppedAt ? "resume-button" : "emergency-button"} onClick={() => mutate("emergency", () => api.setEmergencyStop(region.id, !workspace.emergencyStoppedAt, "人工操作"), workspace.emergencyStoppedAt ? "区域发行已恢复。" : "区域发行已暂停。")}><Warning weight="fill" />{workspace.emergencyStoppedAt ? "恢复区域" : "紧急暂停"}</button>
      </header>
      <div className="release-content">
        <div className="release-page-title"><div><span>STEP {pages[pageIndex].number} / 04</span><h1>{pages[pageIndex].label}</h1><p>{task ? `当前版本：${task.title}` : "先创建一个版本任务"}</p></div></div>
        {content}
        <div className="next-action"><div><span>下一步</span><strong>{pageIndex < pages.length - 1 ? pages[pageIndex + 1].label : "持续收集数据并优化"}</strong></div>{pageIndex < pages.length - 1 && <button className="primary" onClick={() => setPage(pages[pageIndex + 1].id)}>{pages[pageIndex + 1].label}<ArrowRight /></button>}</div>
      </div>
    </section>
    {busy && <div className="release-busy"><SpinnerGap className="spin" />正在执行并写入审计记录</div>}
    {notice && <div className={`release-toast ${notice.kind}`}><span>{notice.text}</span><button onClick={() => setNotice(null)}><X /></button></div>}
    {regionDialog && <div className="release-modal-backdrop" onMouseDown={() => setRegionDialog(false)}><div className="release-modal" onMouseDown={(e) => e.stopPropagation()}>
      <div className="modal-head"><div><span>区域工作区</span><h2>切换或添加区域</h2></div><button onClick={() => setRegionDialog(false)}><X /></button></div>
      <div className="region-options">{data.regions.map((item) => <button className={item.id === region.id ? "active" : ""} key={item.id} onClick={async () => { await mutate("switch-region", () => api.switchRegion(item.id), `已切换到${item.name}。`); setRegionDialog(false); }}><b>{item.code}</b><span>{item.name}<small>{item.language} · {item.timeZone}</small></span>{item.id === region.id && <CheckCircle weight="fill" />}</button>)}</div>
      {operator.role === "release_lead" && <div className="new-region"><h3>添加其它区域</h3><div className="release-form">
        <Field label="区域名称"><input value={newRegionDraft.name} onChange={(e) => setNewRegionDraft({ ...newRegionDraft, name: e.target.value })} placeholder="例如：欧洲" /></Field>
        <Field label="区域代码"><input value={newRegionDraft.code} onChange={(e) => setNewRegionDraft({ ...newRegionDraft, code: e.target.value })} placeholder="例如：EU" /></Field>
        <Field label="主要语言"><input value={newRegionDraft.language} onChange={(e) => setNewRegionDraft({ ...newRegionDraft, language: e.target.value })} /></Field>
        <Field label="时区"><input value={newRegionDraft.timeZone} onChange={(e) => setNewRegionDraft({ ...newRegionDraft, timeZone: e.target.value })} /></Field>
      </div><div className="release-actions"><button className="primary" disabled={!newRegionDraft.name.trim() || !newRegionDraft.code.trim()} onClick={createRegion}><Plus />添加并切换</button></div></div>}
    </div></div>}
  </main>;
}
