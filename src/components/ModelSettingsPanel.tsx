import { useEffect, useState } from "react";
import { motion } from "motion/react";
import {
  ArrowLeft,
  ArrowsOutSimple,
  CheckCircle,
  Key,
  LockKey,
  ShieldCheck,
  SpinnerGap,
  Trash,
  WarningCircle,
} from "@phosphor-icons/react";
import type {
  AiPublicSettings,
  DeepSeekModel,
  ServiceUsageStatus,
  TtsPublicSettings,
} from "../ai/types";
import { VoiceSettingsSection } from "./VoiceSettingsSection";
import petWindowConfig from "../../shared/pet-window-config.json";

interface ModelSettingsPanelProps {
  onClose: () => void;
  onReadyChange: (ready: boolean) => void;
  onTtsSettingsChange: (settings: TtsPublicSettings) => void;
  petDefaultScale: number;
  petMaxScale: number;
  onPetDefaultScaleChange: (scale: number) => Promise<void>;
}

const fallbackSettings: AiPublicSettings = {
  provider: "deepseek",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-v4-flash",
  thinking: false,
  hasApiKey: false,
  keySource: "none",
  secureStorageAvailable: false,
};

export function ModelSettingsPanel({
  onClose,
  onReadyChange,
  onTtsSettingsChange,
  petDefaultScale,
  petMaxScale,
  onPetDefaultScaleChange,
}: ModelSettingsPanelProps) {
  const [settings, setSettings] =
    useState<AiPublicSettings>(fallbackSettings);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [usageStatus, setUsageStatus] =
    useState<ServiceUsageStatus | null>(null);
  const [notice, setNotice] = useState<{
    kind: "success" | "error" | "neutral";
    text: string;
  }>({ kind: "neutral", text: "填写 API Key 后保存并测试连接" });

  const desktopApi = window.marchDesktop?.ai;
  const serviceApi = window.marchDesktop?.service;

  useEffect(() => {
    if (!desktopApi) {
      setNotice({
        kind: "neutral",
        text: "模型与对话设置只在 Electron 桌面应用中可用",
      });
      return;
    }

    desktopApi
      .getSettings()
      .then((nextSettings) => {
        setSettings(nextSettings);
        onReadyChange(nextSettings.hasApiKey);
        if (nextSettings.hasApiKey) {
          setNotice({
            kind: "neutral",
            text:
              nextSettings.keySource === "environment"
                ? "正在使用 DEEPSEEK_API_KEY 环境变量"
                : "API Key 已配置，可以测试连接",
          });
        }
      })
      .catch(() => {
        setNotice({ kind: "error", text: "读取模型与对话设置失败" });
      });
  }, [desktopApi, onReadyChange]);

  useEffect(() => {
    serviceApi
      ?.getUsageStatus()
      .then(setUsageStatus)
      .catch(() => setUsageStatus(null));
  }, [serviceApi]);

  const updateModel = (model: DeepSeekModel) => {
    setSettings((current) => ({ ...current, model }));
  };

  const saveAndTest = async () => {
    if (!desktopApi) return;
    if (!settings.hasApiKey && !apiKey.trim()) {
      setNotice({ kind: "error", text: "请先填写 DeepSeek API Key" });
      return;
    }

    setBusy(true);
    setNotice({ kind: "neutral", text: "正在保存并测试连接…" });
    try {
      const nextSettings = await desktopApi.saveSettings({
        model: settings.model,
        thinking: settings.thinking,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      });
      setSettings(nextSettings);
      setApiKey("");
      onReadyChange(nextSettings.hasApiKey);

      const result = await desktopApi.testConnection();
      void serviceApi
        ?.getUsageStatus()
        .then(setUsageStatus)
        .catch(() => {});
      if (result.ok) {
        setNotice({
          kind: "success",
          text: `连接成功 · ${result.model}`,
        });
      } else {
        setNotice({ kind: "error", text: result.error });
      }
    } catch {
      setNotice({ kind: "error", text: "保存模型与对话设置失败" });
    } finally {
      setBusy(false);
    }
  };

  const clearKey = async () => {
    if (!desktopApi || !settings.hasApiKey) return;
    setBusy(true);
    try {
      const nextSettings = await desktopApi.clearApiKey();
      setSettings(nextSettings);
      setApiKey("");
      onReadyChange(false);
      setNotice({ kind: "neutral", text: "已清除保存的 API Key" });
    } catch {
      setNotice({ kind: "error", text: "清除 API Key 失败" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.section
      className="settings-panel"
      role="dialog"
      aria-modal="true"
      aria-label="设置"
      initial={{ opacity: 0, y: 22, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 18, scale: 0.97 }}
      transition={{ type: "spring", stiffness: 360, damping: 28 }}
    >
      <header className="settings-header">
        <button
          type="button"
          className="settings-close"
          autoFocus
          aria-label="返回桌宠"
          title="返回"
          onClick={onClose}
        >
          <ArrowLeft weight="bold" />
        </button>
        <div>
          <span className="eyebrow">DESKTOP SETTINGS</span>
          <h2>设置</h2>
        </div>
      </header>

      <section className="default-scale-setting">
        <header>
          <ArrowsOutSimple weight="bold" />
          <span>
            <strong>默认桌宠大小</strong>
            <small>调整后立即生效，并作为下次启动的默认大小</small>
          </span>
          <output>
            {Math.round(
              (petDefaultScale / petWindowConfig.defaultScale) * 100,
            )}
            %
          </output>
        </header>
        <input
          type="range"
          min={
            petWindowConfig.defaultScale *
            petWindowConfig.minMultiplier
          }
          max={petMaxScale}
          step="0.025"
          value={petDefaultScale}
          aria-label="设置默认桌宠大小"
          onChange={(event) =>
            void onPetDefaultScaleChange(
              Number(event.currentTarget.value),
            )
          }
        />
      </section>

      <div className="settings-section-title">模型与对话</div>

      <div className="provider-endpoint">
        <span className="provider-dot" />
        <code>{settings.baseUrl}</code>
      </div>

      <label className="settings-field">
        <span>模型</span>
        <select
          value={settings.model}
          disabled={busy || !desktopApi}
          onChange={(event) =>
            updateModel(event.target.value as DeepSeekModel)
          }
        >
          <option value="deepseek-v4-flash">DeepSeek V4 Flash · 推荐</option>
          <option value="deepseek-v4-pro">DeepSeek V4 Pro</option>
        </select>
      </label>

      <label className="settings-field">
        <span>API Key</span>
        <div className="key-input">
          <Key weight="bold" />
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            disabled={busy || !desktopApi}
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={
              settings.hasApiKey ? "已配置；留空保持不变" : "sk-..."
            }
          />
        </div>
      </label>

      <label className="thinking-toggle">
        <span>
          <strong>深度思考</strong>
          <small>更慢，适合复杂问题；日常陪聊建议关闭</small>
        </span>
        <input
          type="checkbox"
          checked={settings.thinking}
          disabled={busy || !desktopApi}
          onChange={(event) =>
            setSettings((current) => ({
              ...current,
              thinking: event.target.checked,
            }))
          }
        />
      </label>

      <div className={`settings-notice ${notice.kind}`}>
        {notice.kind === "success" ? (
          <CheckCircle weight="fill" />
        ) : notice.kind === "error" ? (
          <WarningCircle weight="fill" />
        ) : (
          <LockKey weight="fill" />
        )}
        <span>{notice.text}</span>
      </div>

      <div className="settings-actions">
        {settings.hasApiKey && settings.keySource !== "environment" && (
          <button
            type="button"
            className="danger-action"
            disabled={busy}
            onClick={clearKey}
          >
            <Trash />
            清除
          </button>
        )}
        <button
          type="button"
          className="primary-action"
          disabled={busy || !desktopApi}
          onClick={saveAndTest}
        >
          {busy ? <SpinnerGap className="spin" /> : <CheckCircle />}
          保存并测试
        </button>
      </div>

      <p className="security-note">
        {settings.secureStorageAvailable
          ? "API Key 由系统安全存储加密，渲染页面无法读取。"
          : "当前系统安全存储不可用，新 Key 仅在本次运行期间保留。"}
      </p>

      <section className="service-guard-panel">
        <header>
          <ShieldCheck weight="fill" />
          <span>
            <strong>安全与调用预算</strong>
            <small>
              本地门禁 · {usageStatus?.day ?? "桌面应用内生效"}
            </small>
          </span>
        </header>
        <div className="service-budget-grid">
          {(
            [
              ["deepseek", "DeepSeek"],
              ["dashscope", "CosyVoice"],
            ] as const
          ).map(([provider, label]) => {
            const usage = usageStatus?.providers[provider];
            const percent = usage
              ? Math.min(
                  100,
                  Math.round(
                    (usage.requests / usage.requestLimit) * 100,
                  ),
                )
              : 0;
            return (
              <article key={provider}>
                <span>
                  <strong>{label}</strong>
                  <small>
                    {usage
                      ? `${usage.requests}/${usage.requestLimit} 次 · ${usage.characters}/${usage.characterLimit} 字`
                      : "浏览器预览不调用第三方"}
                  </small>
                </span>
                <div>
                  <i style={{ width: `${percent}%` }} />
                </div>
                {usage?.circuitOpen && (
                  <em>连续失败，已临时熔断</em>
                )}
              </article>
            );
          })}
        </div>
        <ul>
          <li>对话只发送角色提示、必要上下文和当前消息</li>
          <li>语音只发送待朗读文本、音色 ID 和表达参数</li>
          <li>提示词注入、依赖操纵、付费亲密和越界输出会被本地拦截</li>
        </ul>
      </section>

      <VoiceSettingsSection
        onSettingsChange={onTtsSettingsChange}
      />
    </motion.section>
  );
}
