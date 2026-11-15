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
    ["region", "Continents"],
    ["population", "Population"],
    ["wealth", "GDP per person"],
    ["stability", "Stability"],
    ["technology", "Technology level"],
    ["infrastructure", "Infrastructure"],
    ["density", "People per km²"],
    ["energy", "Energy deposits"],
  ] as const) {
    await page.getByLabel("Map mode").selectOption(mode);
    await expect(page.locator(".legend")).toContainText(title);
  }
  await expect(page.locator(".legend")).toContainText("Game-generated");
});

test("works on a phone-sized screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openMap(page);
  await searchFor(page, "india");
  await expect(panel(page)).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

// ---------- Stage 3: simulation ----------

const gameDate = (page: Page) => page.getByTestId("game-date");

test("time starts paused, runs when played, and stops when paused", async ({ page }) => {
  await openMap(page);
  await expect(gameDate(page)).toContainText("1 Jan 2020");
  await expect(gameDate(page)).toContainText("Paused");
  await page.getByRole("radio", { name: "Speed 5" }).click();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(gameDate(page)).not.toContainText("2020", { timeout: 10_000 });
  await page.getByRole("button", { name: "Pause" }).click();
  // The worker may send one final update as it stops; after that the date must not move.
  await page.waitForTimeout(300);
  const stopped = await gameDate(page).textContent();
  await page.waitForTimeout(1000);
  expect(await gameDate(page).textContent()).toBe(stopped);
  // Space toggles pause too.
  await page.keyboard.press("Space");
  await expect(gameDate(page)).not.toContainText("Paused");
  await page.keyboard.press("Space");
  await expect(gameDate(page)).toContainText("Paused");
});

test("you can play as a country and change its policies", async ({ page }) => {
  await openMap(page);
  await expect(page.getByTestId("player-card")).toContainText("Play as");
  await searchFor(page, "japan");
  await panel(page).getByRole("button", { name: "Play as Japan" }).click();
  await expect(panel(page).getByLabel("Policies")).toBeVisible();
  await expect(page.getByTestId("player-card")).toContainText("Japan");

  // Raise taxes: the budget shows a surplus, and running time fills the treasury.
  const tax = panel(page).getByLabel("Tax rate");
  await tax.focus();
  for (let i = 0; i < 10; i++) await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("budget-balance")).toContainText("Surplus");
  await page.getByRole("radio", { name: "Speed 5" }).click();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(gameDate(page)).toContainText("2021", { timeout: 10_000 });
  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByTestId("player-card")).toContainText(/Treasury\s*\$[1-9]/);
});

test("other countries show their policies but can't be changed", async ({ page }) => {
  await openMap(page);
  await searchFor(page, "brazil");
  await expect(panel(page)).toContainText("Tax rate");
  await expect(panel(page).getByLabel("Policies")).toHaveCount(0);
  await expect(panel(page)).toContainText("AI decisions arrive in Stage 4");
});

test("save to a slot, keep playing, then load it back", async ({ page }) => {
  await openMap(page);
  await searchFor(page, "kenya");
  await panel(page).getByRole("button", { name: "Play as Kenya" }).click();
  await page.getByRole("button", { name: "Game", exact: true }).click();
  await page.getByTestId("slot-2").getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("slot-2")).toContainText("Kenya · 1 Jan 2020");
  await page.getByRole("button", { name: "Close menu" }).click();

  await page.getByRole("radio", { name: "Speed 5" }).click();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(gameDate(page)).not.toContainText("2020", { timeout: 10_000 });
  await page.getByRole("button", { name: "Pause" }).click();

  await page.getByRole("button", { name: "Game", exact: true }).click();
  await page.getByTestId("slot-2").getByRole("button", { name: "Load" }).click();
  await expect(gameDate(page)).toContainText("1 Jan 2020");
  await expect(page.getByTestId("player-card")).toContainText("Kenya");
});

test("saves survive reloading the page", async ({ page }) => {
  await openMap(page);
  await page.getByRole("button", { name: "Game", exact: true }).click();
  await page.getByTestId("slot-1").getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("slot-1")).toContainText("1 Jan 2020");
  await page.reload();
  await page.waitForFunction(() => window.__gsMap);
  await page.getByRole("button", { name: "Game", exact: true }).click();
  await expect(page.getByTestId("slot-1")).toContainText("1 Jan 2020");
});

test("importing a file that isn't a save shows a clear error", async ({ page }) => {
  await openMap(page);
  await page.getByRole("button", { name: "Game", exact: true }).click();
  await page.getByTestId("import-input").setInputFiles({ name: "notes.json", mimeType: "application/json", buffer: Buffer.from('{"hello":1}') });
  await expect(page.getByRole("status")).toContainText("isn't a saved game");
});
