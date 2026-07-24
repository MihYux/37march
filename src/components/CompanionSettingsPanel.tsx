import { useEffect, useState } from "react";
import { motion } from "motion/react";
import {
  Bell,
  BellSlash,
  DownloadSimple,
  FloppyDisk,
  Magnet,
  PauseCircle,
  PlayCircle,
  ShieldCheck,
  SignOut,
  SpinnerGap,
  Trash,
  X,
} from "@phosphor-icons/react";
import type {
  CharacterMessageType,
  CompanionData,
  CompanionPreferencesInput,
  ContactPolicyStatus,
  DesktopWindowStatus,
} from "../domain/types";

interface CompanionSettingsPanelProps {
  data: CompanionData;
  desktopStatus: DesktopWindowStatus | null;
  onClose: () => void;
  onDataChange: (data: CompanionData) => void;
  onDesktopStatusChange: (status: DesktopWindowStatus) => void;
}

const contentGroups: Array<{
  id: string;
  label: string;
  types: CharacterMessageType[];
}> = [
  {
    id: "daily",
    label: "日常与关系",
    types: ["daily", "relationship"],
  },
  {
    id: "travel",
    label: "照片与明信片",
    types: ["photo", "postcard"],
  },
  {
    id: "version",
    label: "版本内容",
    types: [
      "version_preheat",
      "version_launch",
      "version_sustain",
    ],
  },
];

const policyReasonLabels: Record<string, string> = {
  onboarding_required: "尚未完成授权",
  companion_paused: "同行已暂停",
  proactive_contact_disabled: "主动联系已关闭",
  content_type_disabled: "日常内容未授权",
  recall_not_authorized: "召回未授权",
  quiet_hours: "当前处于勿扰时间",
  quiet_period: "连续忽略后的安静期",
  weekly_contact_limit: "本周主动联系已达上限",
  reduced_content_frequency: "此类内容处于降频周期",
  duplicate_template: "近期已有相同内容",
  invalid_event: "事件信息不完整",
};

export function CompanionSettingsPanel({
  data,
  desktopStatus,
  onClose,
  onDataChange,
  onDesktopStatusChange,
}: CompanionSettingsPanelProps) {
  const [displayName, setDisplayName] = useState(
    data.profile.displayName,
  );
  const [proactiveContactEnabled, setProactiveContactEnabled] =
    useState(data.profile.proactiveContactEnabled);
  const [allowedContentTypes, setAllowedContentTypes] = useState<
    CharacterMessageType[]
  >(data.profile.allowedContentTypes);
  const [recallEnabled, setRecallEnabled] = useState(
    data.profile.recallEnabled,
  );
  const [personalizationEnabled, setPersonalizationEnabled] =
    useState(data.profile.personalizationEnabled);
  const [memoryEnabled, setMemoryEnabled] = useState(
    data.profile.memoryEnabled,
  );
  const [quietStart, setQuietStart] = useState(
    data.profile.quietHours.start,
  );
  const [quietEnd, setQuietEnd] = useState(
    data.profile.quietHours.end,
  );
  const [weeklyContactLimit, setWeeklyContactLimit] = useState(
    data.profile.weeklyContactLimit,
  );
  const [busyAction, setBusyAction] = useState("");
  const [notice, setNotice] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);
  const [policyStatus, setPolicyStatus] =
    useState<ContactPolicyStatus | null>(null);

  const refreshPolicyStatus = () => {
    void window.marchDesktop?.companion
      .getContactPolicyStatus()
      .then(setPolicyStatus)
      .catch(() => setPolicyStatus(null));
  };

  useEffect(refreshPolicyStatus, []);

  const toggleContentGroup = (
    types: CharacterMessageType[],
    enabled: boolean,
  ) => {
    setAllowedContentTypes((current) => {
      const next = new Set(current);
      for (const type of types) {
        if (enabled) next.add(type);
        else next.delete(type);
      }
      return [...next];
    });
  };

  const runAction = async (
    action: string,
    task: () => Promise<CompanionData>,
    successText: string,
    closeAfter = false,
  ) => {
    setBusyAction(action);
    setNotice(null);
    try {
      const nextData = await task();
      onDataChange(nextData);
      refreshPolicyStatus();
      setNotice({
        kind: "success",
        text: successText,
      });
      if (closeAfter) onClose();
    } catch (error) {
      setNotice({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : "同行设置没有保存，请稍后重试。",
      });
    } finally {
      setBusyAction("");
    }
  };

  const save = () => {
    const api = window.marchDesktop?.companion;
    if (!api) return;
    const input: CompanionPreferencesInput = {
      displayName: displayName.trim(),
      proactiveContactEnabled,
      allowedContentTypes,
      recallEnabled,
      personalizationEnabled,
      memoryEnabled,
      quietHours: {
        start: quietStart,
        end: quietEnd,
      },
      weeklyContactLimit,
    };
    void runAction(
      "save",
      () => api.savePreferences(input),
      "同行授权与联系偏好已经保存。",
    );
  };

  const togglePause = () => {
    const api = window.marchDesktop?.companion;
    if (!api) return;
    const paused = !data.relationship.paused;
    void runAction(
      "pause",
      () => api.setPaused(paused),
      paused
        ? "角色同行已暂停，不会产生主动联系。"
        : "角色同行已经恢复。",
    );
  };

  const exitCompanion = () => {
    const api = window.marchDesktop?.companion;
    if (
      !api ||
      !window.confirm(
        "确定退出角色同行计划吗？\n\n主动联系和召回会立即关闭，现有相册和通信记录仍保留。再次进入时需要重新确认授权。",
      )
    ) {
      return;
    }
    void runAction(
      "exit",
      () => api.exit(),
      "已经退出角色同行计划。",
      true,
    );
  };

  const deleteRelationshipData = () => {
    const api = window.marchDesktop?.companion;
    if (
      !api ||
      !window.confirm(
        "确定删除全部角色同行数据吗？\n\n这会清空共同相册、通信记录、关系状态、偏好和执行日志，且无法撤销。模型和语音 API Key 设置不会被删除。",
      )
    ) {
      return;
    }
    void runAction(
      "delete",
      () => api.deleteRelationshipData(),
      "全部角色同行数据已经删除。",
      true,
    );
  };

  const exportCompanionData = async () => {
    const api = window.marchDesktop?.companion;
    if (!api) return;
    setBusyAction("export");
    setNotice(null);
    try {
      const result = await api.exportData();
      if (result.ok) {
        setNotice({
          kind: "success",
          text: "角色同行本地数据已经导出，不包含 API Key、语音缓存或自由聊天。",
        });
      }
    } catch {
      setNotice({
        kind: "error",
        text: "本地数据没有导出，请稍后重试。",
      });
    } finally {
      setBusyAction("");
    }
  };

  const setSnapEnabled = async (enabled: boolean) => {
    const desktop = window.marchDesktop;
    if (!desktop) return;
    try {
      const status = await desktop.setSnapEnabled(enabled);
      onDesktopStatusChange(status);
      setNotice({
        kind: "success",
        text: enabled
          ? "窗口边缘吸附已经开启。"
          : "窗口边缘吸附已经关闭。",
      });
    } catch {
      setNotice({
        kind: "error",
        text: "桌面窗口设置没有保存，请稍后重试。",
      });
    }
  };


  return (
    <motion.section
      className="companion-settings-panel"
      role="dialog"
      aria-modal="true"
      aria-label="角色同行设置"
      initial={{ opacity: 0, y: 20, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 16, scale: 0.98 }}
      transition={{ type: "spring", stiffness: 340, damping: 30 }}
    >
      <header className="companion-settings-header">
        <div>
          <span className="eyebrow">RELATIONSHIP CONTROL</span>
          <h2>角色同行设置</h2>
          <p>授权、频率、勿扰和退出始终由你控制</p>
        </div>
        <button
          type="button"
          autoFocus
          aria-label="关闭角色同行设置"
          title="关闭同行设置"
          onClick={onClose}
        >
          <X weight="bold" />
        </button>
      </header>

      <div className="companion-settings-scroll">
        <div
          className={`companion-status-card ${
            data.relationship.paused ? "paused" : ""
          }`}
        >
          {data.relationship.paused ? (
            <PauseCircle weight="fill" />
          ) : (
            <PlayCircle weight="fill" />
          )}
          <span>
            <strong>
              {data.relationship.paused
                ? "角色同行已暂停"
                : "角色同行正在运行"}
            </strong>
            <small>
              当前关系阶段：{data.relationship.relationshipStage}
              {policyStatus &&
                ` · ${
                  policyStatus.allowed
                    ? "当前允许日常联系"
                    : policyReasonLabels[policyStatus.reason ?? ""] ??
                      "当前保持沉默"
                }`}
            </small>
          </span>
          <button
            type="button"
            disabled={
              Boolean(busyAction) ||
              !window.marchDesktop?.companion
            }
            onClick={togglePause}
          >
            {data.relationship.paused ? "恢复" : "暂停"}
          </button>
        </div>

        <section className="desktop-window-settings">
          <div>
            <Magnet weight="fill" />
            <span>
              <strong>桌面窗口</strong>
              <small>
                位置与大小自动保存，多显示器变化时保持可见
              </small>
            </span>
          </div>
          <label>
            <span>
              <strong>边缘吸附</strong>
              <small>拖动结束后贴近当前屏幕边缘</small>
            </span>
            <input
              type="checkbox"
              checked={desktopStatus?.snapEnabled ?? true}
              disabled={!window.marchDesktop}
              onChange={(event) =>
                void setSnapEnabled(event.target.checked)
              }
            />
          </label>
        </section>

        <label className="companion-setting-field">
          角色对你的称呼
          <input
            value={displayName}
            maxLength={24}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </label>

        <label className="companion-setting-toggle">
          <span>
            <strong>允许主动联系</strong>
            <small>关闭后只响应你的主动操作</small>
          </span>
          <input
            type="checkbox"
            checked={proactiveContactEnabled}
            onChange={(event) =>
              setProactiveContactEnabled(event.target.checked)
            }
          />
        </label>

        <section className="companion-setting-section">
          <span>允许接收的内容</span>
          <div className="companion-content-grid">
            {contentGroups.map((group) => {
              const enabled = group.types.every((type) =>
                allowedContentTypes.includes(type),
              );
              return (
                <label key={group.id}>
                  {group.label}
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(event) =>
                      toggleContentGroup(
                        group.types,
                        event.target.checked,
                      )
                    }
                  />
                </label>
              );
            })}
          </div>
        </section>

        <div className="companion-setting-time-grid">
          <label>
            每周主动上限
            <select
              value={weeklyContactLimit}
              onChange={(event) =>
                setWeeklyContactLimit(Number(event.target.value))
              }
            >
              {[0, 1, 2, 3, 4, 5, 6, 7].map((value) => (
                <option key={value} value={value}>
                  {value} 次
                </option>
              ))}
            </select>
          </label>
          <label>
            勿扰开始
            <input
              type="time"
              value={quietStart}
              onChange={(event) => setQuietStart(event.target.value)}
            />
          </label>
          <label>
            勿扰结束
            <input
              type="time"
              value={quietEnd}
              onChange={(event) => setQuietEnd(event.target.value)}
            />
          </label>
        </div>

        <div className="companion-setting-toggle-grid">
          <label>
            <span>
              <ShieldCheck weight="fill" />
              <strong>有限个性化</strong>
            </span>
            <input
              type="checkbox"
              checked={personalizationEnabled}
              onChange={(event) =>
                setPersonalizationEnabled(event.target.checked)
              }
            />
          </label>
          <label>
            <span>
              <Bell weight="fill" />
              <strong>长期记忆</strong>
            </span>
            <input
              type="checkbox"
              checked={memoryEnabled}
              onChange={(event) =>
                setMemoryEnabled(event.target.checked)
              }
            />
          </label>
          <label>
            <span>
              <BellSlash weight="fill" />
              <strong>低频召回</strong>
            </span>
            <input
              type="checkbox"
              checked={recallEnabled}
              onChange={(event) =>
                setRecallEnabled(event.target.checked)
              }
            />
          </label>
        </div>

        {notice && (
          <p
            className={`companion-settings-notice ${notice.kind}`}
            role="status"
          >
            {notice.text}
          </p>
        )}

        <button
          type="button"
          className="companion-save-settings"
          disabled={
            Boolean(busyAction) ||
            !displayName.trim() ||
            !window.marchDesktop?.companion
          }
          onClick={save}
        >
          {busyAction === "save" ? (
            <SpinnerGap className="spin" />
          ) : (
            <FloppyDisk weight="fill" />
          )}
          保存同行设置
        </button>

        <section className="companion-danger-zone">
          <strong>退出与数据</strong>
          <p>
            退出会保留记录；删除数据会清空关系、相册、通信和日志。
          </p>
          <div>
            <button
              type="button"
              disabled={
                Boolean(busyAction) ||
                !window.marchDesktop?.companion
              }
              onClick={() => void exportCompanionData()}
            >
              <DownloadSimple />
              导出全部
            </button>
            <button
              type="button"
              disabled={
                Boolean(busyAction) ||
                !window.marchDesktop?.companion
              }
              onClick={exitCompanion}
            >
              <SignOut />
              退出同行
            </button>
            <button
              type="button"
              disabled={
                Boolean(busyAction) ||
                !window.marchDesktop?.companion
              }
              onClick={deleteRelationshipData}
            >
              <Trash />
              删除关系数据
            </button>
          </div>
        </section>
      </div>
    </motion.section>
  );
}
