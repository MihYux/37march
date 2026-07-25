import { useState } from "react";
import { motion } from "motion/react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpenText,
  Camera,
  CheckCircle,
  Database,
  Footprints,
  MapTrifold,
  ShieldCheck,
  Sparkle,
  SpinnerGap,
} from "@phosphor-icons/react";
import type {
  CharacterMessageType,
  CompanionOnboardingInput,
} from "../domain/types";

interface CompanionOnboardingProps {
  onComplete: (input: CompanionOnboardingInput) => Promise<void>;
}

const defaultContentTypes: CharacterMessageType[] = [
  "daily",
  "photo",
  "postcard",
  "relationship",
  "version_preheat",
  "version_launch",
  "version_sustain",
];

const contentOptions: Array<{
  id: string;
  label: string;
  description: string;
  types: CharacterMessageType[];
}> = [
  {
    id: "daily",
    label: "日常陪伴",
    description: "轻量问候与关系内容",
    types: ["daily", "relationship"],
  },
  {
    id: "travel",
    label: "旅行记录",
    description: "照片与明信片",
    types: ["photo", "postcard"],
  },
  {
    id: "version",
    label: "版本事件",
    description: "经过审核的预热与上线内容",
    types: [
      "version_preheat",
      "version_launch",
      "version_sustain",
    ],
  },
];

const firstChoices: Array<{
  value: CompanionOnboardingInput["firstChoice"];
  label: string;
  description: string;
  icon: typeof Camera;
}> = [
  {
    value: "take_photos",
    label: "拍很多照片",
    description: "把沿途值得记住的瞬间都留下来",
    icon: Camera,
  },
  {
    value: "explore_places",
    label: "探索新地方",
    description: "一起去没见过的地方转一转",
    icon: MapTrifold,
  },
  {
    value: "hear_stories",
    label: "听新的故事",
    description: "慢慢认识旅途中遇到的人和事",
    icon: BookOpenText,
  },
  {
    value: "walk_slowly",
    label: "什么都不赶",
    description: "不用完成任务，只是一起慢慢走",
    icon: Footprints,
  },
];

export function CompanionOnboarding({
  onComplete,
}: CompanionOnboardingProps) {
  const [step, setStep] = useState(0);
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [displayName, setDisplayName] = useState("演示玩家");
  const [proactiveContactEnabled, setProactiveContactEnabled] =
    useState(true);
  const [allowedContentTypes, setAllowedContentTypes] = useState<
    CharacterMessageType[]
  >(defaultContentTypes);
  const [recallEnabled, setRecallEnabled] = useState(false);
  const [personalizationEnabled, setPersonalizationEnabled] =
    useState(true);
  const [memoryEnabled, setMemoryEnabled] = useState(true);
  const [quietStart, setQuietStart] = useState("22:00");
  const [quietEnd, setQuietEnd] = useState("09:00");
  const [weeklyContactLimit, setWeeklyContactLimit] = useState(2);
  const [firstChoice, setFirstChoice] =
    useState<CompanionOnboardingInput["firstChoice"]>(
      "take_photos",
    );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

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

  const finish = async () => {
    setSubmitting(true);
    setError("");
    try {
      await onComplete({
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
        consentAccepted: true,
        firstChoice,
      });
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "第一次同行没有保存成功，请稍后重试。",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <motion.section
      className="companion-onboarding"
      role="dialog"
      aria-modal="true"
      aria-label="开始角色同行计划"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.24 }}
    >
      <div className="onboarding-progress" aria-label="首次进入进度">
        {[0, 1, 2, 3].map((index) => (
          <span
            key={index}
            className={index <= step ? "active" : ""}
          />
        ))}
      </div>

      <div className="onboarding-content">
        {step === 0 && (
          <div className="onboarding-step onboarding-welcome">
            <div className="onboarding-hero-icon">
              <Sparkle weight="fill" />
            </div>
            <span className="eyebrow">REHOYO · 角色同行计划</span>
            <h1>让喜欢的角色，陪你走过每一次旅程。</h1>
            <p>
              这是一个本地运行的概念体验。你选择三月七后，
              她会通过桌宠、共同相册和通信中心进行低打扰陪伴。
            </p>

            <div className="onboarding-disclosure-grid">
              <article>
                <ShieldCheck weight="duotone" />
                <strong>由你主动选择</strong>
                <span>联系、记忆、版本内容和召回都能关闭</span>
              </article>
              <article>
                <Database weight="duotone" />
                <strong>当前只用模拟数据</strong>
                <span>不接入真实游戏账号、行为或消费数据</span>
              </article>
            </div>

            <div className="onboarding-ai-note">
              <strong>AI 与第三方服务说明</strong>
              <p>
                在线聊天启用后，输入会发送给 DeepSeek；
                语音启用后，要朗读的文本会发送给 DashScope。
                这些能力默认不会替你做版本事实判断，也不会把普通聊天自动保存为长期记忆。
              </p>
            </div>

            <label className="onboarding-consent">
              <input
                autoFocus
                type="checkbox"
                checked={consentAccepted}
                onChange={(event) =>
                  setConsentAccepted(event.target.checked)
                }
              />
              <span>
                我理解这是概念体验，并愿意继续设置模拟角色同行。
              </span>
            </label>
          </div>
        )}

        {step === 1 && (
          <div className="onboarding-step onboarding-character">
            <span className="eyebrow">选择同行角色 · MVP</span>
            <h1>这一次，和三月七同行</h1>
            <div className="onboarding-character-card">
              <div>
                <img
                  src="./assets/march7th-pet.png"
                  alt="手持相机、挥手打招呼的三月七 Q 版桌宠"
                  draggable={false}
                />
              </div>
              <section>
                <span>星穹列车乘员</span>
                <h2>三月七</h2>
                <p>
                  活泼、亲近，喜欢拍照和记录新的回忆。
                  真正重要的时候，她也会认真地陪在同伴身边。
                </p>
              </section>
            </div>

            <div className="onboarding-boundaries">
              <article>
                <strong>她可能会做</strong>
                <ul>
                  <li>在桌面提供低打扰陪伴</li>
                  <li>和你保存明确确认的共同记忆</li>
                  <li>发送日常、旅行和获批版本消息</li>
                </ul>
              </article>
              <article>
                <strong>她不会做</strong>
                <ul>
                  <li>擅自读取真实账号或消费数据</li>
                  <li>未经确认永久保存普通聊天</li>
                  <li>承担客服、心理咨询或效率助手职责</li>
                </ul>
              </article>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="onboarding-step onboarding-preferences">
            <span className="eyebrow">授权与偏好</span>
            <h1>你希望怎样被联系？</h1>
            <p className="onboarding-step-note">
              这些设置之后都能更改。版本任务不能覆盖你的选择。
            </p>

            <label className="onboarding-name-field">
              希望角色怎样称呼你
              <input
                value={displayName}
                maxLength={24}
                onChange={(event) =>
                  setDisplayName(event.target.value)
                }
              />
            </label>

            <label className="onboarding-toggle-row">
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

            <div className="onboarding-content-types">
              <span>允许的内容</span>
              {contentOptions.map((option) => {
                const enabled = option.types.every((type) =>
                  allowedContentTypes.includes(type),
                );
                return (
                  <label key={option.id}>
                    <span>
                      <strong>{option.label}</strong>
                      <small>{option.description}</small>
                    </span>
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={(event) =>
                        toggleContentGroup(
                          option.types,
                          event.target.checked,
                        )
                      }
                    />
                  </label>
                );
              })}
            </div>

            <div className="onboarding-compact-grid">
              <label>
                <span>每周主动消息上限</span>
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
                <span>勿扰开始</span>
                <input
                  type="time"
                  value={quietStart}
                  onChange={(event) =>
                    setQuietStart(event.target.value)
                  }
                />
              </label>
              <label>
                <span>勿扰结束</span>
                <input
                  type="time"
                  value={quietEnd}
                  onChange={(event) =>
                    setQuietEnd(event.target.value)
                  }
                />
              </label>
            </div>

            <div className="onboarding-toggle-grid">
              <label>
                <span>
                  <strong>有限个性化</strong>
                  <small>只使用明确允许的偏好</small>
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
                  <strong>长期记忆</strong>
                  <small>可随时查看、关闭和删除</small>
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
                  <strong>低频召回</strong>
                  <small>默认关闭，需要单独同意</small>
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
          </div>
        )}

        {step === 3 && (
          <div className="onboarding-step onboarding-first-choice">
            <span className="eyebrow">建立第一次共同记忆</span>
            <h1>如果下一次一起旅行，你最想做什么？</h1>
            <p className="onboarding-step-note">
              {memoryEnabled
                ? "完成后，这个选择会成为第一条可管理的共同记忆。"
                : "你关闭了长期记忆，这个选择只用于首次回应，不会写入相册。"}
            </p>

            <div className="first-choice-grid">
              {firstChoices.map((choice) => {
                const Icon = choice.icon;
                const selected = firstChoice === choice.value;
                return (
                  <button
                    key={choice.value}
                    type="button"
                    className={selected ? "selected" : ""}
                    aria-pressed={selected}
                    onClick={() => setFirstChoice(choice.value)}
                  >
                    <Icon weight={selected ? "fill" : "duotone"} />
                    <span>
                      <strong>{choice.label}</strong>
                      <small>{choice.description}</small>
                    </span>
                    {selected && <CheckCircle weight="fill" />}
                  </button>
                );
              })}
            </div>

            <div className="onboarding-summary">
              <ShieldCheck weight="fill" />
              <p>
                主动联系每周最多 {weeklyContactLimit} 次，勿扰时间
                {" "}
                {quietStart}～{quietEnd}，召回
                {recallEnabled ? "已单独开启" : "保持关闭"}。
              </p>
            </div>
          </div>
        )}
      </div>

      {error && (
        <p className="onboarding-error" role="alert">
          {error}
        </p>
      )}

      <footer className="onboarding-actions">
        {step > 0 ? (
          <button
            type="button"
            className="onboarding-back"
            disabled={submitting}
            onClick={() => setStep((current) => current - 1)}
          >
            <ArrowLeft />
            上一步
          </button>
        ) : (
          <span />
        )}

        {step < 3 ? (
          <button
            type="button"
            className="onboarding-next"
            disabled={
              (step === 0 && !consentAccepted) ||
              (step === 2 && !displayName.trim())
            }
            onClick={() => setStep((current) => current + 1)}
          >
            继续
            <ArrowRight />
          </button>
        ) : (
          <button
            type="button"
            className="onboarding-next"
            disabled={submitting}
            onClick={() => void finish()}
          >
            {submitting ? (
              <SpinnerGap className="spin" />
            ) : (
              <Sparkle weight="fill" />
            )}
            开始同行
          </button>
        )}
      </footer>
    </motion.section>
  );
}
