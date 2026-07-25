const path = require("node:path");
const { randomUUID } = require("node:crypto");

const SUPPORTED_DOCUMENT_EXTENSIONS = new Set([
  ".docx",
  ".pdf",
  ".txt",
  ".md",
]);

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitTextIntoChunks(text, { maxLength = 900 } = {}) {
  const normalized = normalizeText(text);
  if (!normalized) return [];
  const blocks = normalized.split(/\n{2,}/).filter(Boolean);
  const chunks = [];
  let current = "";

  for (const block of blocks) {
    const candidate = current ? `${current}\n\n${block}` : block;
    if (candidate.length <= maxLength) {
      current = candidate;
      continue;
    }
    if (current) chunks.push(current);
    if (block.length <= maxLength) {
      current = block;
      continue;
    }
    for (let index = 0; index < block.length; index += maxLength) {
      chunks.push(block.slice(index, index + maxLength));
    }
    current = "";
  }
  if (current) chunks.push(current);
  return chunks.slice(0, 500);
}

async function extractDocx(buffer) {
  const mammoth = require("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return [{ page: undefined, text: result.value }];
}

async function extractPdf(buffer) {
  const pdfParse = require("pdf-parse");
  const pages = [];
  const renderPage = async (pageData) => {
    const content = await pageData.getTextContent({
      normalizeWhitespace: true,
      disableCombineTextItems: false,
    });
    const text = content.items
      .map((item) => (typeof item.str === "string" ? item.str : ""))
      .join(" ");
    pages.push({ page: pages.length + 1, text });
    return text;
  };
  const result = await pdfParse(buffer, { pagerender: renderPage });
  return pages.length
    ? pages
    : [{ page: 1, text: result.text }];
}

async function parseCampaignDocument({
  fileName,
  buffer,
  text,
  now = new Date().toISOString(),
}) {
  const safeName = path.basename(String(fileName || "pasted-plan.txt"));
  const extension = text !== undefined
    ? ".txt"
    : path.extname(safeName).toLowerCase();
  if (!SUPPORTED_DOCUMENT_EXTENSIONS.has(extension)) {
    throw new Error("仅支持 DOCX、PDF、TXT 和 Markdown 发行方案。");
  }

  let pages;
  if (text !== undefined) {
    pages = [{ page: undefined, text }];
  } else {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw new Error("发行方案文件为空。");
    }
    if (buffer.length > 15 * 1024 * 1024) {
      throw new Error("发行方案文件不能超过 15 MB。");
    }
    pages =
      extension === ".docx"
        ? await extractDocx(buffer)
        : extension === ".pdf"
          ? await extractPdf(buffer)
          : [{ page: undefined, text: buffer.toString("utf8") }];
  }

  const sourceId = `knowledge-source-${randomUUID()}`;
  const chunks = pages.flatMap((page) =>
    splitTextIntoChunks(page.text).map((chunkText, index) => ({
      id: `knowledge-chunk-${randomUUID()}`,
      sourceId,
      title: `${safeName}${page.page ? ` · 第 ${page.page} 页` : ""}`,
      text: chunkText,
      page: page.page,
      chunkIndex: index,
      approved: false,
      phases: ["preheat", "launch", "sustain", "recall"],
      regions: [],
      segments: [],
      availableFrom: now,
      expiresAt: undefined,
      reviewedAt: undefined,
      reviewedBy: undefined,
    })),
  );
  if (chunks.length === 0) {
    throw new Error("发行方案没有提取到可用文字。");
  }
  return {
    source: {
      id: sourceId,
      name: safeName,
      format: extension.slice(1),
      importedAt: now,
      chunkCount: chunks.length,
      status: "awaiting_review",
    },
    chunks,
  };
}

function tokenize(value) {
  return new Set(
    normalizeText(value)
      .toLowerCase()
      .split(/[\s，。！？、；：,.!?;:()[\]{}"'“”‘’]+/)
      .filter((token) => token.length >= 2),
  );
}

function retrieveApprovedKnowledge({
  chunks,
  query,
  phase,
  region,
  segments = [],
  now,
  limit = 6,
}) {
  const queryTokens = tokenize(query);
  const segmentSet = new Set(segments);
  return (Array.isArray(chunks) ? chunks : [])
    .filter((chunk) => {
      if (chunk.approved !== true) return false;
      if (Array.isArray(chunk.phases) && !chunk.phases.includes(phase)) {
        return false;
      }
      if (
        Array.isArray(chunk.regions) &&
        chunk.regions.length &&
        !chunk.regions.includes(region)
      ) {
        return false;
      }
      if (
        Array.isArray(chunk.segments) &&
        chunk.segments.length &&
        !chunk.segments.some((segment) => segmentSet.has(segment))
      ) {
        return false;
      }
      if (chunk.availableFrom && Date.parse(chunk.availableFrom) > Date.parse(now)) {
        return false;
      }
      if (chunk.expiresAt && Date.parse(chunk.expiresAt) <= Date.parse(now)) {
        return false;
      }
      return true;
    })
    .map((chunk) => {
      const chunkTokens = tokenize(`${chunk.title} ${chunk.text}`);
      const score = [...queryTokens].reduce(
        (total, token) => total + (chunkTokens.has(token) ? 1 : 0),
        0,
      );
      return { chunk, score };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.max(1, Math.min(6, limit)))
    .map(({ chunk }) => chunk);
}

module.exports = {
  SUPPORTED_DOCUMENT_EXTENSIONS,
  normalizeText,
  parseCampaignDocument,
  retrieveApprovedKnowledge,
  splitTextIntoChunks,
};
