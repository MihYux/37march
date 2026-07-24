const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const matrixPath = path.join(
  root,
  "shared",
  "prd-acceptance.json",
);
const matrix = JSON.parse(fs.readFileSync(matrixPath, "utf8"));
const riskRegister = JSON.parse(
  fs.readFileSync(
    path.join(root, "shared", "release-risk-register.json"),
    "utf8",
  ),
);
const findings = [];

if (matrix.schemaVersion !== 1) {
  findings.push("acceptance matrix schemaVersion must be 1");
}
if (!Array.isArray(matrix.items) || matrix.items.length !== 36) {
  findings.push("acceptance matrix must contain exactly 36 items");
}

const ids = new Set();
const domains = new Set();
for (const [index, item] of (matrix.items ?? []).entries()) {
  const expectedId = `PRD-ACC-${String(index + 1).padStart(2, "0")}`;
  if (item.id !== expectedId) {
    findings.push(
      `item ${index + 1} must use sequential id ${expectedId}`,
    );
  }
  if (ids.has(item.id)) findings.push(`${item.id}: duplicate id`);
  ids.add(item.id);
  domains.add(item.domain);

  if (!["verified", "blocked"].includes(item.status)) {
    findings.push(`${item.id}: unsupported status ${item.status}`);
  }
  if (
    typeof item.criterion !== "string" ||
    item.criterion.trim().length < 4
  ) {
    findings.push(`${item.id}: criterion is missing`);
  }
  if (
    typeof item.verification !== "string" ||
    item.verification.trim().length < 8
  ) {
    findings.push(`${item.id}: verification is missing`);
  }
  if (!Array.isArray(item.evidence) || item.evidence.length === 0) {
    findings.push(`${item.id}: evidence is missing`);
    continue;
  }
  if (
    item.status === "verified" &&
    !item.evidence.some((file) => /\.test\.[cm]?[jt]sx?$/.test(file))
  ) {
    findings.push(`${item.id}: verified item needs automated test evidence`);
  }
  for (const file of item.evidence) {
    if (
      typeof file !== "string" ||
      path.isAbsolute(file) ||
      file.includes("..")
    ) {
      findings.push(`${item.id}: invalid evidence path ${file}`);
      continue;
    }
    if (!fs.existsSync(path.join(root, file))) {
      findings.push(`${item.id}: evidence file does not exist: ${file}`);
    }
  }
}

for (const domain of [
  "skill",
  "desktop_pet",
  "relationship",
  "communication",
  "campaign",
  "safety",
  "demo",
]) {
  if (!domains.has(domain)) findings.push(`missing domain: ${domain}`);
}

const blockedCriteria = (matrix.items ?? []).filter(
  (item) => item.status === "blocked",
);
const releaseBlockers = riskRegister.items.filter(
  (item) => item.status === "blocked",
);
if (findings.length > 0) {
  console.error("PRD acceptance audit failed:");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exitCode = 1;
} else {
  console.log(
    `PRD acceptance audit passed: ${matrix.items.length - blockedCriteria.length}/36 prototype criteria verified.`,
  );
  console.log(
    `${releaseBlockers.length} declared formal-release gate(s) remain blocked and are tracked separately.`,
  );
}
