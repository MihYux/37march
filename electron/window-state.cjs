const fs = require("node:fs");
const path = require("node:path");
const petWindowConfig = require("../shared/pet-window-config.json");

const PET_BASE_SIZE = Object.freeze({
  width: petWindowConfig.baseWidth,
  height: petWindowConfig.baseHeight,
});
const PET_DEFAULT_SCALE = petWindowConfig.defaultScale;
const PET_SIZE_STATE_VERSION = 2;
const PET_MIN_SCALE =
  PET_DEFAULT_SCALE * petWindowConfig.minMultiplier;
const PET_MAX_SCALE =
  PET_DEFAULT_SCALE * petWindowConfig.maxMultiplier;

function getPetMaxScaleForWorkArea(workArea) {
  const width = Number(workArea?.width);
  const height = Number(workArea?.height);
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return PET_MAX_SCALE;
  }
  return Math.max(
    PET_MIN_SCALE,
    Math.min(
      PET_MAX_SCALE,
      width / PET_BASE_SIZE.width,
      height / PET_BASE_SIZE.height,
    ),
  );
}

function normalizePetScale(value, fallback = PET_DEFAULT_SCALE) {
  const scale = Number(value);
  if (!Number.isFinite(scale)) return fallback;
  return Math.min(PET_MAX_SCALE, Math.max(PET_MIN_SCALE, scale));
}

function getPetSize(scale = PET_DEFAULT_SCALE) {
  const normalizedScale = normalizePetScale(scale);
  const width = Math.round(PET_BASE_SIZE.width * normalizedScale);
  return {
    width,
    height: Math.round(
      width * (PET_BASE_SIZE.height / PET_BASE_SIZE.width),
    ),
  };
}

const PET_DEFAULT_SIZE = Object.freeze(getPetSize());
const PET_MIN_SIZE = Object.freeze(getPetSize(PET_MIN_SCALE));

const DEFAULT_WINDOW_STATE = Object.freeze({
  petSizeVersion: PET_SIZE_STATE_VERSION,
  bounds: {
    x: 20,
    y: 20,
    ...PET_DEFAULT_SIZE,
  },
  petScale: PET_DEFAULT_SCALE,
  petDefaultScale: PET_DEFAULT_SCALE,
  pinned: true,
  clickThrough: false,
  snapEnabled: true,
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function finiteInteger(value, fallback) {
  return Number.isFinite(value) ? Math.round(value) : fallback;
}

function normalizeBounds(bounds, fallback = DEFAULT_WINDOW_STATE.bounds) {
  return {
    x: finiteInteger(bounds?.x, fallback.x),
    y: finiteInteger(bounds?.y, fallback.y),
    width: Math.min(
      1_200,
      Math.max(
        PET_MIN_SIZE.width,
        finiteInteger(bounds?.width, fallback.width),
      ),
    ),
    height: Math.min(
      1_400,
      Math.max(
        PET_MIN_SIZE.height,
        finiteInteger(bounds?.height, fallback.height),
      ),
    ),
  };
}

function intersectionArea(left, right) {
  const width = Math.max(
    0,
    Math.min(left.x + left.width, right.x + right.width) -
      Math.max(left.x, right.x),
  );
  const height = Math.max(
    0,
    Math.min(left.y + left.height, right.y + right.height) -
      Math.max(left.y, right.y),
  );
  return width * height;
}

function centerDistance(left, right) {
  const leftX = left.x + left.width / 2;
  const leftY = left.y + left.height / 2;
  const rightX = right.x + right.width / 2;
  const rightY = right.y + right.height / 2;
  return Math.hypot(leftX - rightX, leftY - rightY);
}

function selectWorkArea(bounds, workAreas) {
  if (!Array.isArray(workAreas) || workAreas.length === 0) {
    return undefined;
  }
  const normalized = workAreas
    .map((area) => ({
      x: finiteInteger(area?.x, 0),
      y: finiteInteger(area?.y, 0),
      width: finiteInteger(area?.width, 0),
      height: finiteInteger(area?.height, 0),
    }))
    .filter(
      (area) =>
        Number.isFinite(area.x) &&
        Number.isFinite(area.y) &&
        area.width > 0 &&
        area.height > 0,
    );
  const withIntersection = normalized
    .map((area) => ({
      area,
      intersection: intersectionArea(bounds, area),
    }))
    .sort((left, right) => right.intersection - left.intersection);
  if (withIntersection[0]?.intersection > 0) {
    return withIntersection[0].area;
  }
  return normalized.sort(
    (left, right) =>
      centerDistance(bounds, left) - centerDistance(bounds, right),
  )[0];
}

function constrainAndSnapBounds(
  inputBounds,
  workAreas,
  { snap = true, snapDistance = 18 } = {},
) {
  const bounds = normalizeBounds(inputBounds);
  const workArea = selectWorkArea(bounds, workAreas);
  if (!workArea) return bounds;
  const width = Math.min(bounds.width, workArea.width);
  const height = Math.min(bounds.height, workArea.height);
  const minX = workArea.x;
  const maxX = workArea.x + workArea.width - width;
  const minY = workArea.y;
  const maxY = workArea.y + workArea.height - height;
  let x = Math.min(maxX, Math.max(minX, bounds.x));
  let y = Math.min(maxY, Math.max(minY, bounds.y));

  if (snap) {
    if (Math.abs(x - minX) <= snapDistance) x = minX;
    if (Math.abs(x - maxX) <= snapDistance) x = maxX;
    if (Math.abs(y - minY) <= snapDistance) y = minY;
    if (Math.abs(y - maxY) <= snapDistance) y = maxY;
  }
  return { x, y, width, height };
}

function normalizeWindowState(
  input,
  { resetClickThrough = false } = {},
) {
  const shouldMigratePetSize =
    (Number(input?.petSizeVersion) || 0) <
    PET_SIZE_STATE_VERSION;
  return {
    petSizeVersion: PET_SIZE_STATE_VERSION,
    bounds: normalizeBounds(
      input?.bounds,
      DEFAULT_WINDOW_STATE.bounds,
    ),
    petScale: normalizePetScale(
      shouldMigratePetSize ? PET_DEFAULT_SCALE : input?.petScale,
    ),
    petDefaultScale: normalizePetScale(
      shouldMigratePetSize
        ? PET_DEFAULT_SCALE
        : input?.petDefaultScale,
    ),
    pinned: input?.pinned !== false,
    clickThrough:
      resetClickThrough ? false : input?.clickThrough === true,
    snapEnabled: input?.snapEnabled !== false,
  };
}

class WindowStateStore {
  constructor({ filePath }) {
    this.filePath = filePath;
    this.state = this.#read();
  }

  #read() {
    if (!fs.existsSync(this.filePath)) {
      const state = clone(DEFAULT_WINDOW_STATE);
      this.#write(state);
      return state;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      const state = normalizeWindowState(parsed, {
        resetClickThrough: true,
      });
      this.#write(state);
      return state;
    } catch {
      const state = clone(DEFAULT_WINDOW_STATE);
      this.#write(state);
      return state;
    }
  }

  #write(state) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporaryFile = `${this.filePath}.tmp`;
    fs.writeFileSync(
      temporaryFile,
      `${JSON.stringify(state, null, 2)}\n`,
      {
        encoding: "utf8",
        mode: 0o600,
      },
    );
    fs.renameSync(temporaryFile, this.filePath);
  }

  getSnapshot() {
    return clone(this.state);
  }

  update(patch) {
    this.state = normalizeWindowState({
      ...this.state,
      ...patch,
      bounds: patch?.bounds ?? this.state.bounds,
    });
    this.#write(this.state);
    return this.getSnapshot();
  }
}

module.exports = {
  DEFAULT_WINDOW_STATE,
  PET_BASE_SIZE,
  PET_DEFAULT_SCALE,
  PET_DEFAULT_SIZE,
  PET_MAX_SCALE,
  PET_MIN_SCALE,
  PET_MIN_SIZE,
  PET_SIZE_STATE_VERSION,
  WindowStateStore,
  constrainAndSnapBounds,
  getPetMaxScaleForWorkArea,
  getPetSize,
  normalizeBounds,
  normalizePetScale,
  normalizeWindowState,
  selectWorkArea,
};
