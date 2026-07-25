const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const JSZip = require("jszip");
const skillProfile = require("../shared/march7th-skill-profile.json");
const {
  buildCampaignGenerationContext,
  generateCampaignCandidate,
} = require("./campaign-generator.cjs");
const {
  isScopedContentAvailable,
  unsupportedStructuredClaims,
} = require("./campaign-review.cjs");
const {
  CompanionStore,
  isPlayerInRollout,
} = require("./companion-store.cjs");
const {
  CONTACT_SUPPRESSION,
  evaluateContactPolicy,
} = require("./contact-policy.cjs");
const { parseCampaignDocument } = require("./release-knowledge.cjs");

const NOW = "2026-07-24T08:00:00.000Z";

async function makeDocx(text) {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.folder("_rels").file(
    ".rels",
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.folder("word").file(
    "document.xml",
    `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

function makeStore() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "march7th-release-constraints-"),
  );
  return new CompanionStore({
    filePath: path.join(directory, "companion-data.json"),
    skillProfile,
    clock: () => NOW,
  });
}

test("DOCX and PDF imports preserve format and PDF page provenance", async () => {
  const docx = await parseCampaignDocument({
    fileName: "plan.docx",
    buffer: await makeDocx("Approved release background"),
    now: NOW,
  });
  assert.equal(docx.source.format, "docx");
  assert.match(docx.chunks[0].text, /Approved release background/);

  const pdf = await parseCampaignDocument({
    fileName: "plan.pdf",
    buffer: fs.readFileSync(
      path.join(
        path.dirname(require.resolve("pdf-parse/package.json")),
        "test",
        "data",
        "01-valid.pdf",
      ),
    ),
    now: NOW,
  });
  assert.equal(pdf.source.format, "pdf");
  assert.equal(pdf.chunks[0].page, 1);
  assert.ok(pdf.chunks[0].text.length > 0);
});

test("generation context excludes embargoed facts and out-of-scope knowledge", () => {
  const campaign = {
    id: "campaign-1",
    region: "cn",
    targetSegments: ["story"],
    globalTheme: "new journey",
    narrativeApproach: "soft invitation",
    sellingPoints: ["photos"],
    fixedFactEntries: [
      {
        id: "fact-visible",
        key: "versionName",
        value: "Version A",
        locked: true,
        reviewedAt: NOW,
        availableFrom: NOW,
        regions: ["cn"],
        segments: ["story"],
      },
      {
        id: "fact-future",
        key: "rewardStatement",
        value: "Future reward",
        locked: true,
        reviewedAt: NOW,
        availableFrom: "2026-07-25T00:00:00.000Z",
      },
    ],
    knowledgeChunks: [
      {
        id: "knowledge-visible",
        approved: true,
        phases: ["launch"],
        regions: ["cn"],
        segments: ["story"],
        availableFrom: NOW,
        title: "FAQ",
        text: "Take photos together",
      },
      {
        id: "knowledge-other-region",
        approved: true,
        phases: ["launch"],
        regions: ["jp"],
        segments: [],
        availableFrom: NOW,
        title: "Secret",
        text: "Other region only",
      },
    ],
  };
  const context = buildCampaignGenerationContext({
    data: { skill: skillProfile },
    campaign,
    phase: "launch",
    now: NOW,
  });
  assert.deepEqual(context.facts.map((fact) => fact.id), ["fact-visible"]);
  assert.deepEqual(context.knowledge.map((chunk) => chunk.id), [
    "knowledge-visible",
  ]);
});

test("new dates and reward numbers require an approved source", () => {
  assert.deepEqual(
    unsupportedStructuredClaims(
      "活动将在7月25日开放，并赠送300星琼。",
      "活动将在7月25日开放。",
    ),
    ["300星琼"],
  );
  assert.equal(
    isScopedContentAvailable(
      { availableFrom: "2026-07-25T00:00:00.000Z" },
      { now: NOW, segments: [] },
    ),
    false,
  );
});

test("model generation only accepts the structured candidate contract", async () => {
  const result = await generateCampaignCandidate({
    apiKey: "test-key",
    model: "test-model",
    context: { campaignId: "campaign-1" },
    requestChat: async (request) => {
      assert.equal(request.thinking, false);
      assert.match(request.messages[0].content, /campaign-1/);
      return {
        content: JSON.stringify({
          title: "旅程开始啦",
          body: "咱把照片准备好啦，想看时再一起去。",
          usedFactIds: [],
          usedKnowledgeChunkIds: [],
          riskFlags: [],
        }),
      };
    },
  });
  assert.equal(result.title, "旅程开始啦");
});

test("player snapshots strip internal facts, knowledge and review records", () => {
  const store = makeStore();
  const player = store.getPlayerSnapshot();
  const operator = store.getOperatorSnapshot();
  assert.ok(operator.campaigns[0].fixedFactEntries.length > 0);
  assert.deepEqual(player.campaigns[0].fixedFactEntries, []);
  assert.deepEqual(player.campaigns[0].knowledgeChunks, []);
  assert.equal(player.campaigns[0].automaticReview, undefined);
  assert.equal(player.campaigns[0].humanReview, undefined);
});

test("negative, chatting and occupied contexts suppress version contact", () => {
  const store = makeStore();
  const data = store.getOperatorSnapshot();
  data.profile.onboardingCompleted = true;
  data.profile.proactiveContactEnabled = true;
  data.profile.allowedContentTypes = ["version_launch"];
  data.profile.quietHours = { start: "01:00", end: "02:00" };
  data.profile.weeklyContactLimit = 2;
  data.relationship.paused = false;
  data.messages = [];
  const event = {
    trigger: "version_launch",
    payload: {
      contentType: "version_launch",
      playerContext: { negativeEmotion: true },
    },
  };
  assert.equal(
    evaluateContactPolicy({ data, event, now: NOW }).reason,
    CONTACT_SUPPRESSION.CONTEXT_NOT_ELIGIBLE,
  );
});

test("gray rollout assignment is stable and 100 percent includes everyone", () => {
  const first = isPlayerInRollout("player-a", "campaign-a", 5);
  assert.equal(
    isPlayerInRollout("player-a", "campaign-a", 5),
    first,
  );
  assert.equal(
    isPlayerInRollout("player-outside", "campaign-a", 100),
    true,
  );
});

test("Windows startup disables the high-load transparent GPU compositor", () => {
  const mainSource = fs.readFileSync(
    path.join(__dirname, "main.cjs"),
    "utf8",
  );
  assert.match(
    mainSource,
    /process\.platform === "win32"[\s\S]+app\.disableHardwareAcceleration\(\)/,
  );
});

test("release workspace preload is narrow and mutation is absent from player preload", () => {
  const operatorPreload = fs.readFileSync(
    path.join(__dirname, "operator-preload.cjs"),
    "utf8",
  );
  const playerPreload = fs.readFileSync(
    path.join(__dirname, "preload.cjs"),
    "utf8",
  );
  assert.equal(/\brequire\(["']node:(?:fs|child_process)["']\)/.test(operatorPreload), false);
  assert.equal(/getApiKey|readApiKey|rawKey|\bshell\b/.test(operatorPreload), false);
  assert.equal(/companion:create-campaign/.test(playerPreload), false);
  assert.match(operatorPreload, /release:export-bundle/);
  assert.match(operatorPreload, /release:deliver-test/);
  assert.equal(/release:save-task/.test(playerPreload), false);
});
