const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const strictRelease = process.argv.includes("--strict-release");
const trackedFiles = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  {
    cwd: root,
    encoding: "utf8",
  },
)
  .split("\0")
  .filter(Boolean);

const forbiddenSuffixes = [
  ".rar",
  ".7z",
  ".moc3",
  ".model3.json",
  ".motion3.json",
  ".exp3.json",
  ".wav",
  ".mp3",
];
const textSuffixes = new Set([
  ".cjs",
  ".js",
  ".json",
  ".md",
  ".ts",
  ".tsx",
  ".yml",
  ".yaml",
  ".gitignore",
]);
const findings = [];

for (const file of trackedFiles) {
  const lower = file.toLowerCase();
  if (forbiddenSuffixes.some((suffix) => lower.endsWith(suffix))) {
    findings.push(`${file}: restricted archive, Live2D or audio asset`);
  }
  const extension =
    path.basename(file) === ".gitignore"
      ? ".gitignore"
      : path.extname(file).toLowerCase();
  if (!textSuffixes.has(extension)) continue;
  const absolutePath = path.join(root, file);
  const stat = fs.statSync(absolutePath);
  if (stat.size > 2 * 1024 * 1024) continue;
  const text = fs.readFileSync(absolutePath, "utf8");
  const patterns = [
    {
      label: "possible API secret",
      expression: new RegExp(
        ["s", "k", "-", "[A-Za-z0-9._-]{24,}"].join(""),
        "g",
      ),
    },
    {
      label: "temporary OSS credential",
      expression: new RegExp(
        ["OSS", "Access", "Key", "Id", "="].join(""),
        "i",
      ),
    },
    {
      label: "temporary signed download",
      expression: new RegExp(
        ["Expires", "=", "\\d{6,}", ".{0,120}", "Signature", "="].join(
          "",
        ),
        "i",
      ),
    },
  ];
  for (const pattern of patterns) {
    if (pattern.expression.test(text)) {
      findings.push(`${file}: ${pattern.label}`);
    }
  }
}

const skillProfile = JSON.parse(
  fs.readFileSync(
    path.join(root, "shared", "march7th-skill-profile.json"),
    "utf8",
  ),
);
if (!/^[a-f0-9]{40}$/.test(skillProfile.source.sourceRevision)) {
  findings.push(
    "shared/march7th-skill-profile.json: sourceRevision is not a pinned Git commit",
  );
}
if (skillProfile.assetManifest.originalLive2DIncluded !== false) {
  findings.push(
    "shared/march7th-skill-profile.json: original Live2D must remain excluded",
  );
}

const riskRegister = JSON.parse(
  fs.readFileSync(
    path.join(root, "shared", "release-risk-register.json"),
    "utf8",
  ),
);
const blockers = riskRegister.items.filter(
  (item) => item.status === "blocked",
);
if (strictRelease && blockers.length > 0) {
  for (const blocker of blockers) {
    findings.push(
      `release gate ${blocker.id}: ${blocker.gate ?? "not ready"}`,
    );
  }
}

if (findings.length > 0) {
  console.error("Release audit failed:");
  for (const finding of findings) {
    console.error(`- ${finding}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `Release audit passed for ${trackedFiles.length} tracked files.`,
  );
  if (blockers.length > 0) {
    console.log(
      `${blockers.length} declared release gate(s) remain blocked; use npm run audit:release:strict for formal release readiness.`,
    );
  }
}
