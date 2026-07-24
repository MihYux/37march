import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import {
  BellSlash,
  BookOpenText,
  Clock,
  Envelope,
  EnvelopeOpen,
  Heart,
  Info,
  SlidersHorizontal,
  SpinnerGap,
  Star,
  ThumbsDown,
  X,
} from "@phosphor-icons/react";
import type {
  CharacterMessage,
  CharacterMessageType,
  CompanionData,
} from "../domain/types";
import { selectDeliverableMessages } from "../domain/messages";

type MessageFilter =
  | "all"
  | "daily"
  | "travel"
  | "version"
  | "favorite";

type FixedResponse =
  | "like"
  | "later"
  | "not_interested"
  | "lower_frequency"
  | "unsubscribe_type";

interface CommunicationCenterProps {
  data: CompanionData;
  onClose: () => void;
  onDataChange: (data: CompanionData) => void;
  onOpenAlbum: (targetId?: string) => void;
}

const filterLabels: Array<{
  value: MessageFilter;
  label: string;
}> = [
  { value: "all", label: "全部" },
  { value: "daily", label: "日常" },
  { value: "travel", label: "旅行" },
  { value: "version", label: "版本" },
  { value: "favorite", label: "收藏" },
];

const messageTypeLabels: Record<CharacterMessageType, string> = {
  daily: "日常",
  photo: "照片",
  postcard: "明信片",
  relationship: "关系",
  version_preheat: "版本预热",
  version_launch: "版本上线",
  version_sustain: "版本持续",
  recall: "低频召回",
};

const responseLabels: Record<FixedResponse, string> = {
  like: "喜欢",
  later: "稍后再看",
  not_interested: "不感兴趣",
  lower_frequency: "降低频率",
  unsubscribe_type: "不再接收此类",
};

function formatMessageDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function matchesFilter(
  message: CharacterMessage,
  filter: MessageFilter,
) {
  if (filter === "all") return true;
  if (filter === "daily") return message.type === "daily";
  if (filter === "favorite") return message.favorite;
  if (filter === "travel") {
    return ["photo", "postcard", "relationship"].includes(
      message.type,
    );
  }
  return [
    "version_preheat",
    "version_launch",
    "version_sustain",
    "recall",
  ].includes(message.type);
}

export function CommunicationCenter({
  data,
  onClose,
  onDataChange,
  onOpenAlbum,
}: CommunicationCenterProps) {
  const deliverableMessages = useMemo(
    () => selectDeliverableMessages(data.messages),
    [data.messages],
  );
  const [filter, setFilter] = useState<MessageFilter>("all");
  const [selectedId, setSelectedId] = useState(
    deliverableMessages[0]?.id ?? "",
  );
  const [busyAction, setBusyAction] = useState("");
  const [notice, setNotice] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);

  const filteredMessages = useMemo(
    () =>
      deliverableMessages.filter((message) =>
        matchesFilter(message, filter),
      ),
    [deliverableMessages, filter],
  );
  const selectedMessage =
    deliverableMessages.find(
      (message) => message.id === selectedId,
    ) ??
    filteredMessages[0] ??
    null;

  useEffect(() => {
    if (
      selectedMessage &&
      !filteredMessages.some(
        (message) => message.id === selectedMessage.id,
      )
    ) {
      setSelectedId(filteredMessages[0]?.id ?? "");
    }
  }, [filteredMessages, selectedMessage]);

  useEffect(() => {
    const api = window.marchDesktop?.companion;
    if (!api || !selectedMessage || selectedMessage.readAt) return;

    let active = true;
    setBusyAction(`read-${selectedMessage.id}`);
    void api
      .markMessageRead(selectedMessage.id)
      .then((nextData) => {
        if (active) onDataChange(nextData);
      })
      .catch(() => {
        if (active) {
          setNotice({
            kind: "error",
            text: "未读状态暂时没有保存，消息内容仍可正常查看。",
          });
        }
      })
      .finally(() => {
        if (active) setBusyAction("");
      });
    return () => {
      active = false;
    };
  }, [onDataChange, selectedMessage]);

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
            : "通信操作没有完成，请稍后重试。",
      });
    } finally {
      setBusyAction("");
    }
  };

  const toggleFavorite = () => {
    const api = window.marchDesktop?.companion;
    if (!api || !selectedMessage) return;
    const favorite = !selectedMessage.favorite;
    void runMutation(
      `favorite-${selectedMessage.id}`,
      () =>
        api.setMessageFavorite(selectedMessage.id, favorite),
      favorite ? "已经收藏这条通信。" : "已经取消收藏。",
    );
  };

  const toggleLike = () => {
    const api = window.marchDesktop?.companion;
    if (!api || !selectedMessage) return;
    const liked = !selectedMessage.liked;
    void runMutation(
      `like-${selectedMessage.id}`,
      () => api.setMessageLiked(selectedMessage.id, liked),
      liked
        ? "三月七会知道你喜欢这条内容。"
        : "已经取消喜欢。",
    );
  };

  const toggleLater = () => {
    const api = window.marchDesktop?.companion;
    if (!api || !selectedMessage) return;
    const remindLater = !selectedMessage.remindLater;
    void runMutation(
      `later-${selectedMessage.id}`,
      () =>
        api.setMessageRemindLater(
          selectedMessage.id,
          remindLater,
        ),
      remindLater ? "已经标记为稍后再看。" : "已取消稍后再看。",
    );
  };

  const respond = (response: FixedResponse) => {
    const api = window.marchDesktop?.companion;
    if (!api || !selectedMessage) return;
    const destructive = [
      "not_interested",
      "unsubscribe_type",
    ].includes(response);
    if (
      destructive &&
      !window.confirm(
        response === "unsubscribe_type"
          ? `确定不再接收“${messageTypeLabels[selectedMessage.type]}”类型的角色通信吗？你以后可以在关系设置中重新开启。`
          : "确定对这条内容选择“不感兴趣”吗？对应版本内容将停止继续联系。",
      )
    ) {
      return;
    }

    void runMutation(
      `response-${response}-${selectedMessage.id}`,
      () =>
        api.respondToMessage(selectedMessage.id, response),
      response === "lower_frequency"
        ? "已记录：以后降低此类内容的联系频率。"
        : response === "unsubscribe_type"
          ? "已退订此类角色通信。"
          : response === "not_interested"
            ? "已记录不感兴趣，并停止对应版本内容的后续联系。"
            : `已选择“${responseLabels[response]}”。`,
    );
  };

  const activateMessageAction = () => {
    if (!selectedMessage?.action) return;
    if (selectedMessage.action.kind === "open_album") {
      onOpenAlbum(selectedMessage.action.targetId);
    }
  };

  const unreadCount = deliverableMessages.filter(
    (message) => !message.readAt,
  ).length;

  return (
    <motion.section
      className="communication-panel"
      role="dialog"
      aria-modal="true"
      aria-label="角色通信中心"
      initial={{ opacity: 0, y: 20, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 16, scale: 0.98 }}
      transition={{ type: "spring", stiffness: 340, damping: 30 }}
    >
      <header className="communication-header">
        <div>
          <span className="eyebrow">MARCH 7TH MAIL · 模拟数据</span>
          <h2>角色通信中心</h2>
          <p>
            {deliverableMessages.length} 条已审核通信
            {unreadCount > 0 && ` · ${unreadCount} 条未读`}
          </p>
        </div>
        <button
          type="button"
          className="communication-close"
          autoFocus
          aria-label="关闭角色通信中心"
          title="关闭通信中心"
          onClick={onClose}
        >
          <X weight="bold" />
        </button>
      </header>

      <nav
        className="communication-filters"
        aria-label="筛选通信类型"
      >
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

      <div className="communication-body">
        <aside
          className="communication-list"
          aria-label="角色消息列表"
        >
          {filteredMessages.length ? (
            filteredMessages.map((message) => (
              <button
                key={message.id}
                type="button"
                className={`communication-list-item ${
                  selectedMessage?.id === message.id ? "active" : ""
                } ${message.readAt ? "" : "unread"}`}
                aria-pressed={selectedMessage?.id === message.id}
                onClick={() => setSelectedId(message.id)}
              >
                <span className="communication-list-meta">
                  {message.readAt ? (
                    <EnvelopeOpen />
                  ) : (
                    <Envelope weight="fill" />
                  )}
                  {messageTypeLabels[message.type]}
                  {message.favorite && <Star weight="fill" />}
                </span>
                <strong>{message.title}</strong>
                <time dateTime={message.createdAt}>
                  {formatMessageDate(message.createdAt)}
                </time>
              </button>
            ))
          ) : (
            <div className="communication-list-empty">
              <EnvelopeOpen weight="duotone" />
              <span>这里暂时没有消息</span>
            </div>
          )}
        </aside>

        <article className="communication-detail">
          {selectedMessage ? (
            <>
              <div className="communication-detail-meta">
                <span>{messageTypeLabels[selectedMessage.type]}</span>
                <time dateTime={selectedMessage.createdAt}>
                  {formatMessageDate(selectedMessage.createdAt)}
                </time>
              </div>
              <h3>{selectedMessage.title}</h3>
              <p className="communication-message-body">
                {selectedMessage.body}
              </p>

              {selectedMessage.action?.kind === "open_album" && (
                  <button
                    type="button"
                    className="communication-primary-action"
                    onClick={activateMessageAction}
                  >
                    <BookOpenText weight="fill" />
                    {selectedMessage.action.label}
                  </button>
                )}

              <div className="communication-reactions">
                <button
                  type="button"
                  className={selectedMessage.liked ? "active" : ""}
                  aria-pressed={selectedMessage.liked}
                  disabled={Boolean(busyAction)}
                  onClick={toggleLike}
                >
                  <Heart
                    weight={
                      selectedMessage.liked ? "fill" : "regular"
                    }
                  />
                  喜欢
                </button>
                <button
                  type="button"
                  className={
                    selectedMessage.favorite ? "active" : ""
                  }
                  aria-pressed={selectedMessage.favorite}
                  disabled={Boolean(busyAction)}
                  onClick={toggleFavorite}
                >
                  <Star
                    weight={
                      selectedMessage.favorite
                        ? "fill"
                        : "regular"
                    }
                  />
                  收藏
                </button>
                <button
                  type="button"
                  className={
                    selectedMessage.remindLater ? "active" : ""
                  }
                  aria-pressed={selectedMessage.remindLater}
                  disabled={Boolean(busyAction)}
                  onClick={toggleLater}
                >
                  <Clock
                    weight={
                      selectedMessage.remindLater
                        ? "fill"
                        : "regular"
                    }
                  />
                  稍后
                </button>
              </div>

              <div className="communication-response-block">
                <span>固定回复与内容偏好</span>
                <div>
                  <button
                    type="button"
                    disabled={Boolean(busyAction)}
                    onClick={() => respond("not_interested")}
                  >
                    <ThumbsDown />
                    不感兴趣
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(busyAction)}
                    onClick={() => respond("lower_frequency")}
                  >
                    <SlidersHorizontal />
                    降低频率
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(busyAction)}
                    onClick={() => respond("unsubscribe_type")}
                  >
                    <BellSlash />
                    不再接收此类
                  </button>
                </div>
              </div>

              <details className="communication-trace">
                <summary>
                  <Info />
                  查看内容来源与审核记录
                </summary>
                <dl>
                  <div>
                    <dt>审核</dt>
                    <dd>{selectedMessage.reviewStatus}</dd>
                  </div>
                  <div>
                    <dt>Skill</dt>
                    <dd>{selectedMessage.trace.skillVersion}</dd>
                  </div>
                  <div>
                    <dt>模板</dt>
                    <dd>{selectedMessage.trace.templateId}</dd>
                  </div>
                  <div>
                    <dt>规则</dt>
                    <dd>
                      {selectedMessage.trace.ruleIds.join("、") || "无"}
                    </dd>
                  </div>
                  <div>
                    <dt>记忆</dt>
                    <dd>
                      {selectedMessage.trace.memoryIds.join("、") ||
                        "未引用"}
                    </dd>
                  </div>
                  <div>
                    <dt>固定事实</dt>
                    <dd>
                      {selectedMessage.trace.fixedFactIds.join("、") ||
                        "未使用"}
                    </dd>
                  </div>
                </dl>
              </details>
            </>
          ) : (
            <div className="communication-detail-empty">
              <EnvelopeOpen weight="duotone" />
              <strong>选择一条通信查看详情</strong>
            </div>
          )}
        </article>
      </div>

      {busyAction && (
        <div className="communication-busy" aria-live="polite">
          <SpinnerGap className="spin" />
          正在保存你的选择…
        </div>
      )}
      {notice && (
        <p
          className={`communication-notice ${notice.kind}`}
          role="status"
        >
          {notice.text}
        </p>
      )}

      <footer className="communication-footer">
        只显示已通过审核并进入本地沙盒的消息。聊天内容不会自动出现在这里。
      </footer>
    </motion.section>
  );
}
