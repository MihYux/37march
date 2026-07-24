const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  DEFAULT_WINDOW_STATE,
  PET_DEFAULT_SCALE,
  PET_MAX_SCALE,
  PET_MIN_SCALE,
  PET_SIZE_STATE_VERSION,
  WindowStateStore,
  constrainAndSnapBounds,
  getPetMaxScaleForWorkArea,
  getPetSize,
  normalizePetScale,
  normalizeWindowState,
  selectWorkArea,
} = require("./window-state.cjs");

const DISPLAYS = [
  { x: 0, y: 0, width: 1_440, height: 900 },
  { x: 1_440, y: -120, width: 1_920, height: 1_080 },
];

test("uses the 200% default and clamps proportional pet scaling", () => {
  assert.equal(
    DEFAULT_WINDOW_STATE.petSizeVersion,
    PET_SIZE_STATE_VERSION,
  );
  assert.deepEqual(DEFAULT_WINDOW_STATE.bounds, {
    x: 20,
    y: 20,
    width: 376,
    height: 620,
  });
  assert.deepEqual(getPetSize(PET_MIN_SCALE), {
    width: 188,
    height: 310,
  });
  assert.deepEqual(getPetSize(PET_DEFAULT_SCALE), {
    width: 376,
    height: 620,
  });
  assert.deepEqual(getPetSize(PET_MAX_SCALE), {
    width: 1128,
    height: 1860,
  });
  assert.equal(normalizePetScale(0.1), PET_MIN_SCALE);
  assert.equal(normalizePetScale(4), PET_MAX_SCALE);
  const displayLimitedScale = getPetMaxScaleForWorkArea({
    width: 1_440,
    height: 900,
  });
  assert.ok(displayLimitedScale < PET_MAX_SCALE);
  assert.deepEqual(getPetSize(displayLimitedScale), {
    width: 546,
    height: 900,
  });
});

test("migrates the former half-size default to the new default", () => {
  const migrated = normalizeWindowState({
    bounds: { x: 20, y: 20, width: 188, height: 330 },
    petScale: 0.5,
    petDefaultScale: 0.5,
  });
  assert.equal(migrated.petSizeVersion, PET_SIZE_STATE_VERSION);
  assert.equal(migrated.petScale, PET_DEFAULT_SCALE);
  assert.equal(migrated.petDefaultScale, PET_DEFAULT_SCALE);
});

test("selects the intersecting or nearest display work area", () => {
  assert.deepEqual(
    selectWorkArea(
      { x: 1_800, y: 100, width: 430, height: 660 },
      DISPLAYS,
    ),
    DISPLAYS[1],
  );
  assert.deepEqual(
    selectWorkArea(
      { x: 5_000, y: 100, width: 430, height: 660 },
      DISPLAYS,
    ),
    DISPLAYS[1],
  );
});

test("constrains off-screen windows and snaps near every edge", () => {
  assert.deepEqual(
    constrainAndSnapBounds(
      { x: -500, y: -500, width: 430, height: 660 },
      DISPLAYS,
    ),
    { x: 0, y: 0, width: 430, height: 660 },
  );
  assert.deepEqual(
    constrainAndSnapBounds(
      { x: 1_005, y: 235, width: 430, height: 660 },
      [DISPLAYS[0]],
    ),
    { x: 1_010, y: 240, width: 430, height: 660 },
  );
});

test("click-through can change at runtime but can be reset on restart", () => {
  assert.equal(
    normalizeWindowState({
      bounds: { x: 20, y: 20, width: 430, height: 660 },
      pinned: false,
      clickThrough: true,
      snapEnabled: true,
    }).clickThrough,
    true,
  );
  assert.equal(
    normalizeWindowState({
      bounds: { x: 20, y: 20, width: 430, height: 660 },
      pinned: false,
      clickThrough: true,
      snapEnabled: true,
    }, {
      resetClickThrough: true,
    }).clickThrough,
    false,
  );
});

test("window state persists atomically with private file permissions", () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "march7th-window-state-"),
  );
  const filePath = path.join(directory, "window-state.json");
  const store = new WindowStateStore({ filePath });
  const updated = store.update({
    bounds: { x: 100, y: 80, width: 500, height: 700 },
    petDefaultScale: 0.75,
    pinned: false,
    clickThrough: true,
    snapEnabled: false,
  });
  assert.equal(updated.clickThrough, true);
  assert.equal(updated.petDefaultScale, 0.75);
  const reloaded = new WindowStateStore({ filePath }).getSnapshot();
  assert.deepEqual(reloaded, {
    ...updated,
    clickThrough: false,
  });
  assert.equal(fs.existsSync(`${filePath}.tmp`), false);
  // Unix 权限位仅在 posix 文件系统上有意义；Windows/NTFS 不保留 0o600，跳过断言
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);
  }
});
