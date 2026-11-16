import { describe, expect, it } from "vitest";
import { pageTitle } from "./nav";

describe("pageTitle", () => {
  it.each([
    ["/catalogue", "Catalogue"],
    ["/near-me", "Near me"],
    ["/map", "Map"],
    ["/profile", "Profile"],
    ["/elsewhere", "Birdography"],
  ])("%s is titled %s", (path, title) => {
    expect(pageTitle(path)).toBe(title);
  });
});
