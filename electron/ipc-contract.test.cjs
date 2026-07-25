const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const mainSource = fs.readFileSync(
  path.join(__dirname, "main.cjs"),
  "utf8",
);
const preloadSource = fs.readFileSync(
  path.join(__dirname, "preload.cjs"),
  "utf8",
);

function collect(source, expression) {
  return new Set(
    Array.from(source.matchAll(expression), (match) => match[1]),
  );
}

function difference(left, right) {
  return [...left].filter((item) => !right.has(item)).sort();
}

test("every renderer invoke and send channel has a main-process handler", () => {
  const rendererInvokes = collect(
    preloadSource,
    /ipcRenderer\.invoke\(\s*["']([^"']+)["']/g,
  );
  const rendererSends = collect(
    preloadSource,
    /ipcRenderer\.send\(\s*["']([^"']+)["']/g,
  );
  const mainHandles = collect(
    mainSource,
    /ipcMain\.handle\(\s*["']([^"']+)["']/g,
  );
  const mainListeners = collect(
    mainSource,
    /ipcMain\.on\(\s*["']([^"']+)["']/g,
  );

  assert.deepEqual(difference(rendererInvokes, mainHandles), []);
  assert.deepEqual(difference(rendererSends, mainListeners), []);
  assert.ok(rendererInvokes.size >= 45);
  assert.ok(rendererSends.size >= 4);
});

test("every renderer event subscription is emitted by the main process", () => {
  const rendererEvents = collect(
    preloadSource,
    /ipcRenderer\.on\(\s*["']([^"']+)["']/g,
  );
  const mainEvents = collect(
    mainSource,
    /(?:webContents|sender)\.send\(\s*["']([^"']+)["']/g,
  );

  assert.deepEqual(difference(rendererEvents, mainEvents), []);
  assert.deepEqual(
    [...rendererEvents].sort(),
    [
      "companion:data-updated",
      "desktop:navigate",
      "tts:stream-event",
    ],
  );
});

test("preload bridge does not expose filesystem, shell or raw-key reads", () => {
  assert.equal(/\brequire\(["']node:(?:fs|child_process)["']\)/.test(preloadSource), false);
  assert.equal(/\bshell\b/.test(preloadSource), false);
  assert.equal(/getApiKey|readApiKey|rawKey/.test(preloadSource), false);
  assert.equal(/removeAllListeners/.test(preloadSource), false);
});
