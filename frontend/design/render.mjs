// Renders the mockups to docs/design/*.png. Runs inside the Playwright image, started by scripts/mockups.sh:
// it starts Vite itself, so nothing depends on host networking. `node design/render.mjs catalogue map` renders
// only those pages.
import { mkdir } from "node:fs/promises";
import { createServer } from "vite";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");

const WIDE = { width: 1440, height: 900 };
const NARROW = { width: 390, height: 844 };
/** page, and whether it also gets dark screenshots (plan 0007 §3). */
const PAGES = [
  ["catalogue", true],
  ["photo", true],
  ["upload", false],
  ["map", true],
  ["species", false],
  ["near-me", false],
  ["profile", false],
  ["login", false],
  ["logo", false],
  ["components", true],
];

const only = process.argv.slice(2);
const out = new URL("../../docs/design/", import.meta.url).pathname;
await mkdir(out, { recursive: true });

const server = await createServer({ server: { host: "127.0.0.1", port: 5199, strictPort: true }, logLevel: "warn" });
await server.listen();
const browser = await chromium.launch();
try {
  for (const [page, dark] of PAGES.filter(([name]) => only.length === 0 || only.includes(name))) {
    const themes = dark ? ["light", "dark"] : ["light"];
    const sizes =
      page === "logo"
        ? [{ suffix: "", viewport: { width: 960, height: 420 } }]
        : page === "components"
          ? [{ suffix: "", viewport: WIDE }]
          : [
              { suffix: "-wide", viewport: WIDE },
              { suffix: "-narrow", viewport: NARROW },
            ];
    for (const theme of themes)
      for (const { suffix, viewport } of sizes) {
        const context = await browser.newContext({ viewport, deviceScaleFactor: 2, colorScheme: theme });
        const tab = await context.newPage();
        await tab.goto(`http://127.0.0.1:5199/design/${page}.html?theme=${theme}`, { waitUntil: "networkidle" });
        await tab.evaluate(() => document.fonts.ready);
        const file = `${page}${suffix}${theme === "dark" ? "-dark" : ""}.png`;
        await tab.screenshot({ path: out + file });
        process.stdout.write(`${file}\n`);
        await context.close();
      }
  }
} finally {
  await browser.close();
  await server.close();
}
