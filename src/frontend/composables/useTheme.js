import { ref, onMounted } from "vue";
import { STORAGE } from "../utils/constants";
import { safeLocalStorage } from "../utils/storage";

const STORAGE_KEY = STORAGE.THEME_PREFERENCE;
const themeChangeCallbacks = [];

const currentTheme = ref("auto");
let defaultTheme = "auto";

const normalizeTheme = (theme, fallback = "auto") => {
  const value = String(theme || "").trim().toLowerCase();
  if (value === "dark" || value === "light" || value === "auto") {
    return value;
  }
  return fallback === "dark" || fallback === "light" ? fallback : "auto";
};

// 跟随系统明暗偏好:浏览器/系统为暗色时返回 dark,否则返回 light
const getSystemTheme = () => {
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return "dark";
};

const resolveTheme = (theme) => {
  if (theme === "auto") {
    return getSystemTheme();
  }
  return theme;
};

const applyTheme = (theme) => {
  const resolved = resolveTheme(theme);
  if (typeof document !== "undefined" && document.body) {
    document.body.classList.remove("dark", "light");
    if (resolved !== "dark") {
      document.body.classList.add(resolved);
    }
  }
  themeChangeCallbacks.forEach((cb) => cb(resolved));
};

// 模块级媒体查询监听器:仅注册一次,系统明暗变化且处于 auto 模式时实时切换
let systemThemeMediaQuery = null;
let systemThemeListener = null;
const ensureSystemThemeListener = () => {
  if (
    systemThemeMediaQuery ||
    typeof window === "undefined" ||
    !window.matchMedia
  ) {
    return;
  }
  systemThemeMediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  systemThemeListener = () => {
    if (currentTheme.value === "auto") {
      applyTheme("auto");
    }
  };
  // 兼容旧版 Safari:addListener 已废弃但部分浏览器仍需
  if (systemThemeMediaQuery.addEventListener) {
    systemThemeMediaQuery.addEventListener("change", systemThemeListener);
  } else if (systemThemeMediaQuery.addListener) {
    systemThemeMediaQuery.addListener(systemThemeListener);
  }
};
ensureSystemThemeListener();

export const useTheme = () => {
  const getPreferredTheme = () => {
    return normalizeTheme(safeLocalStorage.getItem(STORAGE_KEY), defaultTheme);
  };

  const setTheme = (theme) => {
    const normalizedTheme = normalizeTheme(theme);
    safeLocalStorage.setItem(STORAGE_KEY, normalizedTheme);
    currentTheme.value = normalizedTheme;
    applyTheme(normalizedTheme);
  };

  const toggleTheme = () => {
    const themes = ["dark", "light", "auto"];
    const currentIndex = themes.indexOf(currentTheme.value);
    const nextIndex = (currentIndex + 1) % themes.length;
    setTheme(themes[nextIndex]);
    return themes[nextIndex];
  };

  const initTheme = () => {
    const saved = getPreferredTheme();
    currentTheme.value = saved;
    applyTheme(saved);
  };

  const onThemeChange = (callback) => {
    themeChangeCallbacks.push(callback);
    // 返回取消订阅函数：组件卸载时调用，避免回调闭包（图表等）常驻内存
    return () => {
      const index = themeChangeCallbacks.indexOf(callback);
      if (index !== -1) {
        themeChangeCallbacks.splice(index, 1);
      }
    };
  };

  onMounted(() => {
    initTheme();
  });

  return {
    currentTheme,
    setTheme,
    getPreferredTheme,
    applyTheme,
    toggleTheme,
    initTheme,
    onThemeChange,
  };
};

export const applyDefaultTheme = (theme) => {
  defaultTheme = normalizeTheme(theme);
  const effectiveTheme = normalizeTheme(safeLocalStorage.getItem(STORAGE_KEY), defaultTheme);
  currentTheme.value = effectiveTheme;
  applyTheme(effectiveTheme);
};

export default useTheme;
