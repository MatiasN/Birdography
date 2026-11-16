import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubMatchMedia } from "./test/media";
import { applyTheme, followSystemTheme, setTheme, storedTheme } from "./theme";

const isDark = () => document.documentElement.classList.contains("dark");

beforeEach(() => localStorage.clear());
afterEach(() => document.documentElement.classList.remove("dark"));

describe("storedTheme", () => {
  it("is system with nothing stored", () => {
    expect(storedTheme()).toBe("system");
  });

  it("returns a stored choice", () => {
    localStorage.setItem("theme", "dark");
    expect(storedTheme()).toBe("dark");
  });

  it("ignores an unknown value", () => {
    localStorage.setItem("theme", "sepia");
    expect(storedTheme()).toBe("system");
  });

  it("is system when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    expect(storedTheme()).toBe("system");
  });
});

describe("applyTheme", () => {
  it("follows the choice", () => {
    stubMatchMedia(true);
    applyTheme("light");
    expect(isDark()).toBe(false);
    applyTheme("dark");
    expect(isDark()).toBe(true);
  });

  it("follows the device for system", () => {
    stubMatchMedia(true);
    applyTheme("system");
    expect(isDark()).toBe(true);
    stubMatchMedia(false);
    applyTheme("system");
    expect(isDark()).toBe(false);
  });
});

describe("setTheme", () => {
  it("stores and applies a choice", () => {
    stubMatchMedia(false);
    setTheme("dark");
    expect(localStorage.getItem("theme")).toBe("dark");
    expect(isDark()).toBe(true);
  });

  it("removes the stored value for system", () => {
    stubMatchMedia(false);
    setTheme("dark");
    setTheme("system");
    expect(localStorage.getItem("theme")).toBeNull();
    expect(isDark()).toBe(false);
  });

  it("still applies the choice when storage is blocked", () => {
    stubMatchMedia(false);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "QuotaExceededError");
    });
    setTheme("dark");
    expect(isDark()).toBe(true);
  });
});

describe("followSystemTheme", () => {
  it("switches with the device while system is chosen", () => {
    const media = stubMatchMedia(false);
    const stop = followSystemTheme();
    media.set(true);
    expect(isDark()).toBe(true);
    media.set(false);
    expect(isDark()).toBe(false);
    stop();
    expect(media.listeners.size).toBe(0);
  });

  it("leaves an explicit choice alone", () => {
    const media = stubMatchMedia(false);
    setTheme("light");
    const stop = followSystemTheme();
    media.set(true);
    expect(isDark()).toBe(false);
    stop();
  });
});
