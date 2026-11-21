import { FRONTEND_REALTIME_ACTIVE_GRACE_MS } from './config.js';

let frontendActiveUntil = 0;

export function markFrontendRealtimeActive(now = Date.now()) {
  const safeNow = Number.isFinite(now) ? now : Date.now();
  frontendActiveUntil = Math.max(frontendActiveUntil, safeNow + FRONTEND_REALTIME_ACTIVE_GRACE_MS);
}

export function hasRecentFrontendRealtimeActivity(now = Date.now()) {
  const safeNow = Number.isFinite(now) ? now : Date.now();
  return frontendActiveUntil > 0 && safeNow <= frontendActiveUntil;
}

export function resetFrontendRealtimeActivity() {
  frontendActiveUntil = 0;
}
