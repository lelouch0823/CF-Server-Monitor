export const normalizeTimestamp = (value, fallback = null) => {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') {
    return fallback
  }
  const ts = Number(value)
  if (Number.isFinite(ts) && ts > 0) {
    return ts < 10000000000 ? ts * 1000 : ts
  }
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export const formatDateTime = (timestamp) => {
  const normalized = normalizeTimestamp(timestamp, null)
  if (!normalized) return '-'
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) return '-'
  const pad = (num) => String(num).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}
