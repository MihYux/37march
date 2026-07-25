import type { ReleaseTaskInput, ReleaseWorkspaceSnapshot } from "./release-types";
export type ReviewDecision = "approved" | "approved_with_changes" | "returned" | "forbidden" | "escalated";
export interface ReleaseOperatorApi {
  [legacyMethod: string]: (...args: any[]) => any;
  getSnapshot: () => Promise<ReleaseWorkspaceSnapshot>;
  switchRegion: (regionId: string) => Promise<ReleaseWorkspaceSnapshot>;
  setOperator: (operatorId: string) => Promise<ReleaseWorkspaceSnapshot>;
  addRegion: (input: { code: string; name: string; language: string; timeZone: string; quietHours: { start: string; end: string } }) => Promise<ReleaseWorkspaceSnapshot>;
  updateRegion: (regionId: string, input: { code: string; name: string; language: string; timeZone: string; quietHours: { start: string; end: string } }) => Promise<ReleaseWorkspaceSnapshot>;
  saveTask: (regionId: string, input: ReleaseTaskInput) => Promise<ReleaseWorkspaceSnapshot>;
  importPlan: (regionId: string, taskId?: string) => Promise<{
    canceled: boolean; data: ReleaseWorkspaceSnapshot; taskId?: string;
    source?: { name: string; format: string; importedAt: string; chunkCount: number };
  }>;
  generateDirective: (regionId: string, taskId: string, input: { goal: string; tone: string; forbidden: string; memoryDepth: string; successBoundary: string }) => Promise<ReleaseWorkspaceSnapshot>;
  setDirectivePathPaused: (regionId: string, directiveId: string, pathId: string, paused: boolean) => Promise<ReleaseWorkspaceSnapshot>;
  reviewDirective: (regionId: string, directiveId: string, decision: ReviewDecision, note: string) => Promise<ReleaseWorkspaceSnapshot>;
  saveExperiment: (regionId: string, input: Record<string, unknown>) => Promise<ReleaseWorkspaceSnapshot>;
  publishToAgents: (regionId: string, directiveId: string, experimentId: string) => Promise<ReleaseWorkspaceSnapshot>;
  publishPlanToAgents: (regionId: string, taskId: string, rolloutPercent: number) => Promise<ReleaseWorkspaceSnapshot>;
  publishExamplePlan: (regionId: string, taskId: string) => Promise<ReleaseWorkspaceSnapshot>;
  importMetrics: (regionId: string, experimentId: string, text: string) => Promise<ReleaseWorkspaceSnapshot>;
  importMetricsFile: (regionId: string, experimentId: string) => Promise<{ canceled: boolean; data: ReleaseWorkspaceSnapshot }>;
  setExperimentStage: (regionId: string, experimentId: string, action: "advance" | "pause" | "rollback" | "withdraw") => Promise<ReleaseWorkspaceSnapshot>;
  setExperimentGroupPaused: (regionId: string, experimentId: string, groupId: string, paused: boolean) => Promise<ReleaseWorkspaceSnapshot>;
  setEmergencyStop: (regionId: string, enabled: boolean, reason: string) => Promise<ReleaseWorkspaceSnapshot>;
  createOptimization: (regionId: string, experimentId: string, reason: string) => Promise<ReleaseWorkspaceSnapshot>;
  exportBundle: (regionId: string, directiveId: string) => Promise<{ canceled: boolean; filePath?: string; data: ReleaseWorkspaceSnapshot }>;
  deliverTest: (regionId: string, directiveId: string, pathId: string) => Promise<ReleaseWorkspaceSnapshot>;
  close: () => void;
}
