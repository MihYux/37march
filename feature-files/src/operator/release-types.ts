export type OperatorRole = "release_lead" | "character_ops" | "reviewer";
export interface RegionDefinition {
  id: string; code: string; name: string; language: string; timeZone: string;
  quietHours: { start: string; end: string };
  releaseAgents: Array<{ id: string; name: string; description: string; enabled: boolean }>;
}
export interface LocalOperatorProfile { id: string; name: string; role: OperatorRole }
export interface ExecutabilityGate { objective: boolean; evidence: boolean; consent: boolean; reviewer: boolean; timeWindow: boolean }
export interface ReleaseFact { id: string; label: string; value: string; source: string }
export interface ReleaseTask {
  id: string; regionId: string; title: string; objective: string; theme: string; narrative: string;
  facts: ReleaseFact[]; ownerId: string; reviewerId: string; timeWindow: string;
  status: "draft" | "ready"; gate: ExecutabilityGate; createdAt: string; updatedAt: string;
  sourceDocument?: { id: string; name: string; format: string; importedAt: string; chunkCount: number };
}
export interface AnonymousPlayerSample { alias: string; relationshipStage: string; authorizedMemory: string }
export interface AudienceSegment {
  id: string; regionId: string; taskId: string; name: string; eligible: number; authorized: number;
  reachable: number; excluded: number; fatigue: "low" | "medium" | "high"; conflicts: string;
  criteria: string; samples: AnonymousPlayerSample[];
}
export type InteractionResponse = "interested" | "inquiry" | "cold" | "refuse";
export interface InteractionPath {
  id: string; depth: "light" | "standard" | "deep"; name: string; opening: string;
  branches: Record<InteractionResponse, string>; paused: boolean;
}
export interface CharacterDirective {
  id: string; regionId: string; taskId: string; version: number;
  status: "draft" | "approved" | "returned" | "forbidden" | "escalated";
  createdBy: string; createdAt: string; reviewedAt?: string; reviewedBy?: string; reviewNote?: string;
  goal: string; theme: string; tone: string; forbidden: string; memoryDepth: string;
  successBoundary: string; evidence: Array<{ label: string; value: string; source: string }>;
  riskLevel: "low" | "medium" | "high"; paths: InteractionPath[];
}
export interface ReviewCase { id: string; regionId: string; directiveId: string; reviewerId: string; decision: string; note: string; reviewedAt: string }
export interface ExperimentGroup { id: "control" | "template" | "symbiotic" | "silent"; allocation: number; paused: boolean }
export interface Experiment {
  id: string; regionId: string; taskId: string; directiveId: string; name: string;
  stage: "internal" | "one_percent" | "five_percent" | "expanded";
  status: "active" | "paused" | "withdrawn"; groups: ExperimentGroup[];
  pathRollouts: Record<string, number>; thresholds: Record<string, number>; createdAt: string;
  kind?: "regional_plan"; planRolloutPercent?: number;
}
export interface MetricObservation {
  id: string; regionId: string; experimentId: string; date: string; groupId: string;
  segmentId: string; memoryDepth: string; delivered: number; read: number; replied: number;
  clicked: number; participated: number; unsubscribed: number; blocked: number; complaints: number;
  continuedConversation: number; proactiveConversation: number;
}
export interface EvaluationSnapshot {
  id: string; regionId: string; experimentId: string; createdAt: string;
  recommendation: "expand" | "observe" | "optimize" | "pause" | "rollback";
  reason: string; calculated: Record<string, number>;
}
export interface OptimizationRevision {
  id: string; regionId: string; experimentId: string; directiveId: string;
  fromVersion: number; toVersion: number; reason: string; changes: string; createdAt: string;
}
export interface AuditEntry {
  id: string; occurredAt: string; regionId: string; operatorId: string; operatorName: string;
  role: OperatorRole; action: string; entityType: string; entityId: string; reason: string;
}
export interface RegionWorkspace {
  regionId: string; tasks: ReleaseTask[]; segments: AudienceSegment[]; directives: CharacterDirective[];
  reviews: ReviewCase[]; experiments: Experiment[]; metrics: MetricObservation[];
  evaluations: EvaluationSnapshot[]; optimizations: OptimizationRevision[];
  bundles: Array<{ id: string; regionId: string; directiveId: string; createdAt: string; checksum: string }>;
  planSources: Array<{ id: string; name: string; format: string; importedAt: string; chunkCount: number; regionId: string; taskId: string; status: string; content?: string }>;
  planReleases: Array<{ id: string; batchId: string; experimentId: string; regionId: string; taskId: string; rolloutPercent: number; exampleMode?: boolean; status: "published"; publishedAt: string }>;
  aiDeliveries: Array<{
    id: string; batchId: string; taskId: string; agentId: string; agentName: string;
    status: "delivered"; publishedAt: string; pathRollouts: Record<string, number>; rolloutPercent: number;
  }>;
  emergencyStoppedAt: string | null;
}
export interface ReleaseWorkspaceSnapshot {
  schemaVersion: number; createdAt: string; updatedAt: string; activeRegionId: string;
  activeOperatorId: string; regions: RegionDefinition[]; operators: LocalOperatorProfile[];
  workspaces: Record<string, RegionWorkspace>; auditLog: AuditEntry[]; migrations: Record<string, unknown>;
}
export interface ReleaseTaskInput {
  id?: string; title: string; objective: string; theme: string; narrative: string; facts: ReleaseFact[];
  ownerId: string; reviewerId?: string; timeWindow: string; consentConfirmed: boolean;
}
