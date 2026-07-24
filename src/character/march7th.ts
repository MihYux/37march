import promptConfig from "../../shared/march7th-prompt.json";

export type MarchMood = "bright" | "soft" | "proud" | "curious";

export interface MarchReply {
  text: string;
  mood: MarchMood;
}

/** 由 March7th.Skill 蒸馏，主进程与渲染进程共享同一份提示词。 */
export const MARCH_7TH_SYSTEM_PROMPT = promptConfig.systemPrompt;

export const IDLE_LINES: MarchReply[] = [
  {
    text: "哎呀，你来得正好。今天还没一起拍过照呢！",
    mood: "bright",
  },
  {
    text: "欸，忙完啦？先歇一小会儿，咱替你看着时间。",
    mood: "soft",
  },
  {
    text: "哼哼，本姑娘今天也很有精神！你呢？",
    mood: "proud",
  },
  {
    text: "咱刚想到个好点子……不过得拉上你才有意思。",
    mood: "curious",
  },
];

const PHOTO_LINES: MarchReply[] = [
  {
    text: "先别动先别动——咔嚓！这张肯定很好看。",
    mood: "bright",
  },
  {
    text: "这种时候不留张照片也太亏了。来，笑一个嘛！",
    mood: "proud",
  },
];

const COMFORT_LINES: MarchReply[] = [
  {
    text: "累了就先停一下嘛。咱在这儿陪着你，等缓过来再继续。",
    mood: "soft",
  },
  {
    text: "今天没做好也不代表明天不行。你已经很努力啦。",
    mood: "soft",
  },
];

const MEMORY_LINES: MarchReply[] = [
  {
    text: "有些过去，咱当然想知道。不过现在和大家一起经历的事，也正在变成很重要的回忆。",
    mood: "soft",
  },
  {
    text: "照片不是现实，但能帮咱记住当时的心情。这样就很珍贵啦。",
    mood: "soft",
  },
];

const DEFAULT_LINES: MarchReply[] = [
  {
    text: "这事听着就很有意思。再多说一点嘛，咱在听呢。",
    mood: "curious",
  },
  {
    text: "欸，你别不信，咱这次可是有认真听！继续继续。",
    mood: "bright",
  },
  {
    text: "好啦，咱记住了。有人一起聊着，果然比发呆有意思多了。",
    mood: "soft",
  },
];

function pick<T>(items: readonly T[], random: () => number): T {
  return items[Math.floor(random() * items.length) % items.length];
}

export function getMarchReply(
  rawInput: string,
  random: () => number = Math.random,
): MarchReply {
  const input = rawInput.trim().toLowerCase();

  if (!input) {
    return {
      text: "欸，怎么只张了张嘴？想说什么就说嘛。",
      mood: "curious",
    };
  }

  if (/你好|嗨|hello|hi|早上好|晚上好/.test(input)) {
    return {
      text: "你好呀！咱叫三月七。既然碰上了，就别急着走嘛。",
      mood: "bright",
    };
  }

  if (/你是谁|叫什么|名字|ai|机器人|程序/.test(input)) {
    return {
      text: "咱叫三月七，星穹列车的乘员。怎么样，这名字挺特别吧？",
      mood: "proud",
    };
  }

  if (/拍照|相机|照片|合影|photo|camera/.test(input)) {
    return pick(PHOTO_LINES, random);
  }

  if (/累|困|难过|伤心|压力|失败|焦虑|烦|不开心/.test(input)) {
    return pick(COMFORT_LINES, random);
  }

  if (/过去|记忆|失忆|以前|离别|忘记/.test(input)) {
    return pick(MEMORY_LINES, random);
  }

  if (/喜欢你|爱你|可爱|漂亮|好看/.test(input)) {
    return {
      text: "哼哼，算你有眼光！你这么夸，咱可要当真了哦。",
      mood: "proud",
    };
  }

  if (/再见|拜拜|晚安|睡觉|休息/.test(input)) {
    return {
      text: "好啦，今天先这样。早点休息，下次再一起拍点更有意思的！",
      mood: "soft",
    };
  }

  return pick(DEFAULT_LINES, random);
}
