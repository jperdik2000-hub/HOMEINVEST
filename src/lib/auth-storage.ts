// Keeps the Supabase auth token in sessionStorage when "Keep me signed in" is off.
const REMEMBER_KEY = "poker-remember-me";
const realLocalStorage: Storage | null =
  typeof window !== "undefined" && window.localStorage ? window.localStorage : null;

function isAuthTokenKey(key: string): boolean {
  return /^sb-[^-]+-auth-token$/.test(key);
}

function rememberMe(): boolean {
  return realLocalStorage?.getItem(REMEMBER_KEY) !== "false";
}

const authStorage: Storage = {
  get length() {
    return realLocalStorage?.length ?? 0;
  },
  key(index: number): string | null {
    return realLocalStorage?.key(index) ?? null;
  },
  getItem(key: string): string | null {
    if (isAuthTokenKey(key) && !rememberMe()) {
      return sessionStorage.getItem(key);
    }
    return realLocalStorage?.getItem(key) ?? null;
  },
  setItem(key: string, value: string): void {
    if (isAuthTokenKey(key) && !rememberMe()) {
      return sessionStorage.setItem(key, value);
    }
    return realLocalStorage?.setItem(key, value);
  },
  removeItem(key: string): void {
    if (isAuthTokenKey(key) && !rememberMe()) {
      return sessionStorage.removeItem(key);
    }
    return realLocalStorage?.removeItem(key);
  },
  clear(): void {
    realLocalStorage?.clear();
  },
};

if (typeof window !== "undefined" && realLocalStorage) {
  try {
    Object.defineProperty(window, "localStorage", {
      value: authStorage,
      configurable: true,
      writable: true,
    });
  } catch (e) {
    console.error("Failed to install auth storage wrapper", e);
  }
}

export const rememberMeKey = REMEMBER_KEY;
export function setRememberMe(value: boolean) {
  realLocalStorage?.setItem(REMEMBER_KEY, String(value));
}
export function getRememberMe(): boolean {
  return realLocalStorage?.getItem(REMEMBER_KEY) !== "false";
}
