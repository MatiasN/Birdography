// Screenshots of the real app for the README (docs/screenshots/*.webp), taken against the dev stack. Runs inside
// the Playwright image, started by scripts/screenshots.sh, which passes the stack's address and login and a folder
// of sample files for the Upload tab.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");

const { BASE, EMAIL, PASSWORD, OUT, FILES } = process.env;
const WIDE = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const QUALITY = 0.85; // lossy WebP: about a seventh of a PNG, text still sharp

const browser = await chromium.launch();

/** A logged-in tab at the given size; dark through the app's own theme choice, so the screenshot is what users get. */
async function open(viewport, { dark = false } = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL(/\/catalogue/);
  await page.evaluate((theme) => localStorage.setItem("theme", theme), dark ? "dark" : "light");
  await page.reload();
  return page;
}

/** PNG → WebP, encoded by Chromium itself, so no image library is needed. */
async function save(page, name) {
  await page.waitForTimeout(600); // tiles and map tiles settle
  const png = await page.screenshot();
  const dataUrl = await page.evaluate(
    ([b64, quality]) =>
      new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = img.width;
          canvas.height = img.height;
          canvas.getContext("2d").drawImage(img, 0, 0);
          resolve(canvas.toDataURL("image/webp", quality));
        };
        img.src = `data:image/png;base64,${b64}`;
      }),
    [png.toString("base64"), QUALITY],
  );
  const { writeFile } = await import("node:fs/promises");
  await writeFile(`${OUT}/${name}.webp`, Buffer.from(dataUrl.split(",")[1], "base64"));
  console.log(`${name}.webp`);
}

const tiles = (page) => page.locator("main button:has(img)");

// Catalogue with a photo open, light and dark.
for (const dark of [false, true]) {
  const page = await open(WIDE, { dark });
  await tiles(page).first().waitFor();
  await tiles(page).nth(1).click();
  await page.getByRole("complementary").waitFor();
  await page.getByRole("complementary").locator(".leaflet-tile-loaded").first().waitFor({ timeout: 15000 });
  await save(page, dark ? "catalogue-dark" : "catalogue");
  await page.context().close();
}

// Map with a group open, light and dark.
for (const dark of [false, true]) {
  const page = await open(WIDE, { dark });
  await page.goto(`${BASE}/map`);
  const markers = page.locator(".leaflet-marker-icon");
  await markers.first().waitFor();
  await page.waitForTimeout(800); // clusters settle after fitBounds
  // The busiest group: its marker shows the largest count.
  const counts = await markers.evaluateAll((els) => els.map((el) => Number(el.textContent) || 1));
  await markers.nth(counts.indexOf(Math.max(...counts))).click();
  await page.getByRole("complementary").waitFor();
  await page.locator(".leaflet-tile-loaded").first().waitFor({ timeout: 15000 });
  await save(page, dark ? "map-dark" : "map");
  await page.context().close();
}

/**
 * The Upload tab with a RAW+JPEG pair held because the files look like two shots, and a file already sent.
 * `fresh` is a JPEG new to this run (each theme needs its own, or the second is a duplicate).
 */
async function uploadShot(viewport, { dark, fresh, name, phone = false }) {
  const page = await open(viewport, { dark });
  await page.goto(`${BASE}/upload`);
  await page.getByRole("combobox", { name: "Add a species for the batch" }).fill("kingf");
  await page.getByRole("option", { name: /Common Kingfisher/ }).click();
  await page.locator('input[type="file"]').setInputFiles([`${FILES}/DSC_0412.NEF`, `${FILES}/DSC_0412.JPG`, `${FILES}/${fresh}`]);
  await page.getByRole("alert").waitFor();
  await page.locator("li", { hasText: fresh }).first().getByText("Done").waitFor({ timeout: 20000 });
  if (phone) {
    // Scroll so the batch species, the held pair's notice and the uploaded file are in view under the top bar.
    await page.getByText("Species for every photo in this batch").first().evaluate((el) => {
      el.scrollIntoView({ block: "start" });
      window.scrollBy(0, -72);
    });
  }
  await save(page, name);
  await page.context().close();
}

await uploadShot(WIDE, { dark: false, fresh: "DSC_0413.JPG", name: "upload" });
await uploadShot(WIDE, { dark: true, fresh: "DSC_0414.JPG", name: "upload-dark" });
await uploadShot(PHONE, { dark: false, fresh: "DSC_0415.JPG", name: "upload-phone", phone: true });

// The Catalogue on a phone.
{
  const page = await open(PHONE);
  await tiles(page).first().waitFor();
  await save(page, "catalogue-phone");
  await page.context().close();
}

// A photo's sheet on a phone.
{
  const page = await open(PHONE);
  await tiles(page).first().waitFor();
  await tiles(page).first().click();
  const sheet = page.getByRole("dialog");
  await sheet.waitFor();
  await sheet.locator(".leaflet-tile-loaded").first().waitFor({ timeout: 15000 });
  await save(page, "photo-phone");
  await page.context().close();
}

await browser.close();
