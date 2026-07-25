/// <reference types="vite/client" />

import type {
  AiChatResult,
  AiConnectionResult,
  AiConversationMessage,
  AiPublicSettings,
  AiSettingsInput,
  TtsAudioResult,
  TtsPublicSettings,
  TtsSettingsInput,
  TtsStreamEvent,
  TtsStreamStartResult,
  ServiceUsageStatus,
} from "./ai/types";
import type { ReleaseOperatorApi } from "./operator/api";
import type {
  CharacterSkillProfile,
  CompanionOnboardingInput,
  CompanionPreferencesInput,
  CompanionData,
  ContactPolicyStatus,
  RelationshipTrigger,
  CharacterMessageType,
  CampaignDraftInput,
  CampaignPhase,
  HumanReviewInput,
  MemoryRecord,
  DemoAction,
  DemoScenarioId,
  DemoScenarioSummary,
  DesktopRoute,
  DesktopWindowStatus,
} from "./domain/types";

declare global {
  interface Window {
    releaseOperator?: ReleaseOperatorApi;
    marchDesktop?: {
      minimize: () => void;
      close: () => void;
      togglePin: () => Promise<boolean>;
      getWindowPosition: () => Promise<[number, number]>;
      moveWindowTo: (position: { x: number; y: number }) => void;
      endWindowMove: () => Promise<DesktopWindowStatus>;
      getDesktopStatus: () => Promise<DesktopWindowStatus>;
      setSnapEnabled: (
        enabled: boolean,
      ) => Promise<DesktopWindowStatus>;
      setMode: (mode: "pet" | "panel") => Promise<DesktopWindowStatus>;
      setPetScale: (scale: number) => Promise<DesktopWindowStatus>;
      setPetDefaultScale: (
        scale: number,
      ) => Promise<DesktopWindowStatus>;
      show: (
        route?: DesktopRoute,
      ) => Promise<DesktopWindowStatus>;
      showContextMenu: () => void;
      reportRendererHeartbeat: () => void;
      onNavigate: (callback: (route: DesktopRoute) => void) => void;
      clearNavigateListener: () => void;
      onCompanionDataChange: (
        callback: (data: CompanionData) => void,
      ) => void;
      clearCompanionDataChangeListener: () => void;
      service: {
        getUsageStatus: () => Promise<ServiceUsageStatus>;
      };
      companion: {
        getData: () => Promise<CompanionData>;
        getSkillProfile: () => Promise<CharacterSkillProfile>;
        completeOnboarding: (
          input: CompanionOnboardingInput,
        ) => Promise<CompanionData>;
        savePreferences: (
          input: CompanionPreferencesInput,
        ) => Promise<CompanionData>;
        setPaused: (paused: boolean) => Promise<CompanionData>;
        exit: () => Promise<CompanionData>;
        deleteRelationshipData: () => Promise<CompanionData>;
        resetDemo: () => Promise<CompanionData>;
        setMemoryReusable: (
          memoryId: string,
          reusable: boolean,
        ) => Promise<CompanionData>;
        setMemoryEnabled: (enabled: boolean) => Promise<CompanionData>;
        recordConversationTurn: (input: {
          conversationId: string;
          turnId: string;
          userText: string;
          assistantText: string;
          replySource: "model" | "local" | "error";
          topics?: string[];
        }) => Promise<CompanionData>;
        proposeMemoryCandidate: (
          text: string,
          sourceId: string,
        ) => Promise<MemoryRecord | undefined>;
        resolveMemoryCandidate: (
          memoryId: string,
          confirmed: boolean,
        ) => Promise<CompanionData>;
        setMemoryCampaignReusable: (
          memoryId: string,
          reusable: boolean,
        ) => Promise<CompanionData>;
        deleteMemory: (memoryId: string) => Promise<CompanionData>;
        clearMemories: () => Promise<CompanionData>;
        createPhotoMemory: () => Promise<CompanionData>;
        exportMemories: () => Promise<
          | {
              ok: true;
              filePath: string;
            }
          | {
              ok: false;
              canceled: true;
            }
        >;
        exportData: () => Promise<
          | {
              ok: true;
              filePath: string;
            }
          | {
              ok: false;
              canceled: true;
            }
        >;
        markMessageRead: (messageId: string) => Promise<CompanionData>;
        setMessageFavorite: (
          messageId: string,
          favorite: boolean,
        ) => Promise<CompanionData>;
        setMessageLiked: (
          messageId: string,
          liked: boolean,
        ) => Promise<CompanionData>;
        setMessageRemindLater: (
          messageId: string,
          remindLater: boolean,
        ) => Promise<CompanionData>;
        respondToMessage: (
          messageId: string,
          response:
            | "like"
            | "later"
            | "not_interested"
            | "lower_frequency"
            | "unsubscribe_type",
        ) => Promise<CompanionData>;
        getContactPolicyStatus: () => Promise<ContactPolicyStatus>;
        queueEvent: (input: {
          trigger: RelationshipTrigger;
          contentType: CharacterMessageType;
          templateId?: string;
        }) => Promise<CompanionData>;
        evaluateEvent: (eventId: string) => Promise<CompanionData>;
        registerIgnoredContact: () => Promise<CompanionData>;
        registerPlayerInteraction: () => Promise<CompanionData>;
        getDemoScenarios: () => Promise<DemoScenarioSummary[]>;
        loadDemoScenario: (
          scenarioId: DemoScenarioId,
        ) => Promise<CompanionData>;
        advanceDemoTime: (input: {
          day?: 1 | 7 | 14 | 42;
          target?: string;
        }) => Promise<CompanionData>;
        triggerDemoAction: (
          action: DemoAction,
        ) => Promise<CompanionData>;
      };
      ai: {
        getSettings: () => Promise<AiPublicSettings>;
        saveSettings: (
          settings: AiSettingsInput,
        ) => Promise<AiPublicSettings>;
        clearApiKey: () => Promise<AiPublicSettings>;
        testConnection: () => Promise<AiConnectionResult>;
        chat: (request: {
          messages: AiConversationMessage[];
        }) => Promise<AiChatResult>;
      };
      tts: {
        getSettings: () => Promise<TtsPublicSettings>;
        saveSettings: (
          settings: TtsSettingsInput,
        ) => Promise<TtsPublicSettings>;
        clearApiKey: () => Promise<TtsPublicSettings>;
        test: () => Promise<TtsAudioResult>;
        synthesize: (request: {
          text: string;
          mood?: string;
        }) => Promise<TtsAudioResult>;
        startStream: (request: {
          requestId: string;
          text: string;
          mood?: string;
        }) => Promise<TtsStreamStartResult>;
        cancelStream: (requestId: string) => Promise<boolean>;
        onStreamEvent: (
          callback: (event: TtsStreamEvent) => void,
        ) => void;
        clearStreamEventListener: () => void;
      };
    };
  }
}

export {};
