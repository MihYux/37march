export interface WindowDragOrigin {
  screenX: number;
  screenY: number;
  windowX: number;
  windowY: number;
}

export interface WindowPosition {
  x: number;
  y: number;
}

export function calculateWindowDragPosition(
  origin: WindowDragOrigin,
  screenX: number,
  screenY: number,
  threshold = 4,
): WindowPosition | null {
  const deltaX = screenX - origin.screenX;
  const deltaY = screenY - origin.screenY;
  if (Math.hypot(deltaX, deltaY) < threshold) return null;

  return {
    x: origin.windowX + deltaX,
    y: origin.windowY + deltaY,
  };
}
