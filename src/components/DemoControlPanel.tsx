import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import {
  ArrowCounterClockwise,
  BellSlash,
  CheckCircle,
  ClockCounterClockwise,
  EnvelopeSimple,
  FastForward,
  Hand,
  Heart,
  ListBullets,
  Megaphone,
  SpinnerGap,
  UsersThree,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import type {
  CompanionData,
  DemoAction,
  DemoScenarioId,
  DemoScenarioSummary,
  ExecutionLogEntry,
} from "../domain/types";

interface DemoControlPanelProps {
  data: CompanionData;
  onClose: () => void;
  onDataChange: (data: CompanionData) => void;
  onOpenCampaign: () => void;
  onOpenCommunication: () => void;
}

type LogFilter = "all" | ExecutionLogEntry["category"];

const fallbackScenarios: DemoScenarioSummary[] = [
  {
    id: "japan_story",
    name: "日本剧情玩家",
    regionLabel: "日本 · Asia/Tokyo",
    playerLabel: "重剧情与角色关系",
    description:
      "允许日常、旅行和版本消息，保留共同记忆，但不接受低频召回。",
    expectedBehavior:
      "正常收到预热与上线候选内容，可引用获准共同记忆。",
  },
  {
    id: "china_active",
    name: "中国活跃玩家",
    regionLabel: "中国 · Asia/Shanghai",
    playerLabel: "高活跃与共同记录",
    description:
      "允许日常、照片和版本内容，互动频繁，每周联系上限更高。",
    expectedBehavior:
      "排期正常进入审核队列，关系阶段较快进入熟悉与同行。",
  },
  {
    id: "north_america_intensity",
    name: "北美强度玩家",
    regionLabel: "北美 · America/Los_Angeles",
    playerLabel: "关注玩法强度，低打扰",
    description:
      "只允许版本上线与持续内容，关闭长期记忆，每周最多一次联系。",
    expectedBehavior:
      "相同时刻会命中当地勿扰，且不得引用任何共同记忆。",
  },
];

const logCategoryLabels: Record<LogFilter, string> = {
  all: "全部",
  system: "系统",
  consent: "授权",
  memory: "记忆",
  event: "事件",
  review: "审核",
  delivery: "投递",
  preference: "偏好",
  campaign: "任务",
  risk: "风险",
};

const actionLabels: Record<DemoAction, string> = {
  ignore_contact: "忽略一次联系",
  positive_reply: "喜欢并回复",
  unsubscribe_version: "退订版本内容",
  risk_unsafe_link: "触发风险文案",
};

function formatDemoTime(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(value));
}

function daySinceStart(data: CompanionData) {
  return Math.floor(
    (Date.parse(data.demoNow) - Date.parse(data.demoStartedAt)) /
      (24 * 60 * 60 * 1_000),
  );
}

export function DemoControlPanel({
  data,
  onClose,
  onDataChange,
  onOpenCampaign,
  onOpenCommunication,
}: DemoControlPanelProps) {
  const [scenarios, setScenarios] =
    useState<DemoScenarioSummary[]>(fallbackScenarios);
  const [logFilter, setLogFilter] = useState<LogFilter>("all");
  const [selectedLogId, setSelectedLogId] = useState(
    data.executionLog.at(-1)?.id ?? "",
  );
  const [customTime, setCustomTime] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);

  useEffect(() => {
    let active = true;
    window.marchDesktop?.companion
      .getDemoScenarios()
      .then((items) => {
        if (active && items.length) setScenarios(items);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const logs = useMemo(
    () =>
      [...data.executionLog]
        .reverse()
        .filter(
          (entry) =>
            logFilter === "all" || entry.category === logFilter,
        ),
    [data.executionLog, logFilter],
  );
  const selectedLog =
    data.executionLog.find((entry) => entry.id === selectedLogId) ??
    logs[0] ??
    null;
  const currentDay = daySinceStart(data);
  const pendingReviewCount = data.messages.filter(
    (message) =>
      message.reviewStatus === "awaiting_human_review",
  ).length;
  const suppressedEventCount = data.events.filter(
    (event) => event.status === "suppressed",
  ).length;
  const riskCount = data.executionLog.filter(
    (entry) => entry.category === "risk",
  ).length;

  const runMutation = async (
    action: string,
    mutation: () => Promise<CompanionData>,
    successText: string,
  ) => {
    setBusy(action);
    setNotice(null);
    try {
      const nextData = await mutation();
      onDataChange(nextData);
      setSelectedLogId(nextData.executionLog.at(-1)?.id ?? "");
      setNotice({ kind: "success", text: successText });
    } catch (error) {
      setNotice({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : "演示控制操作没有完成。",
      });
    } finally {
      setBusy("");
    }
  };

  const api = window.marchDesktop?.companion;

  const loadScenario = (
    scenario: DemoScenarioSummary,
    skipConfirmation = false,
  ) => {
    if (!api) return;
    if (
      !skipConfirmation &&
      !window.confirm(
        `载入“${scenario.name}”会重置当前本地 Demo 数据，但不会影响模型和语音设置。确定继续吗？`,
      )
    ) {
      return;
    }
    void runMutation(
      `scenario-${scenario.id}`,
      () => api.loadDemoScenario(scenario.id),
      `已载入${scenario.name}，演示时钟回到 Day 0。`,
    );
  };

  const advanceDay = (day: 1 | 7 | 14 | 42) => {
    if (!api) return;
    void runMutation(
      `day-${day}`,
      () => api.advanceDemoTime({ day }),
      `演示时间已推进到 Day ${day}，排期与关系状态已重新计算。`,
    );
  };

  const advanceCustom = () => {
    if (!api || !customTime) return;
    const parsed = new Date(customTime);
    if (!Number.isFinite(parsed.getTime())) {
      setNotice({ kind: "error", text: "请输入有效的自定义时间。" });
      return;
    }
    void runMutation(
      "custom-time",
      () =>
        api.advanceDemoTime({
          target: parsed.toISOString(),
        }),
      "演示时间已推进到自定义时刻。",
    );
  };

  const triggerAction = (action: DemoAction) => {
    if (!api) return;
    const destructive = action === "unsubscribe_version";
    if (
      destructive &&
      !window.confirm(
        "退订会立即停止当前版本任务并让未发送内容失效。确定执行这个演示动作吗？",
      )
    ) {
      return;
    }
    void runMutation(
      `action-${action}`,
      () => api.triggerDemoAction(action),
      {
        ignore_contact:
          "已记录一次忽略；连续两次会进入七天安静期。",
        positive_reply: "已模拟玩家喜欢并回复最近通信。",
        unsubscribe_version:
          "已退订版本内容并停止活动任务。",
        risk_unsafe_link:
          "风险文案已生成并被自动检查拦截，没有投递。",
      }[action],
    );
  };

  const resetDefault = () => {
    if (!api) return;
    if (
      !window.confirm(
        "重置会恢复完全一致的日本剧情玩家默认案例。模型与语音设置不会被删除。确定重置吗？",
      )
    ) {
      return;
    }
    void runMutation(
      "reset",
      () => api.resetDemo(),
      "Demo 已恢复为确定性的日本剧情玩家默认案例。",
    );
  };

  const guideSteps = [
    {
      label: "载入一个模拟玩家",
      done: data.demoScenarioId !== "unconfigured",
    },
    {
      label: "推进到 Day 1，观察预热候选或抑制原因",
      done: currentDay >= 1,
    },
    {
      label: "推进到 Day 14，观察版本上线与关系阶段",
      done: currentDay >= 14,
    },
    {
      label: "在发行沙盒审核内容，或触发风险拦截",
      done: pendingReviewCount > 0 || riskCount > 0,
    },
    {
      label: "打开通信中心查看实际获批且已投递的消息",
      done: data.messages.some(
        (message) =>
          message.campaignId &&
          message.reviewStatus === "approved" &&
          message.sentAt,
      ),
    },
  ];

  return (
    <motion.section
      className="demo-control-panel"
      role="dialog"
      aria-modal="true"
      aria-label="Demo 控制中心"
      initial={{ opacity: 0, y: 20, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 16, scale: 0.98 }}
      transition={{ type: "spring", stiffness: 340, damping: 30 }}
    >
      <header className="demo-control-header">
        <div>
          <span className="eyebrow">REHOYO LOCAL DEMO · 系统时间不会改变</span>
          <h2>Demo 控制中心</h2>
          <p>模拟玩家、时间快进、行为触发、执行日志与确定性重置</p>
        </div>
        <button
          type="button"
          autoFocus
          aria-label="关闭 Demo 控制中心"
          title="关闭 Demo 控制中心"
          onClick={onClose}
        >
          <X weight="bold" />
        </button>
      </header>

      <div className="demo-control-scroll">
        <section className="demo-current-state">
          <div>
            <span>当前案例</span>
            <strong>
              {scenarios.find(
                (scenario) => scenario.id === data.demoScenarioId,
              )?.name ?? "未配置"}
            </strong>
          </div>
          <div>
            <span>演示时间</span>
            <strong>
              Day {currentDay} ·{" "}
              {formatDemoTime(data.demoNow, data.profile.timeZone)}
            </strong>
          </div>
          <div>
            <span>关系阶段</span>
            <strong>{data.relationship.relationshipStage}</strong>
          </div>
          <div>
            <span>结果</span>
            <strong>
              待审 {pendingReviewCount} · 抑制 {suppressedEventCount}
            </strong>
          </div>
        </section>

        <section className="demo-section">
          <div className="demo-section-title">
            <UsersThree weight="fill" />
            <strong>三个模拟玩家</strong>
            <span>切换会重置当前 Demo</span>
          </div>
          <div className="demo-scenario-grid">
            {scenarios.map((scenario) => (
              <article
                key={scenario.id}
                className={
                  scenario.id === data.demoScenarioId ? "active" : ""
                }
              >
                <span>{scenario.regionLabel}</span>
                <h3>{scenario.name}</h3>
                <strong>{scenario.playerLabel}</strong>
                <p>{scenario.description}</p>
                <small>{scenario.expectedBehavior}</small>
                <button
                  type="button"
                  disabled={!api || Boolean(busy)}
                  onClick={() => loadScenario(scenario)}
                >
                  {scenario.id === data.demoScenarioId
                    ? "重新载入"
                    : "载入案例"}
                </button>
              </article>
            ))}
          </div>
        </section>

        <section className="demo-section">
          <div className="demo-section-title">
            <ClockCounterClockwise weight="fill" />
            <strong>演示时钟</strong>
            <span>只允许向前，最多 365 天</span>
          </div>
          <div className="demo-time-buttons">
            {([1, 7, 14, 42] as const).map((day) => (
              <button
                key={day}
                type="button"
                disabled={!api || Boolean(busy) || currentDay >= day}
                onClick={() => advanceDay(day)}
              >
                <FastForward weight="fill" />
                Day {day}
              </button>
            ))}
          </div>
          <div className="demo-custom-time">
            <input
              type="datetime-local"
              aria-label="自定义演示时间"
              value={customTime}
              disabled={!api || Boolean(busy)}
              onChange={(event) => setCustomTime(event.target.value)}
            />
            <button
              type="button"
              disabled={!api || !customTime || Boolean(busy)}
              onClick={advanceCustom}
            >
              推进到自定义时间
            </button>
          </div>
        </section>

        <section className="demo-section">
          <div className="demo-section-title">
            <WarningCircle weight="fill" />
            <strong>行为与风险触发</strong>
            <span>全部写入本地日志</span>
          </div>
          <div className="demo-action-grid">
            <button
              type="button"
              disabled={!api || Boolean(busy)}
              onClick={() => triggerAction("ignore_contact")}
            >
              <Hand weight="fill" />
              {actionLabels.ignore_contact}
            </button>
            <button
              type="button"
              disabled={!api || Boolean(busy)}
              onClick={() => triggerAction("positive_reply")}
            >
              <Heart weight="fill" />
              {actionLabels.positive_reply}
            </button>
            <button
              type="button"
              disabled={!api || Boolean(busy)}
              onClick={() => triggerAction("unsubscribe_version")}
            >
              <BellSlash weight="fill" />
              {actionLabels.unsubscribe_version}
            </button>
            <button
              type="button"
              disabled={!api || Boolean(busy)}
              onClick={() => triggerAction("risk_unsafe_link")}
            >
              <WarningCircle weight="fill" />
              {actionLabels.risk_unsafe_link}
            </button>
          </div>
        </section>

        <section className="demo-section demo-guide">
          <div className="demo-section-title">
            <CheckCircle weight="fill" />
            <strong>三分钟演示引导</strong>
            <span>
              {guideSteps.filter((item) => item.done).length}/
              {guideSteps.length}
            </span>
          </div>
          <ol>
            {guideSteps.map((step) => (
              <li key={step.label} className={step.done ? "done" : ""}>
                <CheckCircle weight={step.done ? "fill" : "regular"} />
                {step.label}
              </li>
            ))}
          </ol>
          <div className="demo-guide-actions">
            <button type="button" onClick={onOpenCampaign}>
              <Megaphone weight="fill" />
              打开发行沙盒
            </button>
            <button type="button" onClick={onOpenCommunication}>
              <EnvelopeSimple weight="fill" />
              打开通信中心
            </button>
          </div>
        </section>

        <section className="demo-section demo-logs">
          <div className="demo-section-title">
            <ListBullets weight="fill" />
            <strong>执行日志</strong>
            <span>{data.executionLog.length} 条</span>
          </div>
          <nav aria-label="执行日志分类">
            {(Object.keys(logCategoryLabels) as LogFilter[]).map(
              (category) => (
                <button
                  key={category}
                  type="button"
                  className={logFilter === category ? "active" : ""}
                  onClick={() => setLogFilter(category)}
                >
                  {logCategoryLabels[category]}
                </button>
              ),
            )}
          </nav>
          <div className="demo-log-layout">
            <div className="demo-log-list">
              {logs.length ? (
                logs.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    className={
                      selectedLog?.id === entry.id ? "active" : ""
                    }
                    onClick={() => setSelectedLogId(entry.id)}
                  >
                    <span>{logCategoryLabels[entry.category]}</span>
                    <strong>{entry.summary}</strong>
                    <time dateTime={entry.occurredAt}>
                      {new Intl.DateTimeFormat("zh-CN", {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      }).format(new Date(entry.occurredAt))}
                    </time>
                  </button>
                ))
              ) : (
                <p>这个分类暂时没有日志。</p>
              )}
            </div>
            <article className="demo-log-detail">
              {selectedLog ? (
                <>
                  <span>{selectedLog.action}</span>
                  <h3>{selectedLog.summary}</h3>
                  <dl>
                    <div>
                      <dt>执行者</dt>
                      <dd>{selectedLog.actor}</dd>
                    </div>
                    <div>
                      <dt>实体</dt>
                      <dd>
                        {selectedLog.entityType ?? "—"} /{" "}
                        {selectedLog.entityId ?? "—"}
                      </dd>
                    </div>
                    <div>
                      <dt>真实记录时间</dt>
                      <dd>{selectedLog.occurredAt}</dd>
                    </div>
                  </dl>
                  <pre>
                    {JSON.stringify(selectedLog.metadata, null, 2)}
                  </pre>
                </>
              ) : (
                <p>选择一条日志查看详情。</p>
              )}
            </article>
          </div>
        </section>

        <section className="demo-reset-zone">
          <div>
            <strong>确定性重置</strong>
            <p>
              恢复日本剧情玩家 Day 0 默认案例；不会删除 DeepSeek 或
              DashScope 设置。
            </p>
          </div>
          <button
            type="button"
            disabled={!api || Boolean(busy)}
            onClick={resetDefault}
          >
            <ArrowCounterClockwise weight="bold" />
            重置 Demo
          </button>
        </section>
      </div>

      {busy && (
        <div className="demo-busy" aria-live="polite">
          <SpinnerGap className="spin" />
          正在执行本地演示步骤…
        </div>
      )}
      {notice && (
        <p className={`demo-notice ${notice.kind}`} role="status">
          {notice.text}
        </p>
      )}
    </motion.section>
  );
}
