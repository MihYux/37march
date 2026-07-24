import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  BookmarkSimple,
  BookOpenText,
  Camera,
  ChatCircleDots,
  CursorClick,
  EnvelopeSimple,
  GearSix,
  Minus,
  PaperPlaneTilt,
  PushPin,
  PushPinSlash,
  SlidersHorizontal,
  SpeakerHigh,
  SpeakerSlash,
  Sparkle,
  SpinnerGap,
  StopCircle,
  X,
} from "@phosphor-icons/react";
import type {
  AiConversationMessage,
  MemoryCandidateSummary,
  TtsPublicSettings,
  TtsStreamEvent,
} from "./ai/types";
import { decodePcm16LeBase64 } from "./audio/pcm";
import { createRevealPlan } from "./ui/reveal";
import { calculateWindowDragPosition } from "./ui/window-drag";
import {
  getMarchReply,
  IDLE_LINES,
  type MarchMood,
} from "./character/march7th";
import { CompanionOnboarding } from "./components/CompanionOnboarding";
import type {
  CompanionData,
  DesktopRoute,
  DesktopWindowStatus,
} from "./domain/types";
import type { CompanionOnboardingInput } from "./domain/types";
import { createRendererPreviewData } from "./domain/preview-data";
import { countUnreadDeliverableMessages } from "./domain/messages";
import { derivePetActivity } from "./domain/pet-activity";

const AlbumPanel = lazy(() =>
  import("./components/AlbumPanel").then((module) => ({
    default: module.AlbumPanel,
  })),
);
const CommunicationCenter = lazy(() =>
  import("./components/CommunicationCenter").then((module) => ({
    default: module.CommunicationCenter,
  })),
);
const CompanionSettingsPanel = lazy(() =>
  import("./components/CompanionSettingsPanel").then((module) => ({
    default: module.CompanionSettingsPanel,
  })),
);
const ModelSettingsPanel = lazy(() =>
  import("./components/ModelSettingsPanel").then((module) => ({
    default: module.ModelSettingsPanel,
  })),
);

interface Message {
  id: number;
  role: "you" | "march";
  text: string;
  speechText?: string;
  mood?: MarchMood;
}

type ReplySource = "local" | "model" | "error";
type VoiceState = "idle" | "synthesizing" | "speaking" | "error";

interface ActiveVoiceSession {
  requestId: string;
  text: string;
  context: AudioContext;
  gain: GainNode;
  sources: Set<AudioBufferSourceNode>;
  nextStartAt: number;
  pendingByte: number | null;
  streamComplete: boolean;
}

interface WindowDragSession {
  pointerId: number;
  captureTarget: Element;
  startScreenX: number;
  startScreenY: number;
  startWindowX: number | null;
  startWindowY: number | null;
  dragged: boolean;
  startedOnCharacter: boolean;
}

interface SpeechPlayButtonProps {
  text: string;
  activeText: string;
  voiceState: VoiceState;
  configured: boolean;
  desktopAvailable: boolean;
  className?: string;
  onToggle: () => void;
}

function SpeechPlayButton({
  text,
  activeText,
  voiceState,
  configured,
  desktopAvailable,
  className = "",
  onToggle,
}: SpeechPlayButtonProps) {
  const active =
    activeText === text &&
    (voiceState === "synthesizing" || voiceState === "speaking");
  const title = !desktopAvailable
    ? "语音播放只在桌面应用中可用"
    : !configured
      ? "配置 CosyVoice 后播放这段语音"
      : active
        ? "停止播放"
        : "播放这段语音";

  return (
    <button
      type="button"
      className={`speech-play-button ${active ? "active" : ""} ${className}`}
      aria-label={active ? "停止这段语音" : "播放这段语音"}
      title={title}
      disabled={!desktopAvailable}
      onClick={onToggle}
    >
      {active && voiceState === "synthesizing" ? (
        <SpinnerGap className="spin" />
      ) : active ? (
        <StopCircle weight="fill" />
      ) : (
        <SpeakerHigh weight="fill" />
      )}
    </button>
  );
}

const moodLabel: Record<MarchMood, string> = {
  bright: "元气满满",
  soft: "认真陪伴",
  proud: "小小得意",
  curious: "好奇中",
};

function inferMood(text: string): MarchMood {
  if (/难过|伤心|陪|别怕|努力|记忆|过去|珍贵|安心/.test(text)) {
    return "soft";
  }
  if (/哼哼|本姑娘|当然|厉害/.test(text)) {
    return "proud";
  }
  if (/[？?]|好奇|想想|等等/.test(text)) {
    return "curious";
  }
  return "bright";
}

function toAiMessages(messages: Message[]): AiConversationMessage[] {
  return messages.slice(-10).map((message) => ({
    role: message.role === "you" ? "user" : "assistant",
    content: message.text,
  }));
}

function App() {
  const [bubble, setBubble] = useState(IDLE_LINES[0].text);
  const [bubbleSpeechText, setBubbleSpeechText] = useState(
    IDLE_LINES[0].text,
  );
  const [mood, setMood] = useState<MarchMood>(IDLE_LINES[0].mood);
  const [chatOpen, setChatOpen] = useState(false);
  const [albumOpen, setAlbumOpen] = useState(false);
  const [communicationOpen, setCommunicationOpen] = useState(false);
  const [companionSettingsOpen, setCompanionSettingsOpen] =
    useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [input, setInput] = useState("");
  const [pinned, setPinned] = useState(true);
  const [modelReady, setModelReady] = useState(false);
  const [memoryCandidate, setMemoryCandidate] =
    useState<MemoryCandidateSummary | null>(null);
  const [memoryDecisionBusy, setMemoryDecisionBusy] = useState(false);
  const [ttsSettings, setTtsSettings] =
    useState<TtsPublicSettings | null>(null);
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [revealing, setRevealing] = useState(false);
  const [revealingMessageId, setRevealingMessageId] =
    useState<number | null>(null);
  const [replySource, setReplySource] = useState<ReplySource>("local");
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 1,
      role: "march",
      text: "哎呀，你来得正好。今天还没一起拍过照呢！",
      mood: "bright",
    },
  ]);
  const nextMessageId = useRef(2);
  const inputRef = useRef<HTMLInputElement>(null);
  const messageListRef = useRef<HTMLDivElement>(null);
  const voiceSessionRef = useRef<ActiveVoiceSession | null>(null);
  const revealRunIdRef = useRef(0);
  const mountedRef = useRef(true);
  const windowDragRef = useRef<WindowDragSession | null>(null);
  const suppressCharacterClickUntilRef = useRef(0);
  const [activeVoiceText, setActiveVoiceText] = useState("");
  const [companionData, setCompanionData] =
    useState<CompanionData | null>(null);
  const [pendingPhoto, setPendingPhoto] = useState(false);
  const [desktopStatus, setDesktopStatus] =
    useState<DesktopWindowStatus | null>(null);
  const [activityNow, setActivityNow] = useState(() => new Date());

  useEffect(() => {
    if (chatOpen) {
      inputRef.current?.focus();
    }
  }, [chatOpen]);

  useEffect(() => {
    if (!chatOpen) return;
    const messageList = messageListRef.current;
    if (messageList) {
      messageList.scrollTop = messageList.scrollHeight;
    }
  }, [chatOpen, messages]);

  useEffect(() => {
    if (
      !chatOpen &&
      !settingsOpen &&
      !albumOpen &&
      !communicationOpen &&
      !companionSettingsOpen &&
      !(
        companionData &&
        !companionData.profile.onboardingCompleted
      )
    ) {
      return;
    }

    const handleOverlayKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setChatOpen(false);
        setSettingsOpen(false);
        setAlbumOpen(false);
        setCommunicationOpen(false);
        setCompanionSettingsOpen(false);
        return;
      }

      if (event.key === "Tab") {
        const dialog = document.querySelector<HTMLElement>(
          '[role="dialog"][aria-modal="true"]',
        );
        if (!dialog) return;
        const focusable = Array.from(
          dialog.querySelectorAll<HTMLElement>(
            'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
          ),
        ).filter(
          (element) =>
            element.offsetParent !== null &&
            element.getAttribute("aria-hidden") !== "true",
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            !dialog.contains(document.activeElement))
        ) {
          event.preventDefault();
          last.focus();
        } else if (
          !event.shiftKey &&
          (document.activeElement === last ||
            !dialog.contains(document.activeElement))
        ) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener("keydown", handleOverlayKeyboard);
    return () =>
      window.removeEventListener("keydown", handleOverlayKeyboard);
  }, [
    albumOpen,
    chatOpen,
    communicationOpen,
    companionSettingsOpen,
    companionData,
    settingsOpen,
  ]);

  useEffect(() => {
    window.marchDesktop?.ai
      .getSettings()
      .then((settings) => setModelReady(settings.hasApiKey))
      .catch(() => setModelReady(false));

    window.marchDesktop?.tts
      .getSettings()
      .then(setTtsSettings)
      .catch(() => setTtsSettings(null));

    if (window.marchDesktop?.companion) {
      window.marchDesktop.companion
        .getData()
        .then(setCompanionData)
        .catch(() => setCompanionData(null));
    } else {
      setCompanionData(createRendererPreviewData());
    }

    window.marchDesktop
      ?.getDesktopStatus()
      .then((status) => {
        setDesktopStatus(status);
        setPinned(status.pinned);
      })
      .catch(() => setDesktopStatus(null));
  }, []);

  useEffect(() => {
    const timer = window.setInterval(
      () => setActivityNow(new Date()),
      60_000,
    );
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const desktop = window.marchDesktop;
    if (!desktop) return;
    const openRoute = (route: DesktopRoute) => {
      setChatOpen(false);
      setSettingsOpen(false);
      setAlbumOpen(route === "album");
      setCommunicationOpen(route === "communication");
      setCompanionSettingsOpen(route === "companion_settings");
    };
    desktop.onNavigate(openRoute);
    desktop.onCompanionDataChange(setCompanionData);
    return () => {
      desktop.clearNavigateListener();
      desktop.clearCompanionDataChangeListener();
    };
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      revealRunIdRef.current += 1;
    };
  }, []);

  const closeVoiceSession = useCallback(
    (
      nextState: VoiceState = "idle",
      cancelRemote = true,
    ) => {
      const session = voiceSessionRef.current;
      if (session) {
        voiceSessionRef.current = null;
        if (cancelRemote) {
          void window.marchDesktop?.tts.cancelStream(session.requestId);
        }
        for (const source of session.sources) {
          source.onended = null;
          try {
            source.stop();
          } catch {
            // The source may already have ended.
          }
        }
        session.sources.clear();
        void session.context.close().catch(() => {});
      }
      setActiveVoiceText("");
      setVoiceState(nextState);
    },
    [],
  );

  useEffect(() => {
    const desktopTts = window.marchDesktop?.tts;
    if (!desktopTts) return;

    const handleStreamEvent = (event: TtsStreamEvent) => {
      const session = voiceSessionRef.current;
      if (!session || session.requestId !== event.requestId) return;

      if (event.type === "audio") {
        try {
          const decoded = decodePcm16LeBase64(
            event.audioBase64,
            session.pendingByte,
          );
          session.pendingByte = decoded.pendingByte;
          if (!decoded.samples.length) return;

          const buffer = session.context.createBuffer(
            1,
            decoded.samples.length,
            event.sampleRate,
          );
          buffer.getChannelData(0).set(decoded.samples);
          const source = session.context.createBufferSource();
          source.buffer = buffer;
          source.connect(session.gain);
          session.nextStartAt = Math.max(
            session.nextStartAt,
            session.context.currentTime +
              (session.nextStartAt ? 0.012 : 0.05),
          );
          source.start(session.nextStartAt);
          session.nextStartAt += buffer.duration;
          session.sources.add(source);
          source.onended = () => {
            session.sources.delete(source);
            if (
              session.streamComplete &&
              session.sources.size === 0 &&
              voiceSessionRef.current === session
            ) {
              closeVoiceSession("idle", false);
            }
          };
          setVoiceState("speaking");
        } catch {
          closeVoiceSession("error");
        }
        return;
      }

      if (event.type === "complete") {
        session.streamComplete = true;
        if (session.sources.size === 0) {
          closeVoiceSession("idle", false);
        }
        return;
      }

      if (event.type === "error") {
        closeVoiceSession("error", false);
        return;
      }

      if (event.type === "canceled") {
        closeVoiceSession("idle", false);
      }
    };

    desktopTts.onStreamEvent(handleStreamEvent);
    return () => {
      desktopTts.clearStreamEventListener();
      const session = voiceSessionRef.current;
      if (!session) return;
      voiceSessionRef.current = null;
      void desktopTts.cancelStream(session.requestId);
      for (const source of session.sources) {
        source.onended = null;
        try {
          source.stop();
        } catch {
          // The source may already have ended.
        }
      }
      void session.context.close().catch(() => {});
    };
  }, [closeVoiceSession]);

  const handleModelReadyChange = useCallback((ready: boolean) => {
    setModelReady(ready);
  }, []);

  const handleTtsSettingsChange = useCallback(
    (nextSettings: TtsPublicSettings) => {
      setTtsSettings(nextSettings);
      if (!nextSettings.enabled) {
        closeVoiceSession();
      }
    },
    [closeVoiceSession],
  );

  const speak = (text: string, nextMood: MarchMood) => {
    revealRunIdRef.current += 1;
    setRevealing(false);
    setRevealingMessageId(null);
    setBubble(text);
    setBubbleSpeechText(text);
    setMood(nextMood);
  };

  const revealReply = useCallback(
    async (
      messageId: number,
      text: string,
      nextMood: MarchMood,
    ) => {
      const runId = ++revealRunIdRef.current;
      const plan = createRevealPlan(text);
      setRevealing(true);
      setRevealingMessageId(messageId);
      setBubble("");
      setBubbleSpeechText(text);
      setMood(nextMood);

      await new Promise((resolve) =>
        setTimeout(resolve, plan.leadInMs),
      );
      for (const frame of plan.frames) {
        if (revealRunIdRef.current !== runId) {
          if (mountedRef.current) {
            setMessages((current) =>
              current.map((message) =>
                message.id === messageId
                  ? { ...message, text }
                  : message,
              ),
            );
          }
          return false;
        }
        setBubble(frame);
        setMessages((current) =>
          current.map((message) =>
            message.id === messageId
              ? { ...message, text: frame }
              : message,
          ),
        );
        await new Promise((resolve) =>
          setTimeout(resolve, plan.intervalMs),
        );
      }

      if (revealRunIdRef.current !== runId) {
        if (mountedRef.current) {
          setMessages((current) =>
            current.map((message) =>
              message.id === messageId
                ? { ...message, text }
                : message,
            ),
          );
        }
        return false;
      }
      setRevealing(false);
      setRevealingMessageId(null);
      return true;
    },
    [],
  );

  const startSpeech = useCallback(
    async (
      text: string,
      nextMood: MarchMood,
      automatic = false,
    ) => {
      const desktopTts = window.marchDesktop?.tts;
      if (!desktopTts) return;
      if (
        !ttsSettings?.enabled ||
        !ttsSettings.hasApiKey ||
        !ttsSettings.voiceRightsConfirmed ||
        (automatic && !ttsSettings.autoPlay)
      ) {
        if (!automatic) {
          setSettingsOpen(true);
          setChatOpen(false);
        }
        return;
      }

      if (
        !automatic &&
        voiceSessionRef.current?.text === text
      ) {
        closeVoiceSession();
        return;
      }

      closeVoiceSession();
      const requestId = crypto.randomUUID();
      let context: AudioContext;
      try {
        context = new AudioContext({ latencyHint: "interactive" });
      } catch {
        setVoiceState("error");
        return;
      }
      const gain = context.createGain();
      gain.gain.value = ttsSettings.volume;
      gain.connect(context.destination);
      const session: ActiveVoiceSession = {
        requestId,
        text,
        context,
        gain,
        sources: new Set(),
        nextStartAt: 0,
        pendingByte: null,
        streamComplete: false,
      };
      voiceSessionRef.current = session;
      setActiveVoiceText(text);
      setVoiceState("synthesizing");

      try {
        await context.resume();
        const result = await desktopTts.startStream({
          requestId,
          text,
          mood: nextMood,
        });
        if (
          voiceSessionRef.current === session &&
          !result.ok
        ) {
          closeVoiceSession("error", false);
        }
      } catch {
        if (voiceSessionRef.current === session) {
          closeVoiceSession("error");
        }
      }
    },
    [closeVoiceSession, ttsSettings],
  );

  const playSpeech = useCallback(
    (text: string, nextMood: MarchMood) => {
      void startSpeech(text, nextMood, true);
    },
    [startSpeech],
  );

  const registerPlayerInteraction = useCallback(() => {
    void window.marchDesktop?.companion
      .registerPlayerInteraction()
      .then(setCompanionData)
      .catch(() => {});
  }, []);

  const beginWindowDrag = (
    event: React.PointerEvent<HTMLElement>,
  ) => {
    const desktop = window.marchDesktop;
    if (
      event.button !== 0 ||
      !desktop?.getWindowPosition ||
      !desktop.moveWindowTo
    ) {
      return;
    }

    const target = event.target;
    if (!(target instanceof Element)) return;
    const startedOnCharacter = Boolean(
      target.closest(".character-button"),
    );
    const blocksWindowDrag = target.closest(
      [
        ".window-controls",
        ".quick-actions",
        ".chat-panel",
        ".album-panel",
        ".communication-panel",
        ".companion-onboarding",
        ".companion-settings-panel",
        ".settings-panel",
        ".speech-play-button",
        "input",
        "textarea",
        "select",
        "a",
        "label",
      ].join(","),
    );
    if (
      blocksWindowDrag ||
      (target.closest("button") && !startedOnCharacter)
    ) {
      return;
    }

    const session: WindowDragSession = {
      pointerId: event.pointerId,
      captureTarget: target,
      startScreenX: event.screenX,
      startScreenY: event.screenY,
      startWindowX: null,
      startWindowY: null,
      dragged: false,
      startedOnCharacter,
    };
    windowDragRef.current = session;
    target.setPointerCapture(event.pointerId);

    void desktop.getWindowPosition().then(([x, y]) => {
      if (windowDragRef.current !== session) return;
      session.startWindowX = x;
      session.startWindowY = y;
    });
  };

  const moveWindowDrag = (
    event: React.PointerEvent<HTMLElement>,
  ) => {
    const session = windowDragRef.current;
    if (
      !session ||
      session.pointerId !== event.pointerId ||
      session.startWindowX === null ||
      session.startWindowY === null
    ) {
      return;
    }

    const position = calculateWindowDragPosition(
      {
        screenX: session.startScreenX,
        screenY: session.startScreenY,
        windowX: session.startWindowX,
        windowY: session.startWindowY,
      },
      event.screenX,
      event.screenY,
    );
    if (!position) return;

    session.dragged = true;
    window.marchDesktop?.moveWindowTo(position);
  };

  const endWindowDrag = (
    event: React.PointerEvent<HTMLElement>,
  ) => {
    const session = windowDragRef.current;
    if (!session || session.pointerId !== event.pointerId) return;

    if (session.dragged && session.startedOnCharacter) {
      suppressCharacterClickUntilRef.current =
        performance.now() + 400;
    }
    windowDragRef.current = null;
    if (session.captureTarget.hasPointerCapture(event.pointerId)) {
      session.captureTarget.releasePointerCapture(event.pointerId);
    }
    if (session.dragged) {
      void window.marchDesktop
        ?.endWindowMove()
        .then(setDesktopStatus)
        .catch(() => {});
    }
  };

  const toggleSpeech = useCallback(
    (text: string, nextMood: MarchMood) => {
      if (
        activeVoiceText === text &&
        (voiceState === "synthesizing" ||
          voiceState === "speaking")
      ) {
        closeVoiceSession();
        return;
      }
      void startSpeech(text, nextMood);
    },
    [
      activeVoiceText,
      closeVoiceSession,
      startSpeech,
      voiceState,
    ],
  );

  const surpriseMe = () => {
    if (performance.now() < suppressCharacterClickUntilRef.current) {
      suppressCharacterClickUntilRef.current = 0;
      return;
    }
    const reply = IDLE_LINES[Math.floor(Math.random() * IDLE_LINES.length)];
    registerPlayerInteraction();
    speak(reply.text, reply.mood);
    void playSpeech(reply.text, reply.mood);
  };

  const takePhoto = () => {
    registerPlayerInteraction();
    const reply = getMarchReply("拍照");
    speak(reply.text, reply.mood);
    void playSpeech(reply.text, reply.mood);
    setPendingPhoto(true);
  };

  const savePhotoToAlbum = async () => {
    const api = window.marchDesktop?.companion;
    if (!api) return;
    try {
      const nextData = await api.createPhotoMemory();
      setCompanionData(nextData);
      setPendingPhoto(false);
      speak(
        "收好啦！以后翻到这张的时候，可别假装忘了今天是和谁一起拍的哦。",
        "proud",
      );
    } catch (error) {
      speak(
        error instanceof Error
          ? error.message
          : "欸，照片刚才没存好。再试一次嘛。",
        "soft",
      );
    }
  };

  const submitMessage = async (event: React.FormEvent) => {
    event.preventDefault();
    const cleanInput = input.trim();
    if (!cleanInput || sending) return;

    const userMessage: Message = {
      id: nextMessageId.current++,
      role: "you",
      text: cleanInput,
    };
    registerPlayerInteraction();
    const nextConversation = [...messages, userMessage].slice(-10);

    setMessages(nextConversation);
    setInput("");
    setSending(true);
    closeVoiceSession();
    speak("等等，咱认真想想……", "curious");

    let replyText = "";
    let replyMood: MarchMood = "bright";
    let source: ReplySource = "local";
    let nextMemoryCandidate: MemoryCandidateSummary | undefined;

    if (window.marchDesktop?.ai && modelReady) {
      try {
        const result = await window.marchDesktop.ai.chat({
          messages: toAiMessages(nextConversation),
        });
        if (result.ok) {
          replyText = result.content;
          replyMood = inferMood(result.content);
          source =
            result.model === "local-safety-guard"
              ? "local"
              : "model";
          nextMemoryCandidate = result.memoryCandidate;
        } else {
          const fallback = getMarchReply(cleanInput);
          replyText = fallback.text;
          replyMood = fallback.mood;
          source = "error";
        }
      } catch {
        const fallback = getMarchReply(cleanInput);
        replyText = fallback.text;
        replyMood = fallback.mood;
        source = "error";
      }
    } else {
      const fallback = getMarchReply(cleanInput);
      replyText = fallback.text;
      replyMood = fallback.mood;
    }

    if (!nextMemoryCandidate) {
      const proposed =
        await window.marchDesktop?.companion
          ?.proposeMemoryCandidate(
            cleanInput,
            `chat-message-${userMessage.id}`,
          )
          .catch(() => undefined);
      if (proposed) {
        nextMemoryCandidate = {
          id: proposed.id,
          title: proposed.title,
          summary: proposed.summary,
          characterText: proposed.characterText,
          category: proposed.category,
        };
      }
    }
    setMemoryCandidate(nextMemoryCandidate ?? null);

    const marchMessage: Message = {
      id: nextMessageId.current++,
      role: "march",
      text: "",
      speechText: replyText,
      mood: replyMood,
    };
    setMessages((current) => [...current, marchMessage].slice(-10));
    setReplySource(source);
    void playSpeech(replyText, replyMood);
    await revealReply(marchMessage.id, replyText, replyMood);
    setSending(false);
  };

  const resolveMemoryCandidate = async (confirmed: boolean) => {
    const api = window.marchDesktop?.companion;
    if (!api || !memoryCandidate || memoryDecisionBusy) return;
    setMemoryDecisionBusy(true);
    try {
      const nextData = await api.resolveMemoryCandidate(
        memoryCandidate.id,
        confirmed,
      );
      setCompanionData(nextData);
      if (confirmed) {
        speak("好，咱记住啦。你随时都可以在相册里改主意。", "soft");
      }
      setMemoryCandidate(null);
    } finally {
      setMemoryDecisionBusy(false);
    }
  };

  const togglePin = async () => {
    const nextPinned = window.marchDesktop
      ? await window.marchDesktop.togglePin()
      : !pinned;
    setPinned(nextPinned);
    setDesktopStatus((current) =>
      current
        ? {
            ...current,
            pinned: nextPinned,
          }
        : current,
    );
  };

  const enableClickThrough = async () => {
    const desktop = window.marchDesktop;
    if (!desktop) return;
    try {
      const status = await desktop.setClickThrough(true);
      setDesktopStatus(status);
      if (status.ok === false && status.error) {
        speak(status.error, "soft");
      }
    } catch {
      speak("点击穿透没有开启，请从托盘菜单再试一次。", "soft");
    }
  };

  const toggleSettings = () => {
    setSettingsOpen((open) => !open);
    setChatOpen(false);
    setAlbumOpen(false);
    setCommunicationOpen(false);
    setCompanionSettingsOpen(false);
  };

  const toggleChat = () => {
    setChatOpen((open) => !open);
    setSettingsOpen(false);
    setAlbumOpen(false);
    setCommunicationOpen(false);
    setCompanionSettingsOpen(false);
  };

  const toggleAlbum = () => {
    setAlbumOpen((open) => !open);
    setChatOpen(false);
    setSettingsOpen(false);
    setCommunicationOpen(false);
    setCompanionSettingsOpen(false);
  };

  const toggleCommunication = () => {
    setCommunicationOpen((open) => !open);
    setChatOpen(false);
    setSettingsOpen(false);
    setAlbumOpen(false);
    setCompanionSettingsOpen(false);
  };

  const toggleCompanionSettings = () => {
    setCompanionSettingsOpen((open) => !open);
    setChatOpen(false);
    setSettingsOpen(false);
    setAlbumOpen(false);
    setCommunicationOpen(false);
  };

  const toggleVoice = async () => {
    const desktopTts = window.marchDesktop?.tts;
    if (!desktopTts || !ttsSettings) return;
    if (
      !ttsSettings.hasApiKey ||
      !ttsSettings.voiceRightsConfirmed
    ) {
      setSettingsOpen(true);
      setChatOpen(false);
      setAlbumOpen(false);
      setCommunicationOpen(false);
      setCompanionSettingsOpen(false);
      return;
    }

    try {
      const nextSettings = await desktopTts.saveSettings({
        enabled: !ttsSettings.enabled,
      });
      handleTtsSettingsChange(nextSettings);
    } catch {
      setVoiceState("error");
    }
  };

  const statusText = revealing
    ? "回答已生成 · 文字显示中，语音同步准备"
    : sending
      ? "三月七正在想…"
    : voiceState === "synthesizing"
      ? "正在连接 CosyVoice 实时语音…"
      : voiceState === "speaking"
        ? "流式语音播放中 · 点击喇叭可停止"
        : voiceState === "error"
          ? "语音暂时不可用，文字回复不受影响"
          : replySource === "model"
            ? "由 DeepSeek 生成 · 对话会发送至模型服务"
            : replySource === "error"
              ? "模型暂时不可用，已切换本地回复"
              : modelReady
                ? "DeepSeek 已就绪 · 对话会发送至模型服务"
                : "未配置模型，正在使用本地回复";
  const unreadMessageCount =
    companionData
      ? countUnreadDeliverableMessages(companionData.messages)
      : 0;
  const petActivity = derivePetActivity({
    data: companionData,
    now: activityNow,
    pendingPhoto,
    albumOpen,
    unreadMessages: unreadMessageCount,
  });
  const modalActive =
    chatOpen ||
    settingsOpen ||
    albumOpen ||
    communicationOpen ||
    companionSettingsOpen ||
    Boolean(
      companionData && !companionData.profile.onboardingCompleted,
    );

  const completeOnboarding = async (
    input: CompanionOnboardingInput,
  ) => {
    const api = window.marchDesktop?.companion;
    if (api) {
      const nextData = await api.completeOnboarding(input);
      setCompanionData(nextData);
      speak(
        nextData.messages[0]?.body ??
          "好啦，从今天开始就一起走吧！",
        "bright",
      );
      return;
    }

    const preview = createRendererPreviewData();
    Object.assign(preview.profile, {
      onboardingCompleted: true,
      displayName: input.displayName,
      proactiveContactEnabled: input.proactiveContactEnabled,
      allowedContentTypes: input.allowedContentTypes,
      recallEnabled: input.recallEnabled,
      personalizationEnabled: input.personalizationEnabled,
      memoryEnabled: input.memoryEnabled,
      quietHours: input.quietHours,
      weeklyContactLimit: input.weeklyContactLimit,
    });
    Object.assign(preview.relationship, {
      proactiveContactEnabled: input.proactiveContactEnabled,
      allowedContentTypes: input.allowedContentTypes,
      personalizationEnabled: input.personalizationEnabled,
      memoryEnabled: input.memoryEnabled,
      quietHours: input.quietHours,
      weeklyContactLimit: input.weeklyContactLimit,
    });
    if (!input.memoryEnabled) {
      preview.memories = [];
      for (const message of preview.messages) {
        message.trace.memoryIds = [];
        message.action = undefined;
      }
    }
    setCompanionData(preview);
  };

  return (
    <main
      className={`desktop-pet-shell pet-state-${petActivity.state}`}
      aria-label="三月七桌面伙伴"
      onPointerDown={beginWindowDrag}
      onPointerMove={moveWindowDrag}
      onPointerUp={endWindowDrag}
      onPointerCancel={endWindowDrag}
      onContextMenu={(event) => {
        event.preventDefault();
        window.marchDesktop?.showContextMenu();
      }}
    >
      <div
        className="drag-handle"
        aria-label="拖动桌宠窗口"
        aria-hidden={modalActive}
        inert={modalActive}
      >
        <span />
      </div>

      <nav
        className="window-controls"
        aria-label="窗口控制"
        aria-hidden={modalActive}
        inert={modalActive}
      >
        <button
          className={`icon-button ${settingsOpen ? "selected" : ""}`}
          type="button"
          title="模型设置"
          aria-label="模型设置"
          onClick={toggleSettings}
        >
          <GearSix weight={settingsOpen ? "fill" : "regular"} />
        </button>
        <button
          className={`icon-button ${
            ttsSettings?.enabled &&
            ttsSettings.hasApiKey &&
            ttsSettings.voiceRightsConfirmed
              ? "selected"
              : ""
          }`}
          type="button"
          title={
            !ttsSettings?.hasApiKey ||
            !ttsSettings.voiceRightsConfirmed
              ? "设置 CosyVoice 语音"
              : ttsSettings.enabled
                ? "关闭语音"
                : "开启语音"
          }
          aria-label={
            !ttsSettings?.hasApiKey ||
            !ttsSettings.voiceRightsConfirmed
              ? "设置语音"
              : ttsSettings.enabled
                ? "关闭语音"
                : "开启语音"
          }
          disabled={!window.marchDesktop?.tts}
          onClick={toggleVoice}
        >
          {ttsSettings?.enabled &&
          ttsSettings.hasApiKey &&
          ttsSettings.voiceRightsConfirmed ? (
            <SpeakerHigh weight="fill" />
          ) : (
            <SpeakerSlash />
          )}
        </button>
        <button
          className="icon-button"
          type="button"
          title={
            desktopStatus?.trayAvailable
              ? "开启点击穿透（从系统托盘恢复）"
              : "系统托盘不可用，不能安全开启点击穿透"
          }
          aria-label="开启点击穿透"
          disabled={
            !window.marchDesktop ||
            desktopStatus?.trayAvailable !== true
          }
          onClick={() => void enableClickThrough()}
        >
          <CursorClick />
        </button>
        <button
          className="icon-button"
          type="button"
          title={pinned ? "取消置顶" : "保持置顶"}
          aria-label={pinned ? "取消置顶" : "保持置顶"}
          onClick={togglePin}
        >
          {pinned ? <PushPin weight="fill" /> : <PushPinSlash />}
        </button>
        <button
          className="icon-button"
          type="button"
          title="最小化"
          aria-label="最小化"
          onClick={() => window.marchDesktop?.minimize()}
        >
          <Minus weight="bold" />
        </button>
        <button
          className="icon-button close-button"
          type="button"
          title="关闭"
          aria-label="关闭"
          onClick={() => window.marchDesktop?.close()}
        >
          <X weight="bold" />
        </button>
      </nav>

      <section
        className="speech-area"
        aria-live="polite"
        aria-hidden={modalActive}
        inert={modalActive}
      >
        <motion.div
          className={`speech-bubble mood-${mood} ${
            revealing ? "is-revealing" : ""
          }`}
          key={revealing ? "revealing-reply" : bubble}
          initial={{ opacity: 0, y: 8, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: "spring", stiffness: 360, damping: 24 }}
        >
          <div className="bubble-meta">
            <span>三月七</span>
            <div className="bubble-actions">
              <span className="mood-chip">
                <Sparkle weight="fill" />
                {moodLabel[mood]}
              </span>
              <SpeechPlayButton
                text={bubbleSpeechText}
                activeText={activeVoiceText}
                voiceState={voiceState}
                configured={Boolean(
                  ttsSettings?.hasApiKey &&
                    ttsSettings.enabled &&
                    ttsSettings.voiceRightsConfirmed,
                )}
                desktopAvailable={Boolean(window.marchDesktop?.tts)}
                className="bubble-speech-button"
                onToggle={() =>
                  toggleSpeech(bubbleSpeechText, mood)
                }
              />
            </div>
          </div>
          <p>{bubble}</p>
        </motion.div>
      </section>

      <section
        className={`pet-stage ${
          voiceState === "speaking" ? "is-speaking" : ""
        }`}
        aria-hidden={modalActive}
        inert={modalActive}
      >
        <div
          className={`desktop-state-chip ${
            petActivity.quiet ? "quiet" : ""
          }`}
          title={petActivity.detail}
          aria-label={`桌宠状态：${petActivity.label}`}
        >
          <span />
          {petActivity.label}
        </div>
        <motion.button
          className="character-button"
          type="button"
          aria-label="和三月七打招呼"
          title="单击互动，也可以拖动窗口"
          onClick={surpriseMe}
          whileHover={{ y: -2, scale: 1.025 }}
          transition={{ duration: 0.18 }}
          whileTap={{ scale: 0.985 }}
        >
          <img
            src="./assets/march7th-pet.png"
            alt="手持相机、挥手打招呼的三月七 Q 版桌宠"
            draggable={false}
          />
        </motion.button>

        <div className="quick-actions" aria-label="快捷互动">
          <button type="button" onClick={takePhoto}>
            <Camera weight="fill" />
            拍照
          </button>
          <button
            type="button"
            className={albumOpen ? "active" : ""}
            disabled={!companionData}
            onClick={toggleAlbum}
          >
            <BookOpenText weight="fill" />
            相册
          </button>
          <button
            type="button"
            className={communicationOpen ? "active" : ""}
            disabled={!companionData}
            onClick={toggleCommunication}
          >
            <EnvelopeSimple weight="fill" />
            通信
            {unreadMessageCount > 0 && (
              <span
                className="quick-action-badge"
                aria-label={`${unreadMessageCount} 条未读通信`}
              >
                {unreadMessageCount}
              </span>
            )}
          </button>
          <button
            type="button"
            className={companionSettingsOpen ? "active" : ""}
            disabled={!companionData}
            onClick={toggleCompanionSettings}
          >
            <SlidersHorizontal weight="bold" />
            同行
          </button>
          {pendingPhoto && (
            <button
              type="button"
              className="save-photo-action"
              disabled={!window.marchDesktop?.companion}
              onClick={() => void savePhotoToAlbum()}
            >
              <BookmarkSimple weight="fill" />
              收进相册
            </button>
          )}
          <button
            type="button"
            className={chatOpen ? "active" : ""}
            onClick={toggleChat}
          >
            <ChatCircleDots weight="fill" />
            聊天
          </button>
        </div>
      </section>

      <Suspense fallback={null}>
        <AnimatePresence>
          {companionData &&
            !companionData.profile.onboardingCompleted && (
              <CompanionOnboarding onComplete={completeOnboarding} />
            )}

          {chatOpen && (
          <motion.section
            className="chat-panel"
            role="dialog"
            aria-modal="true"
            aria-label="和三月七聊天"
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 18, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 360, damping: 28 }}
          >
            <header className="chat-panel-header">
              <span>{modelReady ? "DeepSeek 对话" : "本地对话"}</span>
              <button
                type="button"
                className="chat-panel-close"
                aria-label="关闭聊天"
                title="关闭聊天"
                onClick={() => setChatOpen(false)}
              >
                <X weight="bold" />
              </button>
            </header>
            <div ref={messageListRef} className="message-list">
              {messages.slice(-5).map((message) =>
                message.role === "march" ? (
                  <div
                    key={message.id}
                    className="message-row march"
                  >
                    <p
                      className={`message march ${
                        revealingMessageId === message.id
                          ? "is-revealing"
                          : ""
                      }`}
                    >
                      {message.text}
                    </p>
                    <SpeechPlayButton
                      text={message.speechText ?? message.text}
                      activeText={activeVoiceText}
                      voiceState={voiceState}
                      configured={Boolean(
                        ttsSettings?.hasApiKey &&
                          ttsSettings.enabled &&
                          ttsSettings.voiceRightsConfirmed,
                      )}
                      desktopAvailable={Boolean(
                        window.marchDesktop?.tts,
                      )}
                      className="message-speech-button"
                      onToggle={() =>
                        toggleSpeech(
                          message.speechText ?? message.text,
                          message.mood ??
                            inferMood(
                              message.speechText ?? message.text,
                            ),
                        )
                      }
                    />
                  </div>
                ) : (
                  <p
                    key={message.id}
                    className="message you"
                  >
                    {message.text}
                  </p>
                ),
              )}
            </div>
            {memoryCandidate && (
              <aside className="memory-candidate-card" aria-live="polite">
                <div>
                  <strong>{memoryCandidate.title}</strong>
                  <p>{memoryCandidate.summary}</p>
                  <small>确认前不会进入长期记忆，也不会用于发行内容。</small>
                </div>
                <div>
                  <button
                    type="button"
                    disabled={memoryDecisionBusy}
                    onClick={() => void resolveMemoryCandidate(false)}
                  >
                    不保存
                  </button>
                  <button
                    type="button"
                    className="confirm"
                    disabled={memoryDecisionBusy}
                    onClick={() => void resolveMemoryCandidate(true)}
                  >
                    让咱记住
                  </button>
                </div>
              </aside>
            )}
            <form className="chat-form" onSubmit={submitMessage}>
              <input
                ref={inputRef}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                maxLength={120}
                disabled={sending}
                aria-label="想和三月七说什么"
                placeholder="想和咱说什么？"
              />
              <button type="submit" disabled={sending} aria-label="发送">
                {sending ? (
                  <SpinnerGap className="spin" />
                ) : (
                  <PaperPlaneTilt weight="fill" />
                )}
              </button>
            </form>
            <p className={`local-note source-${replySource}`}>
              {statusText}
            </p>
          </motion.section>
          )}

          {settingsOpen && (
          <ModelSettingsPanel
            onClose={() => setSettingsOpen(false)}
            onReadyChange={handleModelReadyChange}
            onTtsSettingsChange={handleTtsSettingsChange}
          />
          )}

          {albumOpen && companionData && (
          <AlbumPanel
            data={companionData}
            onClose={() => setAlbumOpen(false)}
            onDataChange={setCompanionData}
          />
          )}

          {communicationOpen && companionData && (
          <CommunicationCenter
            data={companionData}
            onClose={() => setCommunicationOpen(false)}
            onDataChange={setCompanionData}
            onOpenAlbum={() => {
              setCommunicationOpen(false);
              setAlbumOpen(true);
            }}
          />
          )}

          {companionSettingsOpen && companionData && (
          <CompanionSettingsPanel
            data={companionData}
            desktopStatus={desktopStatus}
            onClose={() => setCompanionSettingsOpen(false)}
            onDataChange={setCompanionData}
            onDesktopStatusChange={setDesktopStatus}
          />
          )}

        </AnimatePresence>
      </Suspense>
    </main>
  );
}

export default App;
