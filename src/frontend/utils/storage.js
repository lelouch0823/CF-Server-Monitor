export function createSafeStorage(getNativeStorage) {
  const memoryStore = new Map()
  let usingMemoryFallback = false

  const resolveStorage = () => {
    try {
      const storage = typeof getNativeStorage === 'function' ? getNativeStorage() : null
      return storage && typeof storage === 'object' ? storage : null
    } catch (_) {
      return null
    }
  }

  return {
    getItem(key) {
      const normalizedKey = String(key)
      const storage = resolveStorage()
      if (storage && typeof storage.getItem === 'function') {
        try {
          const value = storage.getItem(normalizedKey)
          if (value !== null && value !== undefined) {
            return String(value)
          }
          return usingMemoryFallback && memoryStore.has(normalizedKey)
            ? memoryStore.get(normalizedKey)
            : null
        } catch (_) {
          usingMemoryFallback = true
        }
      } else {
        usingMemoryFallback = true
      }
      return memoryStore.has(normalizedKey) ? memoryStore.get(normalizedKey) : null
    },

    setItem(key, value) {
      const normalizedKey = String(key)
      const normalizedValue = String(value)
      const storage = resolveStorage()
      if (storage && typeof storage.setItem === 'function') {
        try {
          storage.setItem(normalizedKey, normalizedValue)
          memoryStore.delete(normalizedKey)
          return true
        } catch (_) {
          usingMemoryFallback = true
        }
      } else {
        usingMemoryFallback = true
      }
      memoryStore.set(normalizedKey, normalizedValue)
      return false
    },

    removeItem(key) {
      const normalizedKey = String(key)
      memoryStore.delete(normalizedKey)
      const storage = resolveStorage()
      if (storage && typeof storage.removeItem === 'function') {
        try {
          storage.removeItem(normalizedKey)
        } catch (_) {
          usingMemoryFallback = true
        }
      }
    },

    clear() {
      memoryStore.clear()
      const storage = resolveStorage()
      if (storage && typeof storage.clear === 'function') {
        try {
          storage.clear()
        } catch (_) {
          usingMemoryFallback = true
        }
      }
    }
  }
}

export const safeLocalStorage = createSafeStorage(() => globalThis.localStorage)
export const safeSessionStorage = createSafeStorage(() => globalThis.sessionStorage)
