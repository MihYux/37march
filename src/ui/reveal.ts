export interface RevealPlan {
  frames: string[];
  intervalMs: number;
  leadInMs: number;
}

export function createRevealPlan(text: string): RevealPlan {
  const glyphs = Array.from(text);
  const batchSize = glyphs.length > 120 ? 2 : 1;
  const frames: string[] = [];

  for (let index = batchSize; index < glyphs.length; index += batchSize) {
    frames.push(glyphs.slice(0, index).join(""));
  }
  if (text) frames.push(text);

  return {
    frames,
    intervalMs: Math.min(
      58,
      Math.max(22, Math.round(1_500 / Math.max(1, frames.length))),
    ),
    leadInMs: 100,
  };
}
