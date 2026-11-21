import { getCurrentInstance, onBeforeUnmount, unref, watch } from 'vue'

const activeModalStack = []
let previousBodyOverflow = ''
let bodyScrollLocked = false
let boundWindow = null

function resolveBoolean(source, fallback = true) {
  if (typeof source === 'function') return Boolean(source())
  if (source === undefined) return fallback
  return Boolean(unref(source))
}

function syncBodyScrollLock() {
  if (typeof document === 'undefined' || !document?.body?.style) return
  if (activeModalStack.length > 0) {
    if (!bodyScrollLocked) {
      previousBodyOverflow = document.body.style.overflow || ''
      bodyScrollLocked = true
    }
    document.body.style.overflow = 'hidden'
  } else if (bodyScrollLocked) {
    document.body.style.overflow = previousBodyOverflow
    previousBodyOverflow = ''
    bodyScrollLocked = false
  }
}

export function handleModalEscapeKeydown(event) {
  if (!event || event.key !== 'Escape') return false
  if (event.defaultPrevented) return false
  if (activeModalStack.length === 0) return false

  const topModal = activeModalStack[activeModalStack.length - 1]
  if (!topModal) return false

  // 仅允许关闭栈顶且非保存/加载中的弹窗，不可关闭时阻断穿透。
  if (!topModal.canClose()) {
    event.preventDefault?.()
    return false
  }

  event.preventDefault?.()
  event.stopPropagation?.()
  topModal.onClose?.()
  return true
}

function attachGlobalKeyListener() {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return
  if (boundWindow === window) return
  detachGlobalKeyListener()
  window.addEventListener('keydown', handleModalEscapeKeydown)
  boundWindow = window
}

function detachGlobalKeyListener() {
  if (boundWindow && typeof boundWindow.removeEventListener === 'function') {
    boundWindow.removeEventListener('keydown', handleModalEscapeKeydown)
  }
  boundWindow = null
}

function pushModalEntry(entry) {
  const existingIndex = activeModalStack.indexOf(entry)
  if (existingIndex !== -1) {
    activeModalStack.splice(existingIndex, 1)
  }
  activeModalStack.push(entry)
  attachGlobalKeyListener()
  syncBodyScrollLock()
}

function removeModalEntry(entry) {
  const index = activeModalStack.indexOf(entry)
  if (index !== -1) {
    activeModalStack.splice(index, 1)
  }
  syncBodyScrollLock()
  if (activeModalStack.length === 0) {
    detachGlobalKeyListener()
  }
}

export function useModal(isOpen, onClose, options = {}) {
  const entry = {
    onClose: () => onClose?.(),
    canClose: () => {
      if (options.disabled !== undefined && resolveBoolean(options.disabled, false)) {
        return false
      }
      return resolveBoolean(options.canClose, true)
    }
  }

  const stopWatch = watch(
    () => resolveBoolean(isOpen, false),
    (open) => {
      if (open) {
        pushModalEntry(entry)
      } else {
        removeModalEntry(entry)
      }
    },
    { immediate: true }
  )

  const close = () => {
    if (!entry.canClose()) return false
    entry.onClose()
    return true
  }

  const dispose = () => {
    stopWatch()
    removeModalEntry(entry)
  }

  if (getCurrentInstance()) {
    onBeforeUnmount(dispose)
  }

  return {
    close,
    dispose
  }
}

export function getActiveModalCount() {
  return activeModalStack.length
}

export function resetModalStack() {
  activeModalStack.splice(0, activeModalStack.length)
  syncBodyScrollLock()
  detachGlobalKeyListener()
}
