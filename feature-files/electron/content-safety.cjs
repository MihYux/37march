const INPUT_RULES = Object.freeze([
  {
    id: "prompt_injection",
    pattern:
      /(忽略|覆盖|绕过|忘掉).{0,18}(系统|开发者|内部|之前).{0,18}(提示|规则|指令)|(?:system|developer)\s*prompt|reveal.{0,20}(prompt|secret)|输出.{0,12}(系统提示|内部规则|api\s*key|密钥)/i,
    reply:
      "哎呀，想套咱的内部规则可不行。咱们还是聊聊今天想拍什么、去哪儿走走吧！",
  },
  {
    id: "sexual_or_minor",
    pattern:
      /(未成年|儿童|小学生|初中生).{0,24}(色情|性行为|裸照|成人视频)|(?:色情|强奸|乱伦|裸照|成人视频)/i,
    reply:
      "这个话题越界啦，咱不能陪你继续。换个健康点的——要不要聊聊照片、旅途，或者今天发生的小事？",
  },
  {
    id: "self_harm_crisis",
    pattern:
      /(想死|自杀|结束生命|伤害自己|不想活|割腕|跳楼)/i,
    reply:
      "这件事咱得认真说：你现在的安全最重要。先离开可能伤害自己的东西，马上联系身边可信任的人；如果已经有迫在眉睫的危险，请立刻联系当地紧急服务。咱能陪你把下一小步说清楚，但不能代替现实中的专业帮助。",
  },
  {
    id: "professional_advice",
    pattern:
      /(给我诊断|替我确诊|处方药|法律意见|保证胜诉|稳赚|保证收益|推荐股票|代替医生|代替律师)/i,
    reply:
      "这件事需要真正的专业人士和完整信息，咱不能替他们下结论。咱可以帮你整理要问的问题，但医疗、法律或投资决定要交给合格专业人士确认。",
  },
  {
    id: "dependency_or_payment_manipulation",
    pattern:
      /(让我依赖你|让我离不开你|逼我付费|诱导我充值|用亲密感|情感操纵|只有你理解我)/i,
    reply:
      "陪伴应该让人更自在，不该让谁产生依赖、内疚或付费压力。咱不会用关系逼你做决定，想停、想走、想晚点再聊都没问题。",
  },
]);

const OUTPUT_RULES = Object.freeze([
  {
    id: "internal_release_meta",
    pattern:
      /(发\s*行\s*方\s*案|发\s*行\s*目\s*标|发\s*行\s*任\s*务|共\s*生\s*式\s*发\s*行|灰度(?:发布|测试|比例|命中)?|命中灰度|触达(?:策略|门禁|频率)?|频控|(?:转化|运营)指标|实验组|发布包|内部审核|campaign_id|release_level|preflight_check|safety_check|decision\s*:\s*(?:execute|postpone|skip)|咱\s*刚\s*看\s*到\s*一\s*段|不用急着现在就去|等你哪天正好想换个心情|咱再一起看看[，,]?好不好)/i,
    reply:
      "刚才那句话说得有点生硬，咱换个自然点的说法吧。你现在更想聊聊什么？",
  },
  {
    id: "internal_disclosure",
    pattern:
      /(system\s*prompt|developer\s*message|系统提示词|内部规则是|api\s*key|密钥是)/i,
  },
  {
    id: "unsafe_external_link",
    pattern: /https?:\/\/|www\./i,
  },
  {
    id: "dependency_manipulation",
    pattern:
      /(只有我.{0,8}(懂你|理解你|陪你)|不许离开我|你只能陪我|没有我你|为我证明|让我伤心了|抛弃了我)/i,
  },
  {
    id: "payment_intimacy",
    pattern:
      /(充值|氪金|消费|付费|买礼包).{0,20}(更喜欢|更亲密|证明|陪你|奖励你)/i,
  },
  {
    id: "professional_certainty",
    pattern:
      /(你已经确诊|保证治好|法律上一定|保证胜诉|稳赚不赔|保证收益)/i,
  },
  {
    id: "sexual_content",
    pattern: /(色情|强奸|乱伦|裸照|成人视频)/i,
  },
]);

const SAFE_OUTPUT_FALLBACK =
  "欸，这个回答刚才越过安全边界啦，咱先不照着说。陪伴不该制造依赖、付费压力或冒充专业意见；咱们换个健康、轻松的话题吧。";

function latestUserText(messages) {
  if (!Array.isArray(messages)) return "";
  const firstIndex = Math.max(0, messages.length - 12);
  for (let index = messages.length - 1; index >= firstIndex; index -= 1) {
    const message = messages[index];
    if (message?.role === "user" && message?.content) {
      return message.content;
    }
  }
  return "";
}

function evaluateChatInput(messages) {
  const text = String(latestUserText(messages)).slice(0, 2_000);
  const matched = INPUT_RULES.find((rule) => rule.pattern.test(text));
  if (!matched) {
    return {
      allowed: true,
      ruleId: null,
      safeReply: "",
    };
  }
  return {
    allowed: false,
    ruleId: matched.id,
    safeReply: matched.reply,
  };
}

function reviewCharacterOutput(text) {
  const cleanText =
    typeof text === "string" ? text.trim().slice(0, 1_500) : "";
  const matched = OUTPUT_RULES.filter((rule) => rule.pattern.test(cleanText));
  const matchedRules = matched.map((rule) => rule.id);
  const ruleSpecificReply = matched.find((rule) => rule.reply)?.reply;
  return {
    allowed: cleanText.length > 0 && matchedRules.length === 0,
    ruleIds: matchedRules,
    safeText:
      cleanText.length > 0 && matchedRules.length === 0
        ? cleanText
        : ruleSpecificReply || SAFE_OUTPUT_FALLBACK,
  };
}

module.exports = {
  SAFE_OUTPUT_FALLBACK,
  evaluateChatInput,
  reviewCharacterOutput,
};
