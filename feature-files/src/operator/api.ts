import type {
  CampaignDraftInput,
  CampaignKnowledgeReviewInput,
  CampaignPhase,
  CompanionData,
  HumanReviewInput,
} from "../domain/types";

export interface ReleaseOperatorApi {
  getData: () => Promise<CompanionData>;
  createCampaign: (input: CampaignDraftInput) => Promise<CompanionData>;
  updateCampaign: (
    campaignId: string,
    input: CampaignDraftInput,
  ) => Promise<CompanionData>;
  submitCampaignReview: (campaignId: string) => Promise<CompanionData>;
  reviewCampaign: (
    campaignId: string,
    input: HumanReviewInput,
  ) => Promise<CompanionData>;
  setCampaignLifecycle: (
    campaignId: string,
    action: "start" | "pause" | "resume" | "stop" | "complete",
  ) => Promise<CompanionData>;
  generateCampaignMessage: (
    campaignId: string,
    phase: Exclude<CampaignPhase, "complete">,
  ) => Promise<CompanionData>;
  runMessageAutomaticReview: (messageId: string) => Promise<CompanionData>;
  reviewCampaignMessage: (
    messageId: string,
    input: HumanReviewInput,
  ) => Promise<CompanionData>;
  deliverCampaignMessage: (messageId: string) => Promise<CompanionData>;
  importDocument: (
    campaignId: string,
  ) => Promise<
    | { canceled: true; data: CompanionData }
    | { canceled: false; data: CompanionData }
  >;
  importText: (
    campaignId: string,
    title: string,
    text: string,
  ) => Promise<CompanionData>;
  reviewKnowledge: (
    campaignId: string,
    chunkId: string,
    input: CampaignKnowledgeReviewInput,
  ) => Promise<CompanionData>;
  publishBundle: (
    campaignId: string,
    publisher: string,
    rolloutPercent: 5 | 25 | 100,
  ) => Promise<CompanionData>;
  setKillSwitch: (
    enabled: boolean,
    reviewer: string,
  ) => Promise<CompanionData>;
  close: () => void;
}
