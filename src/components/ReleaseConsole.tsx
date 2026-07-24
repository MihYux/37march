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
const responseLabels = { interested: "感兴趣", inquiry: "追问", cold: "冷淡", refuse: "拒绝" };
const recommendationLabels = { expand: "建议扩大", observe: "继续观察", optimize: "需要优化", pause: "立即暂停", rollback: "建议回滚" };

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
  const experiment = workspace.experiments.find((item) => item.id === latestPlanRelease?.experimentId) ?? null;
  const evaluation = workspace.evaluations.find((item) => item.experimentId === experiment?.id) ?? null;
  const deliveries = workspace.aiDeliveries?.filter((item) => item.taskId === task?.id) ?? [];
  const [taskDraft, setTaskDraft] = useState<ReleaseTaskInput>(() => task ? taskInput(task) : blankTask(data));
  const [newRegionDraft, setNewRegionDraft] = useState({
    name: "", code: "", language: "zh-CN", timeZone: "Asia/Shanghai",
  });
  const [rolloutPercent, setRolloutPercent] = useState(5);
  const [metricText, setMetricText] = useState("");
  const [optimizationReason, setOptimizationReason] = useState("");
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
        <div className="release-actions"><button className="primary publish" disabled={!canPublish || operator.role !== "release_lead"} onClick={() => mutate("publish-plan", () => api.publishPlanToAgents(region.id, task.id, rolloutPercent), `区域发行方案已按 ${rolloutPercent}% 灰度发布。`)}><PaperPlaneTilt weight="fill" />发布方案</button></div>
      </div>
    </>;
  };

  const percent = (value = 0) => `${(value * 100).toFixed(1)}%`;
  const renderOptimization = () => {
    if (!experiment) return <Empty text="版本发布并开始灰度后，这里用于收集效果数据。" />;
    return <>
      {evaluation ? <div className={`recommendation ${evaluation.recommendation}`}><span>当前结论</span><h2>{recommendationLabels[evaluation.recommendation]}</h2><p>{evaluation.reason}</p><small>扩大、暂停或回滚都需要人工确认。</small></div> :
        <div className="optimization-intro"><ChartLineUp weight="duotone" /><div><h2>等待第一批运行数据</h2><p>导入各发行 AI 汇总的真实数据后，控制台会计算效果与关系健康指标。</p></div></div>}
      <div className="release-grid two">
        <Card title="收集运行数据"><textarea className="data-input" value={metricText} onChange={(e) => setMetricText(e.target.value)} placeholder={'date,groupId,delivered,read,replied,clicked,participated,unsubscribed,blocked,complaints,continuedConversation,proactiveConversation\n2026-08-01,symbiotic,120,80,18,12,8,0,0,0,7,3'} /><div className="release-actions"><button onClick={() => mutate("metric-file", async () => (await api.importMetricsFile(region.id, experiment.id)).data, "数据文件已导入。")}><UploadSimple />选择 CSV / JSON</button><button className="primary" disabled={!metricText.trim()} onClick={() => mutate("metrics", () => api.importMetrics(region.id, experiment.id, metricText), "运行数据已收集并完成评估。")}><ChartLineUp />导入并分析</button></div></Card>
        <Card title="数据范围"><dl className="release-facts"><div><dt>版本任务</dt><dd>{task?.title}</dd></div><div><dt>发布区域</dt><dd>{region.name}</dd></div><div><dt>发行 AI</dt><dd>{region.releaseAgents.filter((item) => item.enabled).length} 个</dd></div><div><dt>已收集记录</dt><dd>{workspace.metrics.filter((item) => item.experimentId === experiment.id).length} 条</dd></div></dl></Card>
      </div>
      {evaluation && <div className="metric-sections"><Card title="效果指标"><div className="metric-grid"><div><strong>{evaluation.calculated.sampleSize}</strong><span>触达样本</span></div><div><strong>{percent(evaluation.calculated.readRate)}</strong><span>阅读率</span></div><div><strong>{percent(evaluation.calculated.replyRate)}</strong><span>回复率</span></div><div><strong>{percent(evaluation.calculated.participationRate)}</strong><span>参与率</span></div></div></Card><Card title="关系健康"><div className="metric-grid"><div><strong>{percent(evaluation.calculated.continuedConversationRate)}</strong><span>持续对话</span></div><div><strong>{percent(evaluation.calculated.unsubscribeRate)}</strong><span>退订率</span></div><div><strong>{percent(evaluation.calculated.blockedRate)}</strong><span>屏蔽率</span></div><div><strong>{percent(evaluation.calculated.complaintRate)}</strong><span>投诉率</span></div></div></Card></div>}
      {evaluation && <Card title="记录下一版优化"><textarea value={optimizationReason} onChange={(e) => setOptimizationReason(e.target.value)} placeholder="记录需要调整的指令、灰度比例或区域表达" /><div className="release-actions"><button className="primary" disabled={!optimizationReason.trim()} onClick={() => mutate("optimization", () => api.createOptimization(region.id, experiment.id, optimizationReason), "下一版优化记录已创建。")}><Sparkle />创建优化记录</button></div></Card>}
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
