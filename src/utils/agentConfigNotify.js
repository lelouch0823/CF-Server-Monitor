export async function notifyAgentConfigChanged(env, serverId) {
  const normalizedServerId = String(serverId || '').trim();
  if (!normalizedServerId || !env?.METRICS_BROADCASTER) return null;

  const id = env.METRICS_BROADCASTER.idFromName('global');
  const stub = env.METRICS_BROADCASTER.get(id);
  return stub.fetch('http://internal/agent-config-changed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ serverId: normalizedServerId })
  });
}

export async function notifyAgentReportModeChanged(env) {
  if (!env?.METRICS_BROADCASTER) return null;

  const id = env.METRICS_BROADCASTER.idFromName('global');
  const stub = env.METRICS_BROADCASTER.get(id);
  return stub.fetch('http://internal/agent-config-changed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentReportModeChanged: true })
  });
}

export function scheduleAgentConfigChanged(env, ctx, serverId) {
  const promise = notifyAgentConfigChanged(env, serverId).catch(e => {
    console.warn('[agent-config] notify change failed:', e?.message || e);
    return null;
  });

  if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(promise);
  }

  return promise;
}

export function scheduleAgentReportModeChanged(env, ctx) {
  const promise = notifyAgentReportModeChanged(env).catch(e => {
    console.warn('[agent-config] notify report mode change failed:', e?.message || e);
    return null;
  });

  if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(promise);
  }

  return promise;
}

export async function notifyBroadcasterInvalidate(env, {
  deletedServerIds = [],
  updatedServerIds = [],
  refreshSettings = false
} = {}) {
  if (!env?.METRICS_BROADCASTER) return null;

  try {
    const id = env.METRICS_BROADCASTER.idFromName('global');
    const stub = env.METRICS_BROADCASTER.get(id);
    return await stub.fetch('http://internal/internal/invalidate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deletedServerIds: Array.isArray(deletedServerIds)
          ? deletedServerIds.map(sid => String(sid || '').trim()).filter(Boolean)
          : [],
        updatedServerIds: Array.isArray(updatedServerIds)
          ? updatedServerIds.map(sid => String(sid || '').trim()).filter(Boolean)
          : [],
        refreshSettings: Boolean(refreshSettings)
      })
    });
  } catch (e) {
    console.warn('[broadcaster] invalidate failed:', e?.message || e);
    return null;
  }
}

export function scheduleBroadcasterInvalidate(env, ctx, payload = {}) {
  const promise = notifyBroadcasterInvalidate(env, payload);

  if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(promise);
  }

  return promise;
}
