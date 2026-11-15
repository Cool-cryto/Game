import { expect, test, type Page } from "@playwright/test";

type MapHook = {
  screenPointOf: (id: string) => [number, number] | null;
  regionAt: (x: number, y: number) => string | null;
  regionCount: number;
};

async function openMap(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto("/");
  await page.waitForFunction(() => (window as unknown as { __gsMap?: MapHook }).__gsMap);
  return errors;
}

async function pointOf(page: Page, id: string) {
  const p = await page.evaluate((cid) => (window as unknown as { __gsMap: MapHook }).__gsMap.screenPointOf(cid), id);
  if (!p) throw new Error(`No point for ${id}`);
  return { x: p[0], y: p[1] };
}

test("loads every country and territory without errors", async ({ page }) => {
  const errors = await openMap(page);
  const count = await page.evaluate(() => (window as unknown as { __gsMap: MapHook }).__gsMap.regionCount);
  expect(count).toBe(241);
  await expect(page.getByTestId("zoom-level")).toHaveText("1.0×");
  expect(errors).toEqual([]);
});

test("hovering shows the name, clicking opens the country panel", async ({ page }) => {
  await openMap(page);
  const p = await pointOf(page, "BRA");
  await page.mouse.move(p.x, p.y);
  await expect(page.locator(".map-tooltip")).toHaveText("Brazil");
  await page.mouse.click(p.x, p.y);
  const panel = page.getByTestId("country-panel");
  await expect(panel.getByRole("heading", { name: "Brazil" })).toBeVisible();
  await expect(panel).toContainText("Brasília");
  await expect(panel).toContainText("Sovereign state");
});

test("clicking the ocean closes the panel", async ({ page }) => {
  await openMap(page);
  const p = await pointOf(page, "AUS");
  await page.mouse.click(p.x, p.y);
  await expect(page.getByTestId("country-panel")).toBeVisible();
  const ocean = await page.evaluate(() => {
    const m = (window as unknown as { __gsMap: MapHook }).__gsMap;
    for (let x = 400; x < 900; x += 10) if (!m.regionAt(x, 450)) return { x, y: 450 };
    return null;
  });
  expect(ocean).not.toBeNull();
  await page.mouse.click(ocean!.x, ocean!.y);
  await expect(page.getByTestId("country-panel")).toHaveCount(0);
});

test("search finds a country and zooms to it", async ({ page }) => {
  await openMap(page);
  await page.getByLabel("Search countries").fill("japa");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("country-panel").getByRole("heading", { name: "Japan" })).toBeVisible();
  await expect.poll(async () => parseFloat((await page.getByTestId("zoom-level").textContent()) ?? "0")).toBeGreaterThan(3);
  // Japan should now be on screen, left of the panel.
  const p = await pointOf(page, "JPN");
  expect(p.x).toBeGreaterThan(0);
  expect(p.x).toBeLessThan(1400 - 384);
});

test("islands that cross the date line can be found (Fiji)", async ({ page }) => {
  await openMap(page);
  await page.getByLabel("Search countries").fill("fiji");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("country-panel")).toContainText("Suva");
});

test("zoom buttons zoom in, out and back to the whole world", async ({ page }) => {
  await openMap(page);
  const level = page.getByTestId("zoom-level");
  await page.getByLabel("Zoom in").click();
  await page.getByLabel("Zoom in").click();
  await expect.poll(async () => parseFloat((await level.textContent()) ?? "0")).toBeGreaterThan(2.4);
  await page.getByLabel("Zoom out").click();
  await expect.poll(async () => parseFloat((await level.textContent()) ?? "0")).toBeLessThan(2);
  await page.getByLabel("Show whole world").click();
  await expect(level).toHaveText("1.0×");
});

test("mouse wheel zooms the map", async ({ page }) => {
  await openMap(page);
  await page.mouse.move(700, 400);
  await page.mouse.wheel(0, -600);
  await expect.poll(async () => parseFloat((await page.getByTestId("zoom-level").textContent()) ?? "0")).toBeGreaterThan(1.5);
});

test("neighbour buttons and Escape work in the panel", async ({ page }) => {
  await openMap(page);
  await page.getByLabel("Search countries").fill("switzerland");
  await page.keyboard.press("Enter");
  const panel = page.getByTestId("country-panel");
  await panel.getByRole("button", { name: "Liechtenstein" }).click();
  await expect(panel.getByRole("heading", { name: "Liechtenstein" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
});

test("territories and disputed regions are labelled honestly", async ({ page }) => {
  await openMap(page);
  await page.getByLabel("Search countries").fill("greenland");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("country-panel")).toContainText("Territory / dependency");
  await page.getByLabel("Search countries").fill("somaliland");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("country-panel")).toContainText("Disputed region");
});

test("continents map mode shows a legend", async ({ page }) => {
  await openMap(page);
  await expect(page.getByLabel("Continents legend")).toHaveCount(0);
  await page.getByRole("radio", { name: "Continents" }).click();
  await expect(page.getByLabel("Continents legend")).toContainText("Africa");
});

test("works on a phone-sized screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openMap(page);
  await page.getByLabel("Search countries").fill("india");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("country-panel")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
