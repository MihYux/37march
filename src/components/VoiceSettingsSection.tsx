import { useEffect, useRef, useState } from "react";
import {
  CheckCircle,
  Key,
  LockKey,
  SpeakerHigh,
  SpinnerGap,
  Trash,
  WarningCircle,
} from "@phosphor-icons/react";
import type {
  TtsAudioResult,
  TtsPublicSettings,
} from "../ai/types";

interface VoiceSettingsSectionProps {
  onSettingsChange: (settings: TtsPublicSettings) => void;
}

const fallbackSettings: TtsPublicSettings = {
  provider: "dashscope",
  baseUrl: "https://dashscope.aliyuncs.com/api/v1",
  model: "cosyvoice-v3.5-flash",
  voiceId:
    "cosyvoice-v3.5-flash-marchpet-eb86bcaeea5f40669b1798191950529a",
  enabled: false,
  autoPlay: false,
  volume: 0.86,
  rate: 1,
  voiceRightsConfirmed: false,
  hasApiKey: false,
  keySource: "none",
  secureStorageAvailable: false,
};

function readyNotice(settings: TtsPublicSettings) {
  if (!settings.voiceRightsConfirmed) {
    return "确认声音授权后才能启用或试听复刻音色";
  }
  if (!settings.hasApiKey) return "填写 DashScope API Key 后保存并试听";
  if (settings.keySource === "macos-keychain") {
    return "已从 macOS 钥匙串读取 DashScope API Key";
  }
  if (settings.keySource === "environment") {
    return "正在使用 DASHSCOPE_API_KEY 环境变量";
  }
  return "复刻音色已配置，可以试听";
}

export function VoiceSettingsSection({
  onSettingsChange,
}: VoiceSettingsSectionProps) {
  const [settings, setSettings] =
    useState<TtsPublicSettings>(fallbackSettings);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{
    kind: "success" | "error" | "neutral";
    text: string;
  }>({ kind: "neutral", text: "正在读取语音设置…" });
  const previewAudio = useRef<HTMLAudioElement | null>(null);
  const desktopApi = window.marchDesktop?.tts;

  useEffect(() => {
    if (!desktopApi) {
      setNotice({
        kind: "neutral",
        text: "语音设置只在 Electron 桌面应用中可用",
      });
      return;
    }

    desktopApi
      .getSettings()
      .then((nextSettings) => {
        setSettings(nextSettings);
        onSettingsChange(nextSettings);
        setNotice({
          kind: "neutral",
          text: readyNotice(nextSettings),
        });
      })
      .catch(() => {
        setNotice({ kind: "error", text: "读取语音设置失败" });
      });
  }, [desktopApi, onSettingsChange]);

  useEffect(
    () => () => {
      previewAudio.current?.pause();
      previewAudio.current = null;
    },
    [],
  );

  const playPreview = async (result: TtsAudioResult, volume: number) => {
    if (!result.ok) return;
    previewAudio.current?.pause();
    const audio = new Audio(
      `data:${result.mimeType};base64,${result.audioBase64}`,
    );
    audio.volume = volume;
    previewAudio.current = audio;
    await audio.play();
  };

  const saveAndPreview = async () => {
    if (!desktopApi) return;
    if (!settings.hasApiKey && !apiKey.trim()) {
      setNotice({ kind: "error", text: "请先填写 DashScope API Key" });
      return;
    }
    if (!settings.voiceRightsConfirmed) {
      setNotice({
        kind: "error",
        text: "请先确认你拥有声音样本和复刻音色的使用授权",
      });
      return;
    }

    setBusy(true);
    setNotice({ kind: "neutral", text: "正在保存并生成试听语音…" });
    try {
      const nextSettings = await desktopApi.saveSettings({
        enabled: settings.enabled,
        autoPlay: settings.autoPlay,
        volume: settings.volume,
        rate: settings.rate,
        voiceRightsConfirmed: settings.voiceRightsConfirmed,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      });
      setSettings(nextSettings);
      setApiKey("");
      onSettingsChange(nextSettings);

      const result = await desktopApi.test();
      if (!result.ok) {
        setNotice({ kind: "error", text: result.error });
        return;
      }

      await playPreview(result, nextSettings.volume);
      setNotice({
        kind: "success",
        text: `试听成功 · ${result.characters} 字`,
      });
    } catch {
      setNotice({
        kind: "error",
        text: "保存或播放试听语音失败",
      });
    } finally {
      setBusy(false);
    }
  };

  const clearKey = async () => {
    if (!desktopApi) return;
    setBusy(true);
    try {
      const nextSettings = await desktopApi.clearApiKey();
      setSettings(nextSettings);
      setApiKey("");
      onSettingsChange(nextSettings);
      setNotice({
        kind: "neutral",
        text: nextSettings.hasApiKey
          ? readyNotice(nextSettings)
          : "已清除保存的 DashScope API Key",
      });
    } catch {
      setNotice({ kind: "error", text: "清除 DashScope API Key 失败" });
    } finally {
      setBusy(false);
    }
  };

  const updateVoiceRights = async (confirmed: boolean) => {
    if (!desktopApi) return;
    const optimistic = {
      ...settings,
      voiceRightsConfirmed: confirmed,
      enabled: confirmed ? settings.enabled : false,
      autoPlay: confirmed ? settings.autoPlay : false,
    };
    setSettings(optimistic);
    setBusy(true);
    try {
      const nextSettings = await desktopApi.saveSettings({
        voiceRightsConfirmed: confirmed,
        enabled: optimistic.enabled,
        autoPlay: optimistic.autoPlay,
      });
      setSettings(nextSettings);
      onSettingsChange(nextSettings);
      setNotice({
        kind: "neutral",
        text: confirmed
          ? "声音授权确认已保存；配置 Key 后可以启用和试听"
          : "声音授权确认已撤销，语音输出和自动朗读已经关闭",
      });
    } catch {
      setSettings(settings);
      setNotice({
        kind: "error",
        text: "声音授权设置没有保存，请稍后重试",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="voice-settings" aria-label="语音设置">
      <header className="voice-settings-header">
        <div>
          <span className="eyebrow">VOICE OUTPUT</span>
          <div className="voice-title-row">
            <h3>CosyVoice 复刻音色</h3>
            <span className="streaming-badge">PCM 实时流</span>
          </div>
        </div>
        <SpeakerHigh weight="duotone" />
      </header>

      <div className="provider-endpoint voice-endpoint">
        <span className="provider-dot" />
        <code title={settings.baseUrl}>{settings.baseUrl}</code>
      </div>

      <dl className="voice-identity">
        <div>
          <dt>模型</dt>
          <dd>{settings.model}</dd>
        </div>
        <div>
          <dt>音色 ID</dt>
          <dd title={settings.voiceId}>{settings.voiceId}</dd>
        </div>
      </dl>

      <label className="settings-field">
        <span>DashScope API Key</span>
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

      <label className="voice-rights-confirmation">
        <input
          type="checkbox"
          checked={settings.voiceRightsConfirmed}
          disabled={busy || !desktopApi}
          onChange={(event) =>
            void updateVoiceRights(event.target.checked)
          }
        />
        <span>
          <strong>声音使用授权确认</strong>
          <small>
            我确认对声音样本、复刻音色及当前用途拥有必要授权，并会在授权撤回时停止使用
          </small>
        </span>
      </label>

      <div className="voice-toggle-grid">
        <label className="thinking-toggle">
          <span>
            <strong>语音输出</strong>
            <small>允许气泡和消息独立播放</small>
          </span>
          <input
            type="checkbox"
            checked={settings.enabled}
            disabled={
              busy ||
              !desktopApi ||
              !settings.voiceRightsConfirmed
            }
            onChange={(event) =>
              setSettings((current) => ({
                ...current,
                enabled: event.target.checked,
              }))
            }
          />
        </label>
        <label className="thinking-toggle">
          <span>
            <strong>自动朗读</strong>
            <small>回复后自动启动实时语音</small>
          </span>
          <input
            type="checkbox"
            checked={settings.autoPlay}
            disabled={busy || !desktopApi || !settings.enabled}
            onChange={(event) =>
              setSettings((current) => ({
                ...current,
                autoPlay: event.target.checked,
              }))
            }
          />
        </label>
      </div>

      <div className="voice-controls">
        <label className="settings-field">
          <span>语速</span>
          <select
            value={settings.rate}
            disabled={busy || !desktopApi}
            onChange={(event) =>
              setSettings((current) => ({
                ...current,
                rate: Number(event.target.value),
              }))
            }
          >
            <option value={0.9}>舒缓 · 0.9×</option>
            <option value={1}>自然 · 1.0×</option>
            <option value={1.1}>轻快 · 1.1×</option>
          </select>
        </label>
        <label className="settings-field volume-field">
          <span>播放音量 · {Math.round(settings.volume * 100)}%</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={settings.volume}
            disabled={busy || !desktopApi}
            onChange={(event) =>
              setSettings((current) => ({
                ...current,
                volume: Number(event.target.value),
              }))
            }
          />
        </label>
      </div>

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
        {settings.hasApiKey &&
          ["secure-storage", "session"].includes(settings.keySource) && (
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
          disabled={
            busy ||
            !desktopApi ||
            !settings.voiceRightsConfirmed
          }
          onClick={saveAndPreview}
        >
          {busy ? <SpinnerGap className="spin" /> : <SpeakerHigh />}
          保存并试听
        </button>
      </div>

      <p className="security-note">
        音色 ID 可公开；API Key
        {settings.keySource === "macos-keychain"
          ? " 保留在 macOS 钥匙串中，不会写入项目。"
          : settings.secureStorageAvailable
            ? " 由系统安全存储加密，渲染页面无法读取。"
            : " 仅在安全存储可用时持久保存。"}
      </p>
    </section>
  );
}
