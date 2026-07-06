// Shared pan intent: the desktop WASD keys and the mobile on-screen arrow pad
// both write here, and Scene's pan loop (WasdPan) reads it every frame. Kept
// as a plain mutable object — pressing an arrow must never re-render React.
export const panState = { w: false, a: false, s: false, d: false };
export type PanKey = keyof typeof panState;
