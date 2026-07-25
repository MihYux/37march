import { useMemo, useState } from "react";
import { motion } from "motion/react";
import {
  CheckCircle,
  DownloadSimple,
  ImageSquare,
  ImagesSquare,
  ShieldCheck,
  ShieldSlash,
  SpinnerGap,
  Trash,
  X,
} from "@phosphor-icons/react";
import type {
  CompanionData,
  MemoryRecord,
  MemoryType,
} from "../domain/types";

type MemoryFilter = "all" | MemoryType;

interface AlbumPanelProps {
  data: CompanionData;
  onClose: () => void;
  onDataChange: (data: CompanionData) => void;
}

const filterLabels: Array<{
  value: MemoryFilter;
  label: string;
}> = [
  { value: "all", label: "全部" },
  { value: "choice", label: "选择" },
  { value: "photo", label: "照片" },
  { value: "postcard", label: "明信片" },
  { value: "milestone", label: "节点" },
  { value: "version", label: "版本" },
  { value: "return", label: "回归" },
];

const memoryTypeLabels: Record<MemoryType, string> = {
  choice: "共同选择",
  photo: "旅行照片",
  postcard: "旅行明信片",
  milestone: "关系节点",
  version: "版本事件",
  return: "再次同行",
};

function formatMemoryDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function MemoryCard({
  memory,
  memoryEnabled,
  busy,
  onToggleReusable,
  onToggleCampaignReusable,
  onDelete,
}: {
  memory: MemoryRecord;
  memoryEnabled: boolean;
  busy: boolean;
  onToggleReusable: (memory: MemoryRecord) => void;
  onToggleCampaignReusable: (memory: MemoryRecord) => void;
  onDelete: (memory: MemoryRecord) => void;
}) {
  return (
    <article className="memory-card">
      <div className="memory-visual" aria-hidden="true">
        {memory.visual ? (
          <img
            src="./assets/march7th-pet.png"
            alt=""
            draggable={false}
          />
        ) : (
          <ImageSquare weight="duotone" />
        )}
        <span>{memoryTypeLabels[memory.type]}</span>
      </div>

      <div className="memory-card-content">
        <div className="memory-card-meta">
          <time dateTime={memory.createdAt}>
            {formatMemoryDate(memory.createdAt)}
          </time>
          {memory.userConfirmed && (
            <span className="confirmed-memory">
              <CheckCircle weight="fill" />
              已确认保存
            </span>
          )}
        </div>
        <h3>{memory.title}</h3>
        <p>{memory.summary}</p>
        <blockquote>{memory.characterText}</blockquote>

        <div className="memory-card-actions">
          <button
            type="button"
            className={`memory-reference-toggle ${
              memory.reusableByCharacter && memoryEnabled
                ? "active"
                : ""
            }`}
            aria-pressed={
              memory.reusableByCharacter && memoryEnabled
            }
            disabled={busy || !memoryEnabled}
            title={
              !memoryEnabled
                ? "长期记忆已关闭"
                : memory.reusableByCharacter
                  ? "禁止三月七未来引用"
                  : "允许三月七未来引用"
            }
            onClick={() => onToggleReusable(memory)}
          >
            {memory.reusableByCharacter && memoryEnabled ? (
              <ShieldCheck weight="fill" />
            ) : (
              <ShieldSlash />
            )}
            {memory.reusableByCharacter && memoryEnabled
              ? "可在未来引用"
              : "不会用于未来对话"}
          </button>
          <button
            type="button"
            className={`memory-reference-toggle ${memory.campaignReusable ? "active" : ""}`}
            aria-pressed={memory.campaignReusable === true}
            disabled={
              busy ||
              !memoryEnabled ||
              !memory.reusableByCharacter ||
              !memory.userConfirmed
            }
            title="单独控制发行内容是否可以自然引用这条记忆"
            onClick={() => onToggleCampaignReusable(memory)}
          >
            {memory.campaignReusable ? (
              <ShieldCheck weight="fill" />
            ) : (
              <ShieldSlash />
            )}
            {memory.campaignReusable
              ? "可用于版本衔接"
              : "不用于发行内容"}
          </button>
          <button
            type="button"
            className="memory-delete-button"
            aria-label={`删除记忆：${memory.title}`}
            title="删除这条记忆"
            disabled={busy}
            onClick={() => onDelete(memory)}
          >
            <Trash />
          </button>
        </div>
      </div>
    </article>
  );
}

export function AlbumPanel({
  data,
  onClose,
  onDataChange,
}: AlbumPanelProps) {
  const [filter, setFilter] = useState<MemoryFilter>("all");
  const [busyAction, setBusyAction] = useState("");
  const [notice, setNotice] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);

  const memories = useMemo(() => {
    const confirmedMemories = data.memories.filter(
      (memory) =>
        (memory.sourceType === "photo" || memory.type === "photo") &&
        (memory.status === "confirmed" ||
          (memory.status === undefined && memory.userConfirmed)),
    );
    const filtered =
      filter === "all"
        ? confirmedMemories
        : confirmedMemories.filter((memory) => memory.type === filter);
    return [...filtered].sort(
      (left, right) =>
        Date.parse(right.createdAt) - Date.parse(left.createdAt),
    );
  }, [data.memories, filter]);

  const runMutation = async (
    action: string,
    mutation: () => Promise<CompanionData>,
    successText: string,
  ) => {
    setBusyAction(action);
    setNotice(null);
    try {
      const nextData = await mutation();
      onDataChange(nextData);
      setNotice({
        kind: "success",
        text: successText,
      });
    } catch (error) {
      setNotice({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : "相册操作没有完成，请稍后重试。",
      });
    } finally {
      setBusyAction("");
    }
  };

  const toggleMemoryEnabled = () => {
    const api = window.marchDesktop?.companion;
    if (!api) return;
    const enabled = !data.profile.memoryEnabled;
    void runMutation(
      "memory-enabled",
      () => api.setMemoryEnabled(enabled),
      enabled
        ? "长期记忆已开启。"
        : "长期记忆已关闭，现有记录仍保留但不会被引用。",
    );
  };

  const toggleReusable = (memory: MemoryRecord) => {
    const api = window.marchDesktop?.companion;
    if (!api) return;
    const reusable = !memory.reusableByCharacter;
    void runMutation(
      `reuse-${memory.id}`,
      () => api.setMemoryReusable(memory.id, reusable),
      reusable
        ? "三月七以后可以在合适的时候引用这段记忆。"
        : "这段记忆以后不会再被角色引用。",
    );
  };

  const toggleCampaignReusable = (memory: MemoryRecord) => {
    const api = window.marchDesktop?.companion;
    if (!api) return;
    const reusable = !memory.campaignReusable;
    void runMutation(
      `campaign-reuse-${memory.id}`,
      () => api.setMemoryCampaignReusable(memory.id, reusable),
      reusable
        ? "版本内容可以在自然相关时引用这段记忆。"
        : "版本内容不会再引用这段记忆。",
    );
  };

  const deleteMemory = (memory: MemoryRecord) => {
    const api = window.marchDesktop?.companion;
    if (!api) return;
    const confirmed = window.confirm(
      `确定删除“${memory.title}”吗？\n\n删除后，这条记忆及通信消息中的可识别引用会被移除。此操作无法撤销。`,
    );
    if (!confirmed) return;

    void runMutation(
      `delete-${memory.id}`,
      () => api.deleteMemory(memory.id),
      "这段共同记忆已经删除。",
    );
  };

  const exportMemories = async () => {
    const api = window.marchDesktop?.companion;
    if (!api) return;
    setBusyAction("export");
    setNotice(null);
    try {
      const result = await api.exportMemories();
      if (result.ok) {
        setNotice({
          kind: "success",
          text: "模拟记忆 JSON 已导出到你选择的位置。",
        });
      }
    } catch (error) {
      setNotice({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : "导出没有完成，请稍后重试。",
      });
    } finally {
      setBusyAction("");
    }
  };

  return (
    <motion.section
      className="album-panel"
      role="dialog"
      aria-modal="true"
      aria-label="共同旅行相册"
      initial={{ opacity: 0, y: 20, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 16, scale: 0.98 }}
      transition={{ type: "spring", stiffness: 340, damping: 30 }}
    >
      <header className="album-header">
        <div>
          <span className="eyebrow">OUR JOURNEY · 模拟数据</span>
          <h2>共同旅行相册</h2>
          <p>
            {data.memories.filter((memory) => memory.sourceType === "photo" || memory.type === "photo").length} 段共同记忆 ·
            这里只展示你主动拍下并保存的照片记忆
          </p>
        </div>
        <button
          type="button"
          className="album-close"
          autoFocus
          aria-label="关闭共同旅行相册"
          title="关闭相册"
          onClick={onClose}
        >
          <X weight="bold" />
        </button>
      </header>

      <div className="album-privacy-bar">
        <div>
          {data.profile.memoryEnabled ? (
            <ShieldCheck weight="fill" />
          ) : (
            <ShieldSlash />
          )}
          <span>
            <strong>
              {data.profile.memoryEnabled
                ? "长期记忆已开启"
                : "长期记忆已关闭"}
            </strong>
            <small>
              {data.profile.memoryEnabled
                ? "仍可单独关闭每条记忆的未来引用"
                : "现有记录保留，但不会提供给角色或模型"}
            </small>
          </span>
        </div>
        <button
          type="button"
          aria-pressed={data.profile.memoryEnabled}
          disabled={Boolean(busyAction)}
          onClick={toggleMemoryEnabled}
        >
          {busyAction === "memory-enabled" ? (
            <SpinnerGap className="spin" />
          ) : data.profile.memoryEnabled ? (
            "关闭"
          ) : (
            "开启"
          )}
        </button>
      </div>

      <nav className="album-filters" aria-label="筛选记忆类型">
        {filterLabels.map((item) => (
          <button
            key={item.value}
            type="button"
            className={filter === item.value ? "active" : ""}
            aria-pressed={filter === item.value}
            onClick={() => setFilter(item.value)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div className="album-memory-list">
        {memories.length ? (
          memories.map((memory) => (
            <MemoryCard
              key={memory.id}
              memory={memory}
              memoryEnabled={data.profile.memoryEnabled}
              busy={Boolean(busyAction)}
              onToggleReusable={toggleReusable}
              onToggleCampaignReusable={toggleCampaignReusable}
              onDelete={deleteMemory}
            />
          ))
        ) : (
          <div className="album-empty">
            <ImagesSquare weight="duotone" />
            <strong>
              {data.memories.filter((memory) => memory.sourceType === "photo" || memory.type === "photo").length
                ? "这个分类还没有共同记忆"
                : "相册还是空的"}
            </strong>
            <p>
              回到桌宠后点击“拍照”，再明确选择“收进相册”，
              就能保存一段新的模拟记忆。
            </p>
          </div>
        )}
      </div>

      {notice && (
        <p className={`album-notice ${notice.kind}`} role="status">
          {notice.text}
        </p>
      )}

      <footer className="album-footer">
        <button
          type="button"
          className="album-export-button"
          disabled={Boolean(busyAction) || !window.marchDesktop?.companion}
          onClick={() => void exportMemories()}
        >
          {busyAction === "export" ? (
            <SpinnerGap className="spin" />
          ) : (
            <DownloadSimple />
          )}
          导出记忆 JSON
        </button>
      </footer>
    </motion.section>
  );
}
