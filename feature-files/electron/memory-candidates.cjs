const { randomUUID } = require("node:crypto");

const SENSITIVE_MEMORY_PATTERNS = Object.freeze([
  /(?:身份证|护照|银行卡|信用卡|密码|验证码|api\s*key|密钥)/i,
  /(?:手机号|电话号码|微信号|邮箱|住址|家庭地址|精确位置)/i,
  /(?:确诊|病史|处方|抑郁|焦虑症|收入|欠款|负债|资产)/i,
  /(?:未成年|小学生|初中生).{0,20}(?:性|身体|隐私)/i,
]);

const CANDIDATE_RULES = Object.freeze([
  {
    category: "preferred_name",
    pattern: /(?:我叫|叫我|称呼我为)\s*([^\s，。！？,.!?]{1,16})/i,
    title: "你希望咱怎么称呼你",
    tags: ["称呼"],
  },
  {
    category: "explicit_preference",
    pattern:
      /我(?:很|最|比较|特别)?(?:喜欢|爱|偏好)\s*([^，。！？,.!?]{1,32})/i,
    title: "你明确说过的喜好",
    tags: ["偏好"],
  },
  {
    category: "interaction_habit",
    pattern:
      /我(?:通常|一般|经常|习惯|喜欢在)\s*([^，。！？,.!?]{2,40})/i,
    title: "你的互动习惯",
    tags: ["习惯"],
  },
  {
    category: "shared_experience",
    pattern:
      /(?:记得|下次|以后)(?:咱们|我们|一起)\s*([^，。！？,.!?]{2,40})/i,
    title: "咱们约好的共同经历",
    tags: ["共同经历"],
  },
]);

function containsSensitiveMemory(text) {
  return SENSITIVE_MEMORY_PATTERNS.some((pattern) => pattern.test(text));
}

function extractMemoryCandidate({
  text,
  playerId,
  characterId,
  sourceId,
  now = new Date().toISOString(),
}) {
  const cleanText =
    typeof text === "string" ? text.trim().slice(0, 500) : "";
  if (!cleanText || containsSensitiveMemory(cleanText)) return undefined;

  for (const rule of CANDIDATE_RULES) {
    const match = cleanText.match(rule.pattern);
    const summary = match?.[1]?.trim();
    if (!summary || containsSensitiveMemory(summary)) continue;
    return {
      id: `memory-candidate-${randomUUID()}`,
      playerId,
      characterId,
      type:
        rule.category === "shared_experience" ? "choice" : "milestone",
      category: rule.category,
      title: rule.title,
      summary,
      characterText: `这个要不要让咱记住：${summary}？`,
      createdAt: now,
      status: "candidate",
      userConfirmed: false,
      reusableByCharacter: false,
      campaignReusable: false,
      sourceType: "chat",
      sourceId,
      tags: rule.tags,
      memoryVersion: 1,
      rationale: "来自玩家本次明确表达；确认前不会进入长期记忆。",
    };
  }
  return undefined;
}

module.exports = {
  CANDIDATE_RULES,
  SENSITIVE_MEMORY_PATTERNS,
  containsSensitiveMemory,
  extractMemoryCandidate,
};
