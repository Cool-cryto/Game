import { expect, test, type Page } from "@playwright/test";

type MapHook = {
  screenPointOf: (kind: "country" | "province", id: string) => [number, number] | null;
  pick: (x: number, y: number) => { province: string; country: string } | null;
  counts: () => { provinces: number; countries: number; cities: number };
  detail: () => "low" | "high";
  highLoaded: () => boolean;
};
declare global {
  interface Window {
    __gsMap?: MapHook;
  }
}

async function openMap(page: Page, { waitForDetail = false } = {}) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto("/");
  await page.waitForFunction(() => window.__gsMap);
  if (waitForDetail) await page.waitForFunction(() => window.__gsMap!.highLoaded() && window.__gsMap!.counts().cities > 0, null, { timeout: 20_000 });
  return errors;
}

async function pointOf(page: Page, kind: "country" | "province", id: string) {
  const p = await page.evaluate(([k, i]) => window.__gsMap!.screenPointOf(k as "country", i!), [kind, id] as const);
  if (!p) throw new Error(`No point for ${id}`);
  return { x: p[0], y: p[1] };
}

const zoomLevel = async (page: Page) => parseFloat((await page.getByTestId("zoom-level").textContent()) ?? "0");
const panel = (page: Page) => page.getByTestId("info-panel");

async function searchFor(page: Page, text: string, pick = 0) {
  await page.getByLabel("Search", { exact: true }).fill(text);
  const options = page.getByRole("option");
  await expect(options.first()).toBeVisible();
  for (let i = 0; i < pick; i++) await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
}

test("loads every province, country and city without errors", async ({ page }) => {
  const errors = await openMap(page, { waitForDetail: true });
  const counts = await page.evaluate(() => window.__gsMap!.counts());
  expect(counts.provinces).toBe(4596);
  expect(counts.countries).toBe(248);
  expect(counts.cities).toBeGreaterThan(7000);
  await expect(page.getByTestId("zoom-level")).toHaveText("1.0×");
  expect(errors).toEqual([]);
});

test("zoomed out, clicking picks a country and shows its starting numbers", async ({ page }) => {
  await openMap(page, { waitForDetail: true });
  const p = await pointOf(page, "country", "BRA");
  await page.mouse.move(p.x, p.y);
  await expect(page.locator(".map-tooltip")).toHaveText("Brazil");
  await page.mouse.click(p.x, p.y);
  await expect(panel(page).getByRole("heading", { name: "Brazil" })).toBeVisible();
  await expect(panel(page)).toContainText("Population");
  await expect(panel(page)).toContainText("Natural Earth estimates for 2019");
  await expect(panel(page)).toContainText("São Paulo");
});

test("zoomed in, clicking picks a province, which links back to its country", async ({ page }) => {
  await openMap(page, { waitForDetail: true });
  await searchFor(page, "germany");
  await expect.poll(() => zoomLevel(page)).toBeGreaterThan(3);
  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);
  await page.waitForTimeout(800);
  const p = await pointOf(page, "province", "DEU-1591");
  await page.mouse.move(p.x, p.y);
  await expect(page.locator(".map-tooltip")).toContainText("· Germany");
  await page.mouse.click(p.x, p.y);
  await expect(panel(page).getByText("Part of")).toBeVisible();
  await panel(page).getByRole("button", { name: /Germany/ }).click();
  await expect(panel(page).getByRole("heading", { name: "Germany" })).toBeVisible();
});

test("detailed borders load when zoomed in", async ({ page }) => {
  await openMap(page, { waitForDetail: true });
  expect(await page.evaluate(() => window.__gsMap!.detail())).toBe("low");
  await searchFor(page, "switzerland");
  await expect.poll(() => page.evaluate(() => window.__gsMap!.detail())).toBe("high");
});

test("search finds provinces and cities and zooms to them", async ({ page }) => {
  await openMap(page, { waitForDetail: true });
  await page.getByLabel("Search", { exact: true }).fill("bavaria");
  await expect(page.getByRole("option").first()).toContainText("Germany");
  await page.keyboard.press("Enter");
  await expect(panel(page)).toContainText("Munich");

  await searchFor(page, "rio de janeiro");
  await expect(panel(page)).toContainText("Brazil");
  await expect.poll(() => zoomLevel(page)).toBeGreaterThan(10);
});

test("search ignores accents and shows the country of each result", async ({ page }) => {
  await openMap(page, { waitForDetail: true });
  await page.getByLabel("Search", { exact: true }).fill("sao paulo");
  await expect(page.getByRole("option").filter({ hasText: "São Paulo" }).first()).toContainText("Brazil");
});

test("clicking the ocean closes the panel", async ({ page }) => {
  await openMap(page);
  const p = await pointOf(page, "country", "AUS");
  await page.mouse.click(p.x, p.y);
  await expect(panel(page)).toBeVisible();
  const ocean = await page.evaluate(() => {
    for (let x = 400; x < 900; x += 10) if (!window.__gsMap!.pick(x, 450)) return { x, y: 450 };
    return null;
  });
  await page.mouse.click(ocean!.x, ocean!.y);
  await expect(panel(page)).toHaveCount(0);
});

test("zoom buttons and mouse wheel work", async ({ page }) => {
  await openMap(page);
  await page.getByLabel("Zoom in").click();
  await page.getByLabel("Zoom in").click();
  await expect.poll(() => zoomLevel(page)).toBeGreaterThan(2.4);
  await page.getByLabel("Zoom out").click();
  await expect.poll(() => zoomLevel(page)).toBeLessThan(2);
  await page.getByLabel("Show whole world").click();
  await expect(page.getByTestId("zoom-level")).toHaveText("1.0×");
  await page.mouse.move(700, 400);
  await page.mouse.wheel(0, -600);
  await expect.poll(() => zoomLevel(page)).toBeGreaterThan(1.5);
});

test("territories and disputed regions are labelled honestly", async ({ page }) => {
  await openMap(page);
  await searchFor(page, "greenland");
  await expect(panel(page)).toContainText("Territory / dependency");
  await searchFor(page, "somaliland");
  await expect(panel(page)).toContainText("Disputed region");
});

test("map modes recolor the map and show a legend", async ({ page }) => {
  await openMap(page);
  await expect(page.locator(".legend")).toHaveCount(0);
  for (const [mode, title] of [
    ["Continents", "Continents"],
    ["Population", "Population"],
    ["Wealth", "GDP per person"],
  ] as const) {
    await page.getByRole("radio", { name: mode }).click();
    await expect(page.locator(".legend")).toContainText(title);
  }
});

test("works on a phone-sized screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openMap(page);
  await searchFor(page, "india");
  await expect(panel(page)).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
