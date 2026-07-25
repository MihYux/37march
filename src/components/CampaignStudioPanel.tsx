import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import {
  CheckCircle,
  ClipboardText,
  FileText,
  FloppyDisk,
  LockKey,
  Megaphone,
  PaperPlaneTilt,
  Pause,
  Play,
  Plus,
  ShieldCheck,
  Sparkle,
  SpinnerGap,
  Stop,
  UploadSimple,
  WarningOctagon,
  X,
  XCircle,
} from "@phosphor-icons/react";
import type {
  CampaignDraftInput,
  CampaignGenerationMode,
  CampaignPhase,
  CharacterCampaignTask,
  CharacterMessage,
  CompanionData,
  HumanReviewInput,
} from "../domain/types";
import type { ReleaseOperatorApi } from "../operator/api";

interface CampaignStudioPanelProps {
  api: ReleaseOperatorApi;
  data: CompanionData;
  onClose: () => void;
  onDataChange: (data: CompanionData) => void;
  onOpenCommunication: () => void;
}

const statusLabels: Record<CharacterCampaignTask["status"], string> = {
  draft: "草稿",
  awaiting_review: "待人工审核",
  approved: "已批准",
  running: "运行中",
  paused: "已暂停",
  completed: "已完成",
  stopped: "已停止",
};

const messageStatusLabels: Record<CharacterMessage["reviewStatus"], string> = {
  draft: "内容草稿",
  automatic_check_failed: "自动检查失败",
  awaiting_human_review: "待人工审核",
  approved: "已批准待投递",
  rejected: "已拒绝",
  expired: "已失效",
};

const generationModeLabels: Record<CampaignGenerationMode, string> = {
  template: "模板直接输出",
  template_variables: "模板变量",
  limited_generation: "有限生成",
};

const phaseLabels: Record<
  Exclude<CampaignPhase, "complete">,
  string
> = {
  daily: "日常",
  preheat: "D-14 预热",
  launch: "D0 上线",
  sustain: "D1～D42 持续",
  recall: "低频召回",
};

type CampaignWorkspace =
  | "facts"
  | "knowledge"
  | "review"
  | "content"
  | "publish";

const campaignWorkspaces: Array<{
  id: CampaignWorkspace;
  number: string;
  title: string;
  headline: string;
  description: string;
}> = [
  {
    id: "facts",
    number: "01",
    title: "任务信息",
    headline: "先让系统准确理解，这次任务为何重要。",
    description: "填写任务目标并锁定可引用事实。保存后，任何上游变更都会让旧审核失效。",
  },
  {
    id: "knowledge",
    number: "02",
    title: "方案知识",
    headline: "只让经过确认的事实，进入生成上下文。",
    description: "导入方案并逐条审核。原始文档与内部知识不会进入玩家可读数据。",
  },
  {
    id: "review",
    number: "03",
    title: "任务审核",
    headline: "在启动任务前，确认每一项边界。",
    description: "检查事实、时间、授权和联系策略，再由人工决定是否启动任务。",
  },
  {
    id: "content",
    number: "04",
    title: "内容生成",
    headline: "生成候选内容，由人完成最终判断。",
    description: "模型只生成候选。自动检查与人工批准完成前，内容不会进入投递流程。",
  },
  {
    id: "publish",
    number: "05",
    title: "发布投递",
    headline: "从小范围开始，并保留随时停止的能力。",
    description: "选择灰度范围，发布不可变内容包；实际投递前仍会重新检查玩家授权与频率。",
  },
];
function campaignToDraft(
  campaign: CharacterCampaignTask,
): CampaignDraftInput {
  return {
    version: campaign.version,
    globalTheme: campaign.globalTheme,
    narrativeApproach: campaign.narrativeApproach,
    sellingPoints: [...campaign.sellingPoints],
    targetSegments: [...campaign.targetSegments],
    generationMode: campaign.generationMode,
    fixedFacts: {
      versionName: campaign.fixedFacts.versionName ?? "",
      eventTime: campaign.fixedFacts.eventTime ?? "",
      actionTarget: campaign.fixedFacts.actionTarget ?? "",
      rewardStatement: campaign.fixedFacts.rewardStatement ?? "",
    },
  };
}

function defaultDraft(): CampaignDraftInput {
  return {
    version: "新的概念版本",
    globalTheme: "与三月七继续一段新的模拟旅程",
    narrativeApproach: "从玩家明确允许引用的共同经历自然切入。",
    sellingPoints: ["一段新的模拟旅程"],
    targetSegments: ["story", "character_relationship"],
    generationMode: "template_variables",
    fixedFacts: {
      versionName: "新的概念版本",
      eventTime: "待审核的模拟时间",
      actionTarget: "product://campaign/new-local-task",
      rewardStatement: "奖励信息仅为模拟占位，不代表真实游戏内容",
    },
  };
}

function ReviewChecks({
  title,
  review,
}: {
  title: string;
  review?: CharacterCampaignTask["automaticReview"];
}) {
  if (!review) return null;
  return (
    <section className="campaign-checks">
      <div className="campaign-section-title">
        <ShieldCheck weight="fill" />
        <strong>{title}</strong>
        <span className={review.passed ? "pass" : "fail"}>
          {review.passed ? "全部通过" : "存在阻断项"}
        </span>
      </div>
      <div className="campaign-check-list">
        {review.checks.map((item) => (
          <div
            key={item.id}
            className={`campaign-check ${item.status}`}
          >
            {item.status === "pass" ? (
              <CheckCircle weight="fill" />
            ) : (
              <XCircle weight="fill" />
            )}
            <div>
              <strong>{item.label}</strong>
              <p>{item.detail}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function CampaignStudioPanel({
  api,
  data,
  onClose,
  onDataChange,
  onOpenCommunication,
}: CampaignStudioPanelProps) {
  const [selectedCampaignId, setSelectedCampaignId] = useState(
    data.campaigns[0]?.id ?? "",
  );
  const selectedCampaign =
    data.campaigns.find(
      (campaign) => campaign.id === selectedCampaignId,
    ) ??
    data.campaigns[0] ??
    null;
  const [draft, setDraft] = useState<CampaignDraftInput>(
    selectedCampaign ? campaignToDraft(selectedCampaign) : defaultDraft(),
  );
  const [reviewer, setReviewer] = useState("本地审核员");
  const [reviewNote, setReviewNote] = useState("");
  const [phase, setPhase] =
    useState<Exclude<CampaignPhase, "complete">>("launch");
  const [selectedMessageId, setSelectedMessageId] = useState("");
  const [pastedPlan, setPastedPlan] = useState("");
  const [rolloutPercent, setRolloutPercent] =
    useState<5 | 25 | 100>(5);
  const [publisher, setPublisher] = useState("内部发行审核员");
  const [activeWorkspace, setActiveWorkspace] =
    useState<CampaignWorkspace>("facts");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);

  const activeWorkspaceIndex = campaignWorkspaces.findIndex(
    (workspace) => workspace.id === activeWorkspace,
  );
  const activeWorkspaceMeta =
    campaignWorkspaces[activeWorkspaceIndex] ?? campaignWorkspaces[0];
  const previousWorkspace = campaignWorkspaces[activeWorkspaceIndex - 1];
  const nextWorkspace = campaignWorkspaces[activeWorkspaceIndex + 1];
  const campaignMessages = useMemo(
    () =>
      data.messages.filter(
        (message) => message.campaignId === selectedCampaign?.id,
      ),
    [data.messages, selectedCampaign?.id],
  );
  const selectedMessage =
    campaignMessages.find(
      (message) => message.id === selectedMessageId,
    ) ??
    campaignMessages[0] ??
    null;

  useEffect(() => {
    if (!selectedCampaign) return;
    setDraft(campaignToDraft(selectedCampaign));
    setSelectedMessageId("");
    setReviewNote("");
    setActiveWorkspace("facts");
  }, [selectedCampaign?.id]);

  const updateText = (
    field: "version" | "globalTheme" | "narrativeApproach",
    value: string,
  ) => {
    setDraft((current) => ({ ...current, [field]: value }));
  };

  const updateFact = (
    field: keyof CampaignDraftInput["fixedFacts"],
    value: string,
  ) => {
    setDraft((current) => ({
      ...current,
      fixedFacts: {
        ...current.fixedFacts,
        [field]: value,
      },
    }));
  };

  const runMutation = async (
    action: string,
    mutation: () => Promise<CompanionData>,
    successText: string,
    after?: (nextData: CompanionData) => void,
  ) => {
    setBusy(action);
    setNotice(null);
    try {
      const nextData = await mutation();
      onDataChange(nextData);
      after?.(nextData);
      setNotice({ kind: "success", text: successText });
    } catch (error) {
      setNotice({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : "发行沙盒操作没有完成。",
      });
    } finally {
      setBusy("");
    }
  };

  const saveCampaign = () => {
    if (!api || !selectedCampaign) return;
    void runMutation(
      "save",
      () => api.updateCampaign(selectedCampaign.id, draft),
      "任务已保存，之前的审核结论已自动失效。",
    );
  };

  const createCampaign = () => {
    if (!api) return;
    void runMutation(
      "create",
      () => api.createCampaign(defaultDraft()),
      "已创建新的本地发行任务草稿。",
      (nextData) => {
        setSelectedCampaignId(nextData.campaigns[0]?.id ?? "");
      },
    );
  };

  const submitCampaign = () => {
    if (!api || !selectedCampaign) return;
    void runMutation(
      "campaign-check",
      () => api.submitCampaignReview(selectedCampaign.id),
      "任务自动检查已经完成。",
    );
  };

  const humanReviewCampaign = (decision: "approved" | "rejected") => {
    if (!api || !selectedCampaign) return;
    const input: HumanReviewInput = {
      decision,
      reviewer,
      note: reviewNote,
    };
    void runMutation(
      `campaign-${decision}`,
      () => api.reviewCampaign(selectedCampaign.id, input),
      decision === "approved"
        ? "任务已人工批准，可以开始运行。"
        : "任务已拒绝并退回草稿。",
    );
  };

  const lifecycle = (
    action: "start" | "pause" | "resume" | "stop" | "complete",
  ) => {
    if (!api || !selectedCampaign) return;
    if (
      (action === "stop" || action === "complete") &&
      !window.confirm(
        action === "stop"
          ? "停止后未发送内容会失效，且不能恢复。确定停止吗？"
          : "完成任务后会停止后续版本营销并恢复日常陪伴。确定完成吗？",
      )
    ) {
      return;
    }
    const text = {
      start: "任务已开始运行。",
      pause: "任务已暂停，后续联系立即停止。",
      resume: "任务已恢复运行。",
      stop: "任务已停止，未发送内容已经失效。",
      complete: "任务已完成，角色已恢复日常陪伴。",
    }[action];
    void runMutation(
      `lifecycle-${action}`,
      () => api.setCampaignLifecycle(selectedCampaign.id, action),
      text,
    );
  };

  const generateMessage = () => {
    if (!api || !selectedCampaign) return;
    void runMutation(
      "generate",
      () => api.generateCampaignMessage(selectedCampaign.id, phase),
      "已使用锁定事实生成内容草稿。",
      (nextData) => {
        const nextMessage = nextData.messages.find(
          (message) => message.campaignId === selectedCampaign.id,
        );
        setSelectedMessageId(nextMessage?.id ?? "");
      },
    );
  };

  const importDocument = async () => {
    if (!selectedCampaign) return;
    setBusy("import-document");
    setNotice(null);
    try {
      const result = await api.importDocument(selectedCampaign.id);
      onDataChange(result.data);
      setNotice({
        kind: "success",
        text: result.canceled
          ? "已取消导入。"
          : "发行方案已导入为待审核知识片段。",
      });
    } catch (error) {
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "发行方案导入失败。",
      });
    } finally {
      setBusy("");
    }
  };

  const importPastedPlan = () => {
    if (!selectedCampaign || !pastedPlan.trim()) return;
    void runMutation(
      "import-text",
      () =>
        api.importText(
          selectedCampaign.id,
          `${selectedCampaign.version}-pasted-plan.txt`,
          pastedPlan,
        ),
      "粘贴方案已导入为待审核知识片段。",
      () => setPastedPlan(""),
    );
  };

  const reviewKnowledge = (chunkId: string, approved: boolean) => {
    if (!selectedCampaign) return;
    void runMutation(
      `knowledge-${chunkId}`,
      () =>
        api.reviewKnowledge(selectedCampaign.id, chunkId, {
          approved,
          reviewer: publisher,
          phases: ["preheat", "launch", "sustain", "recall"],
          regions: [],
          segments: [],
          availableFrom: data.demoNow,
        }),
      approved
        ? "知识片段已批准，可在解禁范围内检索。"
        : "知识片段已撤销，不会进入模型上下文。",
    );
  };

  const publishBundle = () => {
    if (!selectedCampaign) return;
    void runMutation(
      "publish-bundle",
      () =>
        api.publishBundle(
          selectedCampaign.id,
          publisher,
          rolloutPercent,
        ),
      "不可变发行内容包已发布。",
    );
  };

  const toggleKillSwitch = () => {
    const enabled = !data.globalCampaignKillSwitch;
    if (
      enabled &&
      !window.confirm(
        "开启急停会停止所有任务、撤销内容包并让待发送消息失效。确定继续吗？",
      )
    ) {
      return;
    }
    void runMutation(
      "kill-switch",
      () => api.setKillSwitch(enabled, publisher),
      enabled
        ? "全局发行急停已开启。"
        : "全局发行急停已解除；任务不会自动恢复。",
    );
  };

  const automaticReviewMessage = () => {
    if (!api || !selectedMessage) return;
    void runMutation(
      "message-check",
      () => api.runMessageAutomaticReview(selectedMessage.id),
      "消息自动检查已经完成。",
    );
  };

  const humanReviewMessage = (decision: "approved" | "rejected") => {
    if (!api || !selectedMessage) return;
    void runMutation(
      `message-${decision}`,
      () =>
        api.reviewCampaignMessage(selectedMessage.id, {
          decision,
          reviewer,
          note: reviewNote,
        }),
      decision === "approved"
        ? "消息已人工批准，仍需单独投递。"
        : "消息已拒绝，不会进入玩家收件箱。",
    );
  };

  const deliverMessage = () => {
    if (!api || !selectedMessage) return;
    void runMutation(
      "deliver",
      () => api.deliverCampaignMessage(selectedMessage.id),
      "已再次检查联系策略；若允许，消息已进入通信中心。",
    );
  };

  const editable =
    selectedCampaign &&
    ["draft", "awaiting_review", "approved", "paused"].includes(
      selectedCampaign.status,
    );

  return (
    <motion.section
      className="campaign-studio-panel"
      role="dialog"
      aria-modal="true"
      aria-label="角色发行沙盒"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 6 }}
      transition={{ duration: 0.46, ease: [0.16, 1, 0.3, 1] }}
    >
      <header className="campaign-studio-header">
        <div>
          <span className="eyebrow">REHOYO / RELEASE CONTROL</span>
          <h2>发行控制台</h2>
          <p>本地工作区 · 所有生成内容均需人工批准</p>
        </div>
        <button
          type="button"
          autoFocus
          aria-label="关闭发行沙盒"
          title="关闭发行沙盒"
          onClick={onClose}
        >
          <X weight="bold" />
        </button>
      </header>

      <div className="campaign-studio-layout">
        <aside className="campaign-sidebar">
          <button
            type="button"
            className="campaign-create-button"
            disabled={!api || Boolean(busy)}
            onClick={createCampaign}
          >
            <Plus weight="bold" />
            新建发行任务
          </button>
          <div className="campaign-task-list">
            {data.campaigns.map((campaign) => (
              <button
                key={campaign.id}
                type="button"
                className={
                  campaign.id === selectedCampaign?.id ? "active" : ""
                }
                onClick={() => setSelectedCampaignId(campaign.id)}
              >
                <span>{statusLabels[campaign.status]}</span>
                <strong>{campaign.version}</strong>
                <small>{campaign.globalTheme}</small>
              </button>
            ))}
          </div>
        </aside>

        <div className="campaign-studio-scroll">
          <nav className="campaign-workflow" aria-label="发行工作流">
            {campaignWorkspaces.map((workspace) => (
              <button
                key={workspace.id}
                type="button"
                className={workspace.id === activeWorkspace ? "active" : ""}
                aria-current={
                  workspace.id === activeWorkspace ? "step" : undefined
                }
                onClick={() => setActiveWorkspace(workspace.id)}
              >
                <b>{workspace.number}</b>
                <span>{workspace.title}</span>
              </button>
            ))}
          </nav>
          <header className="campaign-page-header">
            <div>
              <span>
                步骤 {activeWorkspaceMeta.number} / 05
              </span>
              <h3>{activeWorkspaceMeta.headline}</h3>
              <p>{activeWorkspaceMeta.description}</p>
            </div>
            {nextWorkspace && (
              <small>完成后继续：{nextWorkspace.title}</small>
            )}
          </header>
          {selectedCampaign ? (
            <>
              {activeWorkspace === "facts" && (<>
              <section className="campaign-overview">
                <div className="campaign-overview-title">
                  <div>
                    <span
                      className={`campaign-status status-${selectedCampaign.status}`}
                    >
                      {statusLabels[selectedCampaign.status]}
                    </span>
                    <h3>{selectedCampaign.globalTheme}</h3>
                  </div>
                  <code>{selectedCampaign.id}</code>
                </div>
                <p>
                  所有数据均在本地沙盒中运行；批准不等于发送，实际投递前仍会检查玩家授权、勿扰、频率和退订。
                </p>
              </section>

              <section className="campaign-editor">
                <div className="campaign-section-title">
                  <ClipboardText weight="fill" />
                  <strong>任务与固定事实</strong>
                  <span>保存后自动锁定事实，并使旧审核失效</span>
                </div>
                <div className="campaign-form-sections">
                  <fieldset className="campaign-form-section">
                    <legend>
                      <span>01</span>
                      <div>
                        <strong>基础信息</strong>
                        <small>定义版本名称和生成方式</small>
                      </div>
                    </legend>
                    <div className="campaign-form-grid">
                      <label>
                        版本标识
                        <input
                          value={draft.version}
                          maxLength={60}
                          disabled={!api || !editable || Boolean(busy)}
                          onChange={(event) =>
                            updateText("version", event.target.value)
                          }
                        />
                      </label>
                      <label>
                        生成模式
                        <select
                          value={draft.generationMode}
                          disabled={!api || !editable || Boolean(busy)}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              generationMode: event.target
                                .value as CampaignGenerationMode,
                            }))
                          }
                        >
                          {Object.entries(generationModeLabels).map(
                            ([value, label]) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ),
                          )}
                        </select>
                      </label>
                      <label className="wide">
                        全局主题
                        <input
                          value={draft.globalTheme}
                          maxLength={100}
                          disabled={!api || !editable || Boolean(busy)}
                          onChange={(event) =>
                            updateText("globalTheme", event.target.value)
                          }
                        />
                      </label>
                    </div>
                  </fieldset>

                  <fieldset className="campaign-form-section">
                    <legend>
                      <span>02</span>
                      <div>
                        <strong>内容策略</strong>
                        <small>说明叙事方向、卖点和目标分群</small>
                      </div>
                    </legend>
                    <div className="campaign-form-grid">
                      <label className="wide">
                        叙事方式
                        <textarea
                          value={draft.narrativeApproach}
                          maxLength={240}
                          disabled={!api || !editable || Boolean(busy)}
                          onChange={(event) =>
                            updateText(
                              "narrativeApproach",
                              event.target.value,
                            )
                          }
                        />
                      </label>
                      <label>
                        卖点（逗号分隔）
                        <input
                          value={draft.sellingPoints.join("，")}
                          disabled={!api || !editable || Boolean(busy)}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              sellingPoints: event.target.value
                                .split(/[，,]/)
                                .map((item) => item.trim())
                                .filter(Boolean),
                            }))
                          }
                        />
                      </label>
                      <label>
                        分群（逗号分隔）
                        <input
                          value={draft.targetSegments.join("，")}
                          disabled={!api || !editable || Boolean(busy)}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              targetSegments: event.target.value
                                .split(/[，,]/)
                                .map((item) => item.trim())
                                .filter(Boolean),
                            }))
                          }
                        />
                      </label>
                    </div>
                  </fieldset>

                  <fieldset className="campaign-form-section">
                    <legend>
                      <span>03</span>
                      <div>
                        <strong>锁定事实</strong>
                        <small>生成内容只能引用这里确认的信息</small>
                      </div>
                    </legend>
                    <div className="campaign-form-grid">
                      <label>
                        活动名称
                        <input
                          value={draft.fixedFacts.versionName}
                          disabled={!api || !editable || Boolean(busy)}
                          onChange={(event) =>
                            updateFact("versionName", event.target.value)
                          }
                        />
                      </label>
                      <label>
                        活动时间
                        <input
                          value={draft.fixedFacts.eventTime}
                          disabled={!api || !editable || Boolean(busy)}
                          onChange={(event) =>
                            updateFact("eventTime", event.target.value)
                          }
                        />
                      </label>
                      <label className="wide">
                        安全入口（仅 product://）
                        <input
                          value={draft.fixedFacts.actionTarget}
                          disabled={!api || !editable || Boolean(busy)}
                          onChange={(event) =>
                            updateFact("actionTarget", event.target.value)
                          }
                        />
                      </label>
                      <label className="wide">
                        奖励说明
                        <input
                          value={draft.fixedFacts.rewardStatement}
                          disabled={!api || !editable || Boolean(busy)}
                          onChange={(event) =>
                            updateFact(
                              "rewardStatement",
                              event.target.value,
                            )
                          }
                        />
                      </label>
                    </div>
                  </fieldset>
                </div>
                <div className="campaign-editor-actions">
                  <button
                    type="button"
                    disabled={!api || !editable || Boolean(busy)}
                    onClick={saveCampaign}
                  >
                    <FloppyDisk weight="fill" />
                    保存草稿
                  </button>
                  {selectedCampaign.status === "draft" && (
                    <button
                      type="button"
                      className="primary"
                      disabled={!api || Boolean(busy)}
                      onClick={submitCampaign}
                    >
                      <ShieldCheck weight="fill" />
                      运行任务自动检查
                    </button>
                  )}
                </div>
              </section>
              </>)}
              {activeWorkspace === "knowledge" && (<>
              <section className="campaign-knowledge-panel">
                <div className="campaign-section-title">
                  <FileText weight="fill" />
                  <strong>发行方案与审核知识</strong>
                  <span>原始文档不会进入玩家只读数据</span>
                </div>
                <div className="campaign-knowledge-import">
                  <button
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() => void importDocument()}
                  >
                    <UploadSimple weight="bold" />
                    导入 DOCX / PDF
                  </button>
                  <textarea
                    value={pastedPlan}
                    maxLength={50000}
                    placeholder="也可以在这里粘贴发行方案、FAQ 或玩法说明……"
                    onChange={(event) => setPastedPlan(event.target.value)}
                  />
                  <button
                    type="button"
                    disabled={Boolean(busy) || !pastedPlan.trim()}
                    onClick={importPastedPlan}
                  >
                    <FileText weight="fill" />
                    导入粘贴内容
                  </button>
                </div>
                <div className="campaign-knowledge-list">
                  {(selectedCampaign.knowledgeChunks ?? []).map((chunk) => (
                    <article
                      key={chunk.id}
                      className={chunk.approved ? "approved" : ""}
                    >
                      <div>
                        <strong>{chunk.title}</strong>
                        <span>
                          {chunk.page ? `第 ${chunk.page} 页 · ` : ""}
                          {chunk.approved ? "已审核" : "待审核"}
                        </span>
                      </div>
                      <p>{chunk.text}</p>
                      <div className="campaign-button-row">
                        <button
                          type="button"
                          className={chunk.approved ? "" : "approve"}
                          disabled={Boolean(busy)}
                          onClick={() =>
                            reviewKnowledge(chunk.id, !chunk.approved)
                          }
                        >
                          {chunk.approved ? (
                            <XCircle weight="fill" />
                          ) : (
                            <ShieldCheck weight="fill" />
                          )}
                          {chunk.approved ? "撤销知识" : "批准知识"}
                        </button>
                      </div>
                    </article>
                  ))}
                  {(selectedCampaign.knowledgeChunks ?? []).length === 0 && (
                    <p className="campaign-empty-copy">
                      尚未导入发行方案。有限生成只会使用锁定事实，资料不足时拒绝补写。
                    </p>
                  )}
                </div>
              </section>
              </>)}
              {activeWorkspace === "publish" && (<>
              {!campaignMessages.some(
                (message) => message.reviewStatus === "approved",
              ) && (
                <section className="campaign-step-guidance">
                  <strong>发布前还缺少已批准内容</strong>
                  <p>先去“内容生成”完成自动检查和人工批准，再回来发布内容包。</p>
                  <button
                    type="button"
                    onClick={() => setActiveWorkspace("content")}
                  >
                    返回内容生成
                  </button>
                </section>
              )}              <section className="campaign-publish-panel">
                <div className="campaign-section-title">
                  <LockKey weight="fill" />
                  <strong>发布与紧急控制</strong>
                  <span>
                    有效内容包：
                    {(selectedCampaign.publishedBundles ?? []).filter(
                      (bundle) => bundle.status === "active",
                    ).length}
                  </span>
                </div>
                <div className="campaign-review-fields">
                  <label>
                    发布 / 审核人员
                    <input
                      value={publisher}
                      maxLength={40}
                      onChange={(event) => setPublisher(event.target.value)}
                    />
                  </label>
                  <label>
                    灰度范围
                    <select
                      value={rolloutPercent}
                      onChange={(event) =>
                        setRolloutPercent(
                          Number(event.target.value) as 5 | 25 | 100,
                        )
                      }
                    >
                      <option value={5}>内部验证后 5%</option>
                      <option value={25}>扩大到 25%</option>
                      <option value={100}>全量 100%</option>
                    </select>
                  </label>
                </div>
                <div className="campaign-button-row">
                  <button
                    type="button"
                    className="approve"
                    disabled={Boolean(busy) || !publisher.trim()}
                    onClick={publishBundle}
                  >
                    <LockKey weight="fill" />
                    发布不可变内容包
                  </button>
                  <button
                    type="button"
                    className="reject"
                    disabled={Boolean(busy)}
                    onClick={toggleKillSwitch}
                  >
                    <WarningOctagon weight="fill" />
                    {data.globalCampaignKillSwitch
                      ? "解除全局急停"
                      : "全局紧急停止"}
                  </button>
                </div>
              </section>
              </>)}
              {activeWorkspace === "review" && (<>
              {!selectedCampaign.automaticReview && (
                <section className="campaign-step-guidance">
                  <strong>先运行任务自动检查</strong>
                  <p>返回“任务信息”保存草稿并运行自动检查，检查通过后再进行人工审核。</p>
                  <button
                    type="button"
                    onClick={() => setActiveWorkspace("facts")}
                  >
                    返回任务信息
                  </button>
                </section>
              )}              <ReviewChecks
                title="任务自动检查"
                review={selectedCampaign.automaticReview}
              />

              <section className="campaign-review-actions">
                <div className="campaign-section-title">
                  <ShieldCheck weight="fill" />
                  <strong>人工审核与生命周期</strong>
                </div>
                <div className="campaign-review-fields">
                  <input
                    aria-label="审核者"
                    value={reviewer}
                    maxLength={40}
                    onChange={(event) => setReviewer(event.target.value)}
                  />
                  <input
                    aria-label="审核备注"
                    placeholder="拒绝时必须填写原因"
                    value={reviewNote}
                    maxLength={240}
                    onChange={(event) => setReviewNote(event.target.value)}
                  />
                </div>
                <div className="campaign-button-row">
                  {selectedCampaign.status === "awaiting_review" && (
                    <>
                      <button
                        type="button"
                        className="approve"
                        disabled={!api || Boolean(busy)}
                        onClick={() => humanReviewCampaign("approved")}
                      >
                        <CheckCircle weight="fill" />
                        人工批准任务
                      </button>
                      <button
                        type="button"
                        className="reject"
                        disabled={!api || Boolean(busy)}
                        onClick={() => humanReviewCampaign("rejected")}
                      >
                        <XCircle weight="fill" />
                        拒绝并退回
                      </button>
                    </>
                  )}
                  {selectedCampaign.status === "approved" && (
                    <button
                      type="button"
                      className="approve"
                      disabled={!api || Boolean(busy)}
                      onClick={() => lifecycle("start")}
                    >
                      <Play weight="fill" />
                      开始任务
                    </button>
                  )}
              {selectedCampaign.status === "running" && (
                    <button
                      type="button"
                      disabled={!api || Boolean(busy)}
                      onClick={() => lifecycle("pause")}
                    >
                      <Pause weight="fill" />
                      暂停
                    </button>
                  )}
                  {selectedCampaign.status === "paused" && (
                    <button
                      type="button"
                      className="approve"
                      disabled={!api || Boolean(busy)}
                      onClick={() => lifecycle("resume")}
                    >
                      <Play weight="fill" />
                      恢复
                    </button>
                  )}
                  {["running", "paused"].includes(
                    selectedCampaign.status,
                  ) && (
                    <button
                      type="button"
                      disabled={!api || Boolean(busy)}
                      onClick={() => lifecycle("complete")}
                    >
                      <CheckCircle />
                      正常完成
                    </button>
                  )}
                  {!["completed", "stopped"].includes(
                    selectedCampaign.status,
                  ) && (
                    <button
                      type="button"
                      className="reject"
                      disabled={!api || Boolean(busy)}
                      onClick={() => lifecycle("stop")}
                    >
                      <Stop weight="fill" />
                      紧急停止
                    </button>
                  )}
                </div>
              </section>

              <section className="campaign-schedule">
                <div className="campaign-section-title">
                  <Megaphone weight="fill" />
                  <strong>排期</strong>
                  <span>D-14 / D0 / D1～D42 / 结束</span>
                </div>
                <div className="campaign-schedule-list">
                  {selectedCampaign.schedule.map((item) => (
                    <div key={item.id}>
                      <strong>{item.phase}</strong>
                      <time dateTime={item.scheduledAt}>
                        {new Intl.DateTimeFormat("zh-CN", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        }).format(new Date(item.scheduledAt))}
                      </time>
                      <code>{item.templateId}</code>
                    </div>
                  ))}
                </div>
              </section>

              </>)}
              {activeWorkspace === "content" && (<>
              {selectedCampaign.status !== "running" &&
                campaignMessages.length === 0 && (
                  <section className="campaign-step-guidance">
                    <strong>任务尚未开始</strong>
                    <p>先在“任务审核”中批准并启动任务，之后才能生成候选内容。</p>
                    <button
                      type="button"
                      onClick={() => setActiveWorkspace("review")}
                    >
                      前往任务审核
                    </button>
                  </section>
                )}              {selectedCampaign.status === "running" && (
                <section className="campaign-generator">
                  <div className="campaign-section-title">
                    <Sparkle weight="fill" />
                    <strong>生成一条待审内容</strong>
                    <span>不会直接进入玩家收件箱</span>
                  </div>
                  <div className="campaign-generator-row">
                    <select
                      value={phase}
                      onChange={(event) =>
                        setPhase(
                          event.target.value as Exclude<
                            CampaignPhase,
                            "complete"
                          >,
                        )
                      }
                    >
                      {Object.entries(phaseLabels).map(
                        ([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ),
                      )}
                    </select>
                    <button
                      type="button"
                      className="primary"
                      disabled={!api || Boolean(busy)}
                      onClick={generateMessage}
                    >
                      <Sparkle weight="fill" />
                      生成草稿
                    </button>
                  </div>
                </section>
              )}

              {campaignMessages.length > 0 && (
                <section className="campaign-content-review">
                  <div className="campaign-section-title">
                    <PaperPlaneTilt weight="fill" />
                    <strong>内容审核与投递</strong>
                    <span>{campaignMessages.length} 条候选内容</span>
                  </div>
                  <div className="campaign-message-tabs">
                    {campaignMessages.map((message) => (
                      <button
                        key={message.id}
                        type="button"
                        className={
                          message.id === selectedMessage?.id
                            ? "active"
                            : ""
                        }
                        onClick={() => setSelectedMessageId(message.id)}
                      >
                        <span>
                          {messageStatusLabels[message.reviewStatus]}
                        </span>
                        <strong>{message.title}</strong>
                      </button>
                    ))}
                  </div>
                  {selectedMessage && (
                    <article className="campaign-message-preview">
                      <div>
                        <span>
                          {messageStatusLabels[
                            selectedMessage.reviewStatus
                          ]}
                        </span>
                        <code>{selectedMessage.trace.templateId}</code>
                      </div>
                      <h4>{selectedMessage.title}</h4>
                      <p>{selectedMessage.body}</p>
                      <dl>
                        <div>
                          <dt>固定事实</dt>
                          <dd>
                            {selectedMessage.trace.fixedFactIds.join(
                              "、",
                            ) || "无"}
                          </dd>
                        </div>
                        <div>
                          <dt>共同记忆</dt>
                          <dd>
                            {selectedMessage.trace.memoryIds.join("、") ||
                              "未引用"}
                          </dd>
                        </div>
                        <div>
                          <dt>投递</dt>
                          <dd>
                            {selectedMessage.sentAt
                              ? `已于 ${selectedMessage.sentAt} 投递`
                              : "尚未投递"}
                          </dd>
                        </div>
                      </dl>

                      <ReviewChecks
                        title="消息自动检查"
                        review={selectedMessage.automaticReview}
                      />

                      <div className="campaign-button-row">
                        {[
                          "draft",
                          "automatic_check_failed",
                        ].includes(selectedMessage.reviewStatus) && (
                          <button
                            type="button"
                            className="primary"
                            disabled={!api || Boolean(busy)}
                            onClick={automaticReviewMessage}
                          >
                            <ShieldCheck weight="fill" />
                            运行消息自动检查
                          </button>
                        )}
                        {selectedMessage.reviewStatus ===
                          "awaiting_human_review" && (
                          <>
                            <button
                              type="button"
                              className="approve"
                              disabled={!api || Boolean(busy)}
                              onClick={() =>
                                humanReviewMessage("approved")
                              }
                            >
                              <CheckCircle weight="fill" />
                              人工批准消息
                            </button>
                            <button
                              type="button"
                              className="reject"
                              disabled={!api || Boolean(busy)}
                              onClick={() =>
                                humanReviewMessage("rejected")
                              }
                            >
                              <XCircle weight="fill" />
                              拒绝消息
                            </button>
                          </>
                        )}
                        {selectedMessage.reviewStatus === "approved" &&
                          !selectedMessage.sentAt && (
                            <button
                              type="button"
                              className="approve"
                              disabled={!api || Boolean(busy)}
                              onClick={deliverMessage}
                            >
                              <PaperPlaneTilt weight="fill" />
                              检查策略并投递
                            </button>
                          )}
                        {selectedMessage.sentAt && (
                          <button
                            type="button"
                            onClick={onOpenCommunication}
                          >
                            <Megaphone weight="fill" />
                            打开通信中心
                          </button>
                        )}
                      </div>
                    </article>
                  )}
                </section>
              )}
              <nav className="campaign-page-actions" aria-label="页面导航">
                <button
                  type="button"
                  disabled={!previousWorkspace}
                  onClick={() =>
                    previousWorkspace &&
                    setActiveWorkspace(previousWorkspace.id)
                  }
                >
                  {previousWorkspace
                    ? `上一步：${previousWorkspace.title}`
                    : "已经是第一步"}
                </button>
                <span>
                  {activeWorkspaceMeta.number} / 05
                </span>
                <button
                  type="button"
                  className="next"
                  disabled={!nextWorkspace}
                  onClick={() =>
                    nextWorkspace && setActiveWorkspace(nextWorkspace.id)
                  }
                >
                  {nextWorkspace
                    ? `下一步：${nextWorkspace.title}`
                    : "流程已浏览完成"}
                </button>
              </nav>              </>)}
            </>
          ) : (
            <div className="campaign-empty">
              <Megaphone weight="duotone" />
              <strong>还没有发行任务</strong>
              <p>新建的任务只保存在本地沙盒，不会连接外部分发渠道。</p>
            </div>
          )}
        </div>
      </div>

      {busy && (
        <div className="campaign-busy" aria-live="polite">
          <SpinnerGap className="spin" />
          正在执行并记录审核日志…
        </div>
      )}
      {notice && (
        <p
          className={`campaign-notice ${notice.kind}`}
          role="status"
        >
          {notice.text}
        </p>
      )}
    </motion.section>
  );
}
