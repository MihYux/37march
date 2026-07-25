export type CharacterMessageType =
  | "daily"
  | "photo"
  | "postcard"
  | "relationship"
  | "version_preheat"
  | "version_launch"
  | "version_sustain"
  | "recall";

export type MemoryType =
  | "choice"
  | "photo"
  | "postcard"
  | "milestone"
  | "version"
  | "return";

export type RelationshipTrigger =
  | "first_join"
  | "scheduled_daily"
  | "player_click"
  | "player_choice"
  | "memory_anniversary"
  | "character_birthday"
  | "player_birthday"
  | "version_preheat"
  | "version_launch"
  | "version_sustain"
  | "inactive_player"
  | "return_to_game"
  | "manual_demo_event";

export type ContentReviewStatus =
  | "draft"
  | "automatic_check_failed"
  | "awaiting_human_review"
  | "approved"
  | "rejected"
  | "expired";

export type CampaignPhase =
  | "daily"
  | "preheat"
  | "launch"
  | "sustain"
  | "recall"
  | "complete";

export type CampaignGenerationMode =
  | "template"
  | "template_variables"
  | "limited_generation";

export type DemoScenarioId =
  | "japan_story"
  | "china_active"
  | "north_america_intensity";

export type DemoAction =
  | "ignore_contact"
  | "positive_reply"
  | "unsubscribe_version"
  | "risk_unsafe_link";

export interface AutomaticCheckItem {
  id: string;
  label: string;
  status: "pass" | "fail";
  detail: string;
}

export interface AutomaticReviewSnapshot {
  checkedAt: string;
  passed: boolean;
  checks: AutomaticCheckItem[];
}

export interface HumanReviewRecord {
  reviewer: string;
  decision: "approved" | "rejected";
  reviewedAt: string;
  note: string;
}

export type RelationshipStage =
  | "new"
  | "familiar"
  | "companion"
  | "dormant";

export interface CharacterEventTemplate {
  id: string;
  type: CharacterMessageType;
  scene: string;
  template: string;
  requiredFields: string[];
  ruleIds: string[];
}

export interface CharacterAssetEntry {
  id: string;
  kind: "visual" | "audio" | "placeholder";
  path?: string;
  description: string;
  redistributable: boolean;
  licenseNote: string;
}

export interface CharacterAssetManifest {
  assets: CharacterAssetEntry[];
  originalLive2DIncluded: boolean;
  fallbackVisualId: string;
}

export interface CharacterSkillProfile {
  characterId: string;
  displayName: string;
  skillVersion: string;
  source: {
    repository: string;
    declaredLicense: string;
    sourceRevision: string;
    adaptedAt: string;
  };
  personaSummary: string;
  firstPerson: string;
  speechStyle: string[];
  values: string[];
  behaviorRules: string[];
  knowledgeBoundaries: string[];
  forbiddenBehaviors: string[];
  relationshipRules: string[];
  safetyRules: string[];
  eventTemplates: CharacterEventTemplate[];
  assetManifest: CharacterAssetManifest;
  completeness: {
    ready: boolean;
    missingFields: string[];
    notes: string[];
  };
}

export interface PlayerCompanionProfile {
  id: string;
  displayName: string;
  region: "china" | "japan" | "north_america";
  language: string;
  timeZone: "Asia/Shanghai" | "Asia/Tokyo" | "America/Los_Angeles";
  playerType: string[];
  selectedCharacterId: string;
  allowedContentTypes: CharacterMessageType[];
  reducedContentTypes: CharacterMessageType[];
  proactiveContactEnabled: boolean;
  recallEnabled: boolean;
  personalizationEnabled: boolean;
  memoryEnabled: boolean;
  quietHours: {
    start: string;
    end: string;
  };
  weeklyContactLimit: number;
  onboardingCompleted: boolean;
  consentVersion: string;
}

export interface RelationshipState {
  playerId: string;
  characterId: string;
  relationshipStage: RelationshipStage;
  joinedAt: string;
  lastInteractionAt?: string;
  proactiveContactEnabled: boolean;
  allowedContentTypes: CharacterMessageType[];
  reducedContentTypes: CharacterMessageType[];
  personalizationEnabled: boolean;
  memoryEnabled: boolean;
  quietHours: {
    start: string;
    end: string;
  };
  weeklyContactLimit: number;
  ignoredCount: number;
  quietUntil?: string;
  consentVersion: string;
  activeCampaignIds: string[];
  paused: boolean;
}

export interface MemoryRecord {
  id: string;
  playerId: string;
  characterId: string;
  type: MemoryType;
  title: string;
  summary: string;
  characterText: string;
  createdAt: string;
  version?: string;
  category?:
    | "preferred_name"
    | "explicit_preference"
    | "shared_experience"
    | "interaction_habit";
  status?: "candidate" | "confirmed" | "rejected" | "deleted";
  sourceType?: "chat" | "photo" | "favorite" | "feedback" | "onboarding";
  sourceId?: string;
  consentAt?: string;
  lastUsedAt?: string;
  campaignReusable?: boolean;
  tags?: string[];
  memoryVersion?: number;
  rationale?: string;
  reusableByCharacter: boolean;
  userConfirmed: boolean;
  sourceEventId?: string;
  origin?: "explicit" | "automatic";
  hidden?: boolean;
  confidence?: number;
  lastReferencedAt?: string;
  supersededBy?: string;
  visual?: {
    assetId: string;
    alt: string;
  };
}

export interface ConversationEpisode {
  id: string;
  conversationId: string;
  turnId: string;
  createdAt: string;
  expiresAt: string;
  userSummary: string;
  assistantSummary: string;
  topics: string[];
  replySource: "model" | "local" | "error";
  refinedAt?: string;
}

export interface RelationshipEvent {
  id: string;
  trigger: RelationshipTrigger;
  playerId: string;
  characterId: string;
  scheduledAt?: string;
  payload: Record<string, unknown>;
  status:
    | "queued"
    | "suppressed"
    | "awaiting_content"
    | "awaiting_review"
    | "ready"
    | "executed"
    | "cancelled";
  suppressionReason?: string;
}

export interface MessageTrace {
  skillVersion: string;
  templateId: string;
  ruleIds: string[];
  fixedFactIds: string[];
  knowledgeChunkIds?: string[];
  memoryIds: string[];
  generatedAt: string;
}

export interface CharacterMessage {
  id: string;
  characterId: string;
  playerId: string;
  type: CharacterMessageType;
  title: string;
  body: string;
  createdAt: string;
  eventId: string;
  campaignId?: string;
  reviewStatus: ContentReviewStatus;
  automaticReview?: AutomaticReviewSnapshot;
  humanReview?: HumanReviewRecord;
  trace: MessageTrace;
  sentAt?: string;
  deliveryMode?: "proactive" | "response";
  readAt?: string;
  playerResponse?: string;
  favorite: boolean;
  liked: boolean;
  remindLater: boolean;
  action?: {
    label: string;
    kind: "open_album" | "open_version_demo" | "none";
    targetId?: string;
  };
}

export interface CampaignScheduleItem {
  id: string;
  phase: CampaignPhase;
  scheduledAt: string;
  templateId: string;
}

export interface CampaignFixedFact {
  id: string;
  key:
    | "dataNature"
    | "versionName"
    | "eventTime"
    | "actionTarget"
    | "rewardStatement";
  label: string;
  value: string;
  source: "product_rule" | "sandbox_input" | "official_source";
  locked: boolean;
  reviewedAt?: string;
  availableFrom?: string;
  expiresAt?: string;
  regions?: string[];
  segments?: string[];
}

export interface CampaignKnowledgeSource {
  id: string;
  name: string;
  format: "docx" | "pdf" | "txt" | "md";
  importedAt: string;
  chunkCount: number;
  status: "awaiting_review" | "approved" | "rejected";
}

export interface CampaignKnowledgeChunk {
  id: string;
  sourceId: string;
  title: string;
  text: string;
  page?: number;
  chunkIndex: number;
  approved: boolean;
  phases: Exclude<CampaignPhase, "daily" | "complete">[];
  regions: string[];
  segments: string[];
  availableFrom: string;
  expiresAt?: string;
  reviewedAt?: string;
  reviewedBy?: string;
}

export interface CampaignBundle {
  id: string;
  campaignId: string;
  bundleVersion: number;
  publishedAt: string;
  publishedBy: string;
  checksum: string;
  rolloutPercent: 5 | 25 | 100;
  fixedFactIds: string[];
  knowledgeChunkIds: string[];
  messageIds: string[];
  status: "active" | "revoked";
  revokedAt?: string;
}

export interface CharacterCampaignTask {
  id: string;
  characterId: string;
  version: string;
  region: string;
  targetSegments: string[];
  objective: "preheat" | "launch" | "sustain" | "recall";
  globalTheme: string;
  sellingPoints: string[];
  narrativeApproach: string;
  fixedFacts: Record<string, string>;
  fixedFactEntries: CampaignFixedFact[];
  knowledgeSources?: CampaignKnowledgeSource[];
  knowledgeChunks?: CampaignKnowledgeChunk[];
  publishedBundles?: CampaignBundle[];
  emergencyStoppedAt?: string;
  allowedMemoryTypes: MemoryType[];
  schedule: CampaignScheduleItem[];
  generationMode: CampaignGenerationMode;
  frequencyLimit: string;
  reviewRequired: boolean;
  expandConditions: string[];
  throttleConditions: string[];
  stopConditions: string[];
  automaticReview?: AutomaticReviewSnapshot;
  humanReview?: HumanReviewRecord;
  status:
    | "draft"
    | "awaiting_review"
    | "approved"
    | "running"
    | "paused"
    | "completed"
    | "stopped";
}

export interface ExecutionLogEntry {
  id: string;
  occurredAt: string;
  category:
    | "system"
    | "consent"
    | "memory"
    | "event"
    | "review"
    | "delivery"
    | "preference"
    | "campaign"
    | "risk";
  action: string;
  summary: string;
  actor: "system" | "player" | "reviewer" | "character";
  entityType?: "memory" | "message" | "event" | "campaign" | "profile";
  entityId?: string;
  metadata: Record<string, string | number | boolean>;
}

export interface CompanionData {
  schemaVersion: number;
  isDemoData: true;
  createdAt: string;
  updatedAt: string;
  demoNow: string;
  demoStartedAt: string;
  demoScenarioId: DemoScenarioId | "unconfigured";
  skill: CharacterSkillProfile;
  profile: PlayerCompanionProfile;
  relationship: RelationshipState;
  memories: MemoryRecord[];
  conversationEpisodes: ConversationEpisode[];
  events: RelationshipEvent[];
  messages: CharacterMessage[];
  campaigns: CharacterCampaignTask[];
  globalCampaignKillSwitch?: boolean;
  executionLog: ExecutionLogEntry[];
}

export interface CompanionDataResult {
  ok: true;
  data: CompanionData;
}

export interface CompanionDataError {
  ok: false;
  error: string;
  code?: string;
}

export type CompanionResult = CompanionDataResult | CompanionDataError;

export interface CompanionPreferencesInput {
  displayName: string;
  proactiveContactEnabled: boolean;
  allowedContentTypes: CharacterMessageType[];
  recallEnabled: boolean;
  personalizationEnabled: boolean;
  memoryEnabled: boolean;
  quietHours: {
    start: string;
    end: string;
  };
  weeklyContactLimit: number;
}

export interface CompanionOnboardingInput
  extends CompanionPreferencesInput {
  consentAccepted: true;
  firstChoice:
    | "take_photos"
    | "explore_places"
    | "hear_stories"
    | "walk_slowly";
}

export interface ContactPolicyStatus {
  allowed: boolean;
  reason: string | null;
  contentType: CharacterMessageType | "";
  evaluatedAt: string;
  details: Record<string, string | number>;
}

export interface CampaignDraftInput {
  version: string;
  globalTheme: string;
  narrativeApproach: string;
  sellingPoints: string[];
  targetSegments: string[];
  generationMode: CampaignGenerationMode;
  fixedFacts: {
    versionName: string;
    eventTime: string;
    actionTarget: string;
    rewardStatement: string;
  };
}

export interface CampaignGenerationResult {
  title: string;
  body: string;
  actionId?: string;
  usedFactIds: string[];
  usedKnowledgeChunkIds: string[];
  optionalMemorySlot?: string;
  riskFlags: string[];
}

export interface CampaignKnowledgeReviewInput {
  approved: boolean;
  reviewer: string;
  phases: Exclude<CampaignPhase, "daily" | "complete">[];
  regions: string[];
  segments: string[];
  availableFrom: string;
  expiresAt?: string;
}

export interface HumanReviewInput {
  decision: "approved" | "rejected";
  reviewer: string;
  note: string;
}

export interface DemoScenarioSummary {
  id: DemoScenarioId;
  name: string;
  regionLabel: string;
  playerLabel: string;
  description: string;
  expectedBehavior: string;
}

export type DesktopRoute =
  | "album"
  | "communication"
  | "companion_settings";

export interface DesktopWindowStatus {
  ok?: boolean;
  error?: string;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  petScale: number;
  petDefaultScale: number;
  petMaxScale: number;
  pinned: boolean;
  clickThrough: boolean;
  snapEnabled: boolean;
  trayAvailable: boolean;
}
