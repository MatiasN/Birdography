/** Light, dark, or whatever the device uses. Stored per device (plan 0007 D3), not per account. */
export type Theme = "system" | "light" | "dark";

export const THEMES: readonly Theme[] = ["system", "light", "dark"];
const KEY = "theme"; // the same key public/theme.js reads before the app loads
const DARK_QUERY = "(prefers-color-scheme: dark)";

const isTheme = (value: unknown): value is Theme => THEMES.some((theme) => theme === value);

/** The stored choice; "system" when there is none, it's unknown, or storage is blocked. */
export function storedTheme(): Theme {
  try {
    const value = localStorage.getItem(KEY);
    return isTheme(value) ? value : "system";
  } catch {
    return "system";
  }
}

const systemDark = () => matchMedia(DARK_QUERY).matches;

/** Put `.dark` on <html> when the theme, or the system for "system", is dark. */
export function applyTheme(theme: Theme): void {
  const dark = theme === "dark" || (theme === "system" && systemDark());
  document.documentElement.classList.toggle("dark", dark);
}

/** Store and apply a choice. "system" removes the stored value, so a later default change reaches this device. */
export function setTheme(theme: Theme): void {
  try {
    if (theme === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {
    // storage blocked: the choice lasts until the page is reloaded
  }
  applyTheme(theme);
}

function onSystemChange() {
  if (storedTheme() === "system") applyTheme("system");
}

/** Follow the device switching between light and dark while "system" is chosen. Returns the unsubscribe. */
export function followSystemTheme(): () => void {
  const query = matchMedia(DARK_QUERY);
  query.addEventListener("change", onSystemChange);
  return () => query.removeEventListener("change", onSystemChange);
}
