export type DeepSeekModel = "deepseek-v4-flash" | "deepseek-v4-pro";

export interface AiPublicSettings {
  provider: "deepseek";
  baseUrl: "https://api.deepseek.com";
  model: DeepSeekModel;
  thinking: boolean;
  hasApiKey: boolean;
  keySource: "environment" | "secure-storage" | "session" | "none";
  secureStorageAvailable: boolean;
}

export interface AiSettingsInput {
  model: DeepSeekModel;
  thinking: boolean;
  apiKey?: string;
}

export interface AiConversationMessage {
  role: "user" | "assistant";
  content: string;
}

export interface MemoryCandidateSummary {
  id: string;
  title: string;
  summary: string;
  characterText: string;
  category?: string;
}

export type AiChatResult =
  | {
      ok: true;
      content: string;
      model: string;
      usage?: {
        promptTokens: number;
        completionTokens: number;
      };
      safety?: {
        filtered: boolean;
        ruleIds: Array<string | null>;
      };
      memoryCandidate?: MemoryCandidateSummary;
    }
  | {
      ok: false;
      error: string;
      code?: string;
    };

export type AiConnectionResult =
  | {
      ok: true;
      message: string;
      model: string;
    }
  | {
      ok: false;
      error: string;
      code?: string;
    };

export type TtsKeySource =
  | "environment"
  | "secure-storage"
  | "session"
  | "macos-keychain"
  | "none";

export interface TtsPublicSettings {
  provider: "dashscope";
  baseUrl: string;
  model: string;
  voiceId: string;
  enabled: boolean;
  autoPlay: boolean;
  volume: number;
  rate: number;
  voiceRightsConfirmed: boolean;
  hasApiKey: boolean;
  keySource: TtsKeySource;
  secureStorageAvailable: boolean;
}

export interface TtsSettingsInput {
  enabled?: boolean;
  autoPlay?: boolean;
  volume?: number;
  rate?: number;
  voiceRightsConfirmed?: boolean;
  apiKey?: string;
}

export interface ServiceProviderUsage {
  requests: number;
  requestLimit: number;
  characters: number;
  characterLimit: number;
  failures: number;
  circuitOpen: boolean;
  circuitOpenUntil: string;
}

export interface ServiceUsageStatus {
  day: string;
  providers: {
    deepseek: ServiceProviderUsage;
    dashscope: ServiceProviderUsage;
  };
}

export type TtsAudioResult =
  | {
      ok: true;
      audioBase64: string;
      mimeType: string;
      characters: number;
      model: string;
      voiceId: string;
    }
  | {
      ok: false;
      error: string;
      code?: string;
    };

export type TtsStreamStartResult =
  | {
      ok: true;
      requestId: string;
      sampleRate: number;
    }
  | {
      ok: false;
      error: string;
      code?: string;
    };

export type TtsStreamEvent =
  | {
      requestId: string;
      type: "started";
      sampleRate: number;
    }
  | {
      requestId: string;
      type: "sentence";
      index: number;
      text: string;
    }
  | {
      requestId: string;
      type: "audio";
      audioBase64: string;
      index: number;
      sampleRate: number;
    }
  | {
      requestId: string;
      type: "complete";
      characters: number;
      audioChunks: number;
      audioBytes: number;
      firstChunkMs: number;
      sampleRate: number;
      model: string;
      voiceId: string;
    }
  | {
      requestId: string;
      type: "canceled";
    }
  | {
      requestId: string;
      type: "error";
      error: string;
      code?: string;
    };
