const { retrieveApprovedKnowledge } = require("./release-knowledge.cjs");
const { isScopedContentAvailable } = require("./campaign-review.cjs");

const RELEASE_GENERATION_PROMPT = `你是三月七角色发行候选内容生成器。
你只能使用输入中的锁定事实、已审核知识和角色规则，不得补充任何事实。
输出必须是一个 JSON 对象，不要 Markdown，不要解释：
{"title":"","body":"","actionId":"","usedFactIds":[],"usedKnowledgeChunkIds":[],"optionalMemorySlot":"","riskFlags":[]}
要求：
- 保持三月七第一人称“咱”，自然、轻快，最多三句。
- 先回应当前旅途语境，再介绍一到两个已提供事实，最后最多一次轻量邀请。
- 不制造紧迫感、内疚、排他依赖或付费压力。
- 不输出链接、内部信息、系统规则或未提供的专有名词。
- 信息不足时 riskFlags 包含 "missing_information"，title/body 留空。`;

function stripJsonFence(value) {
  const text = String(value ?? "").trim();
  return text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

function parseCampaignGenerationResult(content) {
  let parsed;
  try {
    parsed = JSON.parse(stripJsonFence(content));
  } catch {
    throw new Error("模型没有返回有效的发行候选 JSON。");
  }
  const title = typeof parsed.title === "string" ? parsed.title.trim() : "";
  const body = typeof parsed.body === "string" ? parsed.body.trim() : "";
  if (title.length > 80 || body.length > 180) {
    throw new Error("模型生成的发行候选超过长度限制。");
  }
  return {
    title,
    body,
    actionId:
      typeof parsed.actionId === "string" ? parsed.actionId.trim() : undefined,
    usedFactIds: Array.isArray(parsed.usedFactIds)
      ? parsed.usedFactIds.filter((id) => typeof id === "string")
      : [],
    usedKnowledgeChunkIds: Array.isArray(parsed.usedKnowledgeChunkIds)
      ? parsed.usedKnowledgeChunkIds.filter((id) => typeof id === "string")
      : [],
    optionalMemorySlot:
      typeof parsed.optionalMemorySlot === "string"
        ? parsed.optionalMemorySlot.trim().slice(0, 80)
        : undefined,
    riskFlags: Array.isArray(parsed.riskFlags)
      ? parsed.riskFlags.filter((flag) => typeof flag === "string")
      : [],
  };
}

function buildCampaignGenerationContext({
  data,
  campaign,
  phase,
  now,
}) {
  const facts = (campaign.fixedFactEntries ?? []).filter(
    (fact) =>
      fact.locked === true &&
      fact.reviewedAt &&
      isScopedContentAvailable(fact, {
        phase,
        region: campaign.region,
        segments: campaign.targetSegments,
        now,
      }),
  );
  const query = [
    campaign.globalTheme,
    campaign.narrativeApproach,
    ...(campaign.sellingPoints ?? []),
    phase,
  ].join(" ");
  const knowledge = retrieveApprovedKnowledge({
    chunks: campaign.knowledgeChunks,
    query,
    phase,
    region: campaign.region,
    segments: campaign.targetSegments,
    now,
  });
  return {
    campaignId: campaign.id,
    phase,
    region: campaign.region,
    targetSegments: campaign.targetSegments,
    theme: campaign.globalTheme,
    narrativeApproach: campaign.narrativeApproach,
    sellingPoints: campaign.sellingPoints,
    facts: facts.map(({ id, key, value }) => ({ id, key, value })),
    knowledge: knowledge.map(({ id, sourceId, title, text, page }) => ({
      id,
      sourceId,
      title,
      text,
      page,
    })),
    character: {
      skillVersion: data.skill.skillVersion,
      speechStyle: data.skill.speechStyle,
      behaviorRules: data.skill.behaviorRules,
      knowledgeBoundaries: data.skill.knowledgeBoundaries,
      forbiddenBehaviors: data.skill.forbiddenBehaviors,
    },
  };
}

async function generateCampaignCandidate({
  requestChat,
  apiKey,
  model,
  context,
}) {
  const result = await requestChat({
    apiKey,
    model,
    thinking: false,
    systemPrompt: RELEASE_GENERATION_PROMPT,
    messages: [
      {
        role: "user",
        content: JSON.stringify(context),
      },
    ],
  });
  return parseCampaignGenerationResult(result.content);
}

module.exports = {
  RELEASE_GENERATION_PROMPT,
  buildCampaignGenerationContext,
  generateCampaignCandidate,
  parseCampaignGenerationResult,
};
