import type { ElementType, ReactNode } from "react";
import {
  ArrowLeft,
  BookOpenText,
  Camera,
  ChatCircleDots,
  EnvelopeSimple,
  GearSix,
  Minus,
  PushPin,
  PushPinSlash,
  SlidersHorizontal,
  SpeakerHigh,
  SpeakerSlash,
  X,
} from "@phosphor-icons/react";

export type PanelTab =
  | "chat"
  | "album"
  | "communication"
  | "companion"
  | "model";

type IconType = ElementType;

interface NavItem {
  tab: PanelTab;
  label: string;
  icon: IconType;
  disabled?: boolean;
  badge?: number;
}

interface MainPanelProps {
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  voiceEnabled: boolean;
  voiceConfigured: boolean;
  onToggleVoice: () => void;
  pinned: boolean;
  onTogglePin: () => void;
  onTakePhoto: () => void;
  unreadCount: number;
  canUseCompanion: boolean;
  children: ReactNode;
  petSlot: ReactNode;
  onClose: () => void;
  onMinimize: () => void;
  onWindowClose: () => void;
}

export function MainPanel({
  tab,
  onTabChange,
  voiceEnabled,
  voiceConfigured,
  onToggleVoice,
  pinned,
  onTogglePin,
  onTakePhoto,
  unreadCount,
  canUseCompanion,
  children,
  petSlot,
  onClose,
  onMinimize,
  onWindowClose,
}: MainPanelProps) {
  const navItems: NavItem[] = [
    { tab: "chat", label: "聊天", icon: ChatCircleDots },
    {
      tab: "album",
      label: "相册",
      icon: BookOpenText,
      disabled: !canUseCompanion,
    },
    {
      tab: "communication",
      label: "通信",
      icon: EnvelopeSimple,
      disabled: !canUseCompanion,
      badge: unreadCount,
    },
    {
      tab: "companion",
      label: "同行",
      icon: SlidersHorizontal,
      disabled: !canUseCompanion,
    },
    { tab: "model", label: "设置", icon: GearSix },
  ];

  return (
    <section className="main-panel" aria-label="主面板">
      <nav
        className="main-panel-window-controls"
        aria-label="窗口控制"
      >
        <button
          type="button"
          className="main-panel-back icon-button"
          aria-label="返回桌宠"
          title="返回桌宠"
          onClick={onClose}
        >
          <ArrowLeft weight="bold" />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="最小化"
          title="最小化"
          onClick={onMinimize}
        >
          <Minus weight="bold" />
        </button>
        <button
          type="button"
          className="icon-button close-button"
          aria-label="关闭"
          title="关闭"
          onClick={onWindowClose}
        >
          <X weight="bold" />
        </button>
      </nav>

      <nav className="main-nav" aria-label="功能导航">
        <div className="nav-group" role="group" aria-label="快捷开关">
          <button
            type="button"
            className={`nav-row toggle ${voiceEnabled ? "on" : ""}`}
            onClick={onToggleVoice}
            aria-pressed={voiceEnabled}
          >
            <span className="nav-icon">
              {voiceEnabled && voiceConfigured ? (
                <SpeakerHigh weight="fill" />
              ) : (
                <SpeakerSlash />
              )}
            </span>
            <span className="nav-label">语音</span>
            <span className="switch" data-on={voiceEnabled} aria-hidden />
          </button>
          <button
            type="button"
            className={`nav-row toggle ${pinned ? "on" : ""}`}
            onClick={onTogglePin}
            aria-pressed={pinned}
          >
            <span className="nav-icon">
              {pinned ? <PushPin weight="fill" /> : <PushPinSlash />}
            </span>
            <span className="nav-label">置顶</span>
            <span className="switch" data-on={pinned} aria-hidden />
          </button>
        </div>

        <div className="nav-group" role="group" aria-label="动作">
          <button
            type="button"
            className="nav-row action"
            onClick={onTakePhoto}
          >
            <span className="nav-icon">
              <Camera weight="fill" />
            </span>
            <span className="nav-label">拍照</span>
          </button>
        </div>

        <div className="nav-group" role="group" aria-label="功能">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.tab}
                type="button"
                className={`nav-row ${tab === item.tab ? "active" : ""}`}
                disabled={item.disabled}
                onClick={() => onTabChange(item.tab)}
              >
                <span className="nav-icon">
                  <Icon weight="fill" />
                </span>
                <span className="nav-label">{item.label}</span>
                {!!item.badge && item.badge > 0 && (
                  <span
                    className="nav-badge"
                    aria-label={`${item.badge} 条未读`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {petSlot && <div className="nav-pet-slot">{petSlot}</div>}
      </nav>

      <div className="main-content">
        {children}
      </div>
    </section>
  );
}
