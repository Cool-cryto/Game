import { expect, test, type Page } from "@playwright/test";

type MapHook = {
  markerOf: (province: string, owner: string) => [number, number] | null;
  screenPointOf: (kind: "country" | "province", id: string) => [number, number] | null;
  pick: (x: number, y: number) => { province: string; country: string } | null;
  counts: () => { provinces: number; countries: number; cities: number };
  detail: () => "low" | "high";
  highLoaded: () => boolean;
};
type GlobeHook = {
  pick: (x: number, y: number) => { province: string; country: string } | null;
  camera: () => { lon: number; lat: number; radius: number; zoom: number };
  screenPointOfProvince: (id: string) => [number, number] | null;
  lookAt: (lon: number, lat: number, zoom?: number) => void;
};
declare global {
  interface Window {
    __gsMap?: MapHook;
    __gsGlobe?: GlobeHook;
    __gsGame?: { getState: () => { state: { countries: Record<string, { capital: string | null }> } } };
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

/** Country and province panels start short; this shows everything (and stays on for later panels). */
async function showDetails(page: Page) {
  await panel(page).getByRole("button", { name: "Show all details" }).click();
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
  await expect(panel(page)).toContainText("People");
  await showDetails(page);
  await expect(panel(page)).toContainText("Population");
  await expect(panel(page)).toContainText("Natural Earth estimates for 2019");
  await expect(panel(page)).toContainText("São Paulo");
});

test("zoomed in, the tooltip names the province, and clicking picks its country", async ({ page }) => {
  await openMap(page, { waitForDetail: true });
  await searchFor(page, "germany");
  await expect.poll(() => zoomLevel(page)).toBeGreaterThan(3);
  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);
  await page.waitForTimeout(800);
  const p = await pointOf(page, "province", "DEU-1591");
  await page.mouse.move(p.x, p.y);
  await expect(page.locator(".map-tooltip")).toContainText("· Germany");
  // Provinces aren't separate things to click any more: the click opens the country.
  await page.mouse.click(p.x, p.y);
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
  // Each click animates; wait for it to finish, or the next zoom starts from part-way.
  await page.getByLabel("Zoom in").click();
  await expect.poll(() => zoomLevel(page)).toBeGreaterThan(1.4);
  await page.waitForTimeout(400);
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
    ["diplomacy", "Relations with you"],
    ["wars", "Wars"],
  ] as const) {
    await page.getByLabel("Map mode").selectOption(mode);
    await expect(page.locator(".legend")).toContainText(title);
    if (mode === "energy") await expect(page.locator(".legend")).toContainText("Game-generated");
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

// ---------- Stage 3: simulation ----------

const gameDate = (page: Page) => page.getByTestId("game-date");

test("time stands still until you lead a country, then runs at the chosen speed; pause and 1x-4x work", async ({ page }) => {
  await openMap(page);
  await expect(gameDate(page)).toContainText("1 Jan 2020");
  await page.waitForTimeout(1000);
  await expect(gameDate(page)).toContainText("1 Jan 2020");
  // No speed controls before you lead a country.
  await expect(page.getByTestId("pause")).toHaveCount(0);
  await playAs(page, "Japan");
  const days = () =>
    page.evaluate(() => (window as unknown as { __gsGame: { getState: () => { state: { tick: number } } } }).__gsGame.getState().state.tick);
  const rate = async () => {
    await page.waitForTimeout(400); // let a speed change settle
    const t0 = await days();
    await page.waitForTimeout(2000);
    return ((await days()) - t0) / 2;
  };
  // 2x (21 days a second) is the default.
  await expect(page.getByTestId("speed-2")).toHaveAttribute("aria-checked", "true");
  let perSecond = await rate();
  expect(perSecond).toBeGreaterThan(15);
  expect(perSecond).toBeLessThan(27);
  await page.getByTestId("speed-4").click();
  perSecond = await rate();
  expect(perSecond).toBeGreaterThan(45);
  await page.getByTestId("speed-1").click();
  perSecond = await rate();
  expect(perSecond).toBeLessThan(15);
  // Pause with the button, resume with Space.
  await page.getByTestId("pause").click();
  await expect(gameDate(page)).toContainText("Paused");
  await page.waitForTimeout(300); // the step already running when you pressed pause finishes
  const t1 = await days();
  await page.waitForTimeout(700);
  expect(await days()).toBe(t1);
  await page.keyboard.press("Space");
  await page.waitForTimeout(700);
  expect(await days()).toBeGreaterThan(t1);
});

test("you can play as a country and change its policies", async ({ page }) => {
  await openMap(page);
  await expect(page.getByTestId("player-card")).toContainText("Choose a country");
  await searchFor(page, "japan");
  await panel(page).getByRole("button", { name: "Play as Japan" }).click();
  await expect(page.getByTestId("player-card")).toContainText("Japan");
  // Policies live in Economy → Detailed budget.
  await page.getByTestId("nav-economy").click();
  await page.getByRole("tab", { name: "Detailed budget" }).click();
  const policies = page.getByTestId("screen-economy").getByLabel("Policies");
  await expect(policies).toBeVisible();

  // Raise taxes: the budget shows a surplus, and running time fills the treasury.
  const tax = policies.getByLabel("Tax rate");
  await tax.focus();
  for (let i = 0; i < 10; i++) await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("budget-balance")).toContainText("Surplus");
  await expect(gameDate(page)).toContainText("2021", { timeout: 30_000 });
  await expect(page.getByTestId("player-card")).toContainText(/Treasury\s*\$[1-9]/);
  // Last month's ledger explains where the money came from.
  await page.getByTestId("screen-economy").getByRole("tab", { name: "Overview" }).click();
  const ledger = page.getByTestId("ledger");
  await expect(ledger).toContainText("Taxes");
  await expect(ledger).toContainText("Trade");
  await expect(ledger).toContainText("Change in the treasury");
});

test("other countries show their policies but can't be changed", async ({ page }) => {
  await openMap(page);
  await searchFor(page, "brazil");
  await showDetails(page);
  await expect(panel(page)).toContainText("Tax rate");
  await expect(panel(page).getByLabel("Policies")).toHaveCount(0);
  await expect(panel(page)).toContainText("Run by the computer");
});

test("save to a slot, keep playing, then load it back", async ({ page }) => {
  await openMap(page);
  await searchFor(page, "kenya");
  await panel(page).getByRole("button", { name: "Play as Kenya" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByTestId("slot-2").getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("slot-2")).toContainText(/Kenya · \d+ \w+ 2020/);
  await page.getByRole("button", { name: "Close menu" }).click();
  // Time runs on by itself.
  await expect(gameDate(page)).not.toContainText("2020", { timeout: 30_000 });

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByTestId("slot-2").getByRole("button", { name: "Load" }).click();
  // Back in 2020 (time may already have moved on a little since loading).
  await expect(gameDate(page)).toContainText("2020");
  await expect(page.getByTestId("player-card")).toContainText("Kenya");
});

test("saves survive reloading the page", async ({ page }) => {
  await openMap(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByTestId("slot-1").getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("slot-1")).toContainText("1 Jan 2020");
  await page.reload();
  await page.waitForFunction(() => window.__gsMap);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByTestId("slot-1")).toContainText("1 Jan 2020");
});

test("importing a file that isn't a save shows a clear error", async ({ page }) => {
  await openMap(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByTestId("import-input").setInputFiles({ name: "notes.json", mimeType: "application/json", buffer: Buffer.from('{"hello":1}') });
  await expect(page.getByRole("status")).toContainText("isn't a saved game");
});

// ---------- Stage 4: military, war and diplomacy ----------

async function playAs(page: Page, country: string) {
  await searchFor(page, country);
  await panel(page).getByRole("button", { name: `Play as ${country}` }).click();
  await expect(page.getByTestId("player-card")).toContainText(country);
}

test("your country panel shows its military, and recruiting needs defense funds", async ({ page }) => {
  await openMap(page);
  await playAs(page, "France");
  await showDetails(page);
  const military = panel(page).getByLabel("Military");
  await expect(military).toContainText("Units (population limit)");
  // Countries start with three months of defense money, so you can recruit straight away.
  const army = military.getByRole("button", { name: /^Army/ });
  await expect(army).toBeEnabled();
  const before = await military.locator(".stat__value").first().textContent();
  await army.click();
  await expect(military.locator(".stat__value").first()).not.toHaveText(before!);
});

test("select your units and march them somewhere", async ({ page }) => {
  await openMap(page);
  await playAs(page, "France");
  await showDetails(page);
  await panel(page).getByLabel("Military").locator(".stack-list button").first().click();
  await expect(panel(page)).toContainText("Your forces");
  await panel(page).getByRole("button", { name: /^Move \d+ unit/ }).click();
  // Pick the destination with search; the panel offers "Send units here".
  await searchFor(page, "brittany");
  await panel(page).getByRole("button", { name: "Send units here" }).click();
  await searchFor(page, "france");
  await expect(panel(page).getByLabel("Military")).toContainText(/Marching to .* · \d+ days/);
});

test("click your army on the map, then click where it should go", async ({ page }) => {
  const errors = await openMap(page);
  await playAs(page, "France");
  await page.keyboard.press("Escape");
  // Zoom to France so its armies show, then find one army's marker and another French province on screen.
  await searchFor(page, "france");
  await page.keyboard.press("Escape");
  const plan = await page.evaluate(() => {
    const s = (window as unknown as { __gsGame: { getState: () => { state: { units: Record<string, { id: number; owner: string; type: string; province: string }>; provinces: Record<string, { owner: string }> } } } }).__gsGame.getState().state;
    const m = window.__gsMap!;
    const army = Object.values(s.units).find((u) => u.owner === "FRA" && u.type === "army" && m.markerOf(u.province, "FRA"));
    if (!army) return null;
    // Somewhere in France on screen, away from every unit marker (clicking a marker selects those units instead).
    const marks = Object.values(s.units)
      .map((u) => m.markerOf(u.province, u.owner))
      .filter((x): x is [number, number] => !!x);
    const clear = (pt: [number, number] | null) => !!pt && pt[0] > 100 && pt[0] < 800 && pt[1] > 150 && pt[1] < 700 && marks.every(([x, y]) => Math.hypot(x - pt[0], y - pt[1]) > 45);
    const target = Object.keys(s.provinces).find((id) => s.provinces[id]!.owner === "FRA" && id !== army.province && clear(m.screenPointOf("province", id)));
    return target ? { id: army.id, marker: m.markerOf(army.province, "FRA")!, target, point: m.screenPointOf("province", target)! } : null;
  });
  expect(plan).not.toBeNull();
  await page.mouse.click(plan!.marker[0], plan!.marker[1]);
  await expect(panel(page)).toContainText("Ready to move");
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/units.png` });
  await page.mouse.click(plan!.point[0], plan!.point[1]);
  await expect
    .poll(() =>
      page.evaluate((id) => {
        const s = (window as unknown as { __gsGame: { getState: () => { state: { units: Record<string, { path: string[] }> } } } }).__gsGame.getState().state;
        return s.units[id]?.path.length ?? 0;
      }, plan!.id),
    )
    .toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test("diplomacy: relations can be improved; alliances need good relations", async ({ page }) => {
  await openMap(page);
  await playAs(page, "Portugal");
  await showDetails(page);
  await searchFor(page, "brazil");
  const diplomacy = panel(page).getByLabel("Diplomacy");
  await expect(diplomacy.getByRole("button", { name: "Propose alliance" })).toBeDisabled();
  await expect(diplomacy).toContainText("Relations must be at least 40");
  await expect(page.getByTestId("relation")).toContainText(/^0 /);
  await diplomacy.getByRole("button", { name: "Improve relations" }).click();
  await expect(page.getByTestId("relation")).toContainText(/^15 /);
  await expect(diplomacy.getByRole("button", { name: "Improve relations" })).toBeDisabled();
});

test("war: declare, invade, occupy, and the enemy is annexed", async ({ page }) => {
  test.setTimeout(90_000);
  await openMap(page, { waitForDetail: true });
  await playAs(page, "France");
  await showDetails(page);
  await searchFor(page, "monaco");
  await panel(page).getByRole("button", { name: "Declare war…" }).click();
  await panel(page).getByRole("button", { name: "Declare war", exact: true }).click();
  await expect(page.getByTestId("player-card")).toContainText("At war");

  // Send the first French army stack to Monaco.
  await searchFor(page, "france");
  await panel(page).getByLabel("Military").locator(".stack-list button").first().click();
  await panel(page).getByRole("button", { name: /^Move \d+ unit/ }).click();
  // Monaco is tiny: target it through search and "Send units here".
  await searchFor(page, "monaco");
  await panel(page).getByRole("button", { name: "Send units here" }).click();

  // Monaco's capital is taken, held for 7 months (about 10 seconds), and Monaco falls.
  await expect(page.getByTestId("news-list")).toContainText("has taken the capital of Monaco", { timeout: 40_000 });
  await expect(page.getByTestId("news-list")).toContainText("Monaco has been annexed", { timeout: 40_000 });
  await expect(page.getByTestId("player-card")).not.toContainText("At war");
  // The province itself now belongs to France.
  const owner = await page.evaluate(() => {
    const m = window.__gsMap!;
    const p = m.screenPointOf("province", "MCO+00?");
    return p ? m.pick(p[0], p[1])?.country : null;
  });
  expect(owner).toBe("FRA");
});

// ---------- Stage 5: 3D globe ----------

async function openGlobe(page: Page) {
  const errors = await openMap(page);
  await page.getByTestId("view-toggle").click();
  await page.waitForFunction(() => window.__gsGlobe, null, { timeout: 20_000 });
  await expect(page.getByTestId("globe-canvas")).toBeVisible();
  return errors;
}

test("the 3D globe opens without errors and can be switched back", async ({ page }) => {
  const errors = await openGlobe(page);
  await expect(page.getByTestId("view-toggle")).toHaveText("2D");
  await expect(page.getByTestId("map-canvas")).toBeHidden();
  await page.getByTestId("view-toggle").click();
  await expect(page.getByTestId("map-canvas")).toBeVisible();
  await expect(page.getByTestId("globe-canvas")).toBeHidden();
  // The G key toggles too.
  await page.keyboard.press("g");
  await expect(page.getByTestId("globe-canvas")).toBeVisible();
  expect(errors).toEqual([]);
});

test("dragging spins the globe; zoom buttons and wheel zoom it", async ({ page }) => {
  await openGlobe(page);
  const before = await page.evaluate(() => window.__gsGlobe!.camera());
  await page.mouse.move(700, 450);
  await page.mouse.down();
  await page.mouse.move(520, 380, { steps: 8 });
  await page.mouse.up();
  const after = await page.evaluate(() => window.__gsGlobe!.camera());
  expect(Math.abs(after.lon - before.lon)).toBeGreaterThan(10);
  expect(after.lat).not.toBeCloseTo(before.lat, 1);

  await page.getByLabel("Zoom in").click();
  await expect.poll(() => zoomLevel(page)).toBeGreaterThan(1.4);
  await page.mouse.move(700, 450);
  await page.mouse.wheel(0, -400);
  await expect.poll(() => zoomLevel(page)).toBeGreaterThan(2);
  await page.getByLabel("Show whole world").click();
  await expect.poll(() => zoomLevel(page)).toBeLessThan(1.05);
});

test("clicking the globe selects the country under the pointer", async ({ page }) => {
  await openGlobe(page);
  const capital = await page.evaluate(() => window.__gsGame!.getState().state.countries["BRA"]!.capital!);
  await page.evaluate(() => window.__gsGlobe!.lookAt(-50, -12, 1));
  await page.waitForTimeout(200);
  const p = await page.evaluate((id) => window.__gsGlobe!.screenPointOfProvince(id), capital);
  expect(p).not.toBeNull();
  expect(await page.evaluate(([x, y]) => window.__gsGlobe!.pick(x!, y!)?.country, p!)).toBe("BRA");
  await page.mouse.move(p![0], p![1]);
  await expect(page.locator(".globe .map-tooltip")).toHaveText("Brazil");
  await page.mouse.click(p![0], p![1]);
  await expect(panel(page).getByRole("heading", { name: "Brazil" })).toBeVisible();
});

test("search flies the globe to a place, and map modes recolor it", async ({ page }) => {
  await openGlobe(page);
  await searchFor(page, "japan");
  await expect.poll(() => zoomLevel(page)).toBeGreaterThan(2);
  // Wait for the flight to finish, then check we're looking at Japan.
  await expect.poll(() => page.evaluate(() => Math.round(window.__gsGlobe!.camera().lon))).toBeGreaterThan(125);
  expect((await page.evaluate(() => window.__gsGlobe!.camera())).lon).toBeLessThan(150);
  await page.getByLabel("Map mode").selectOption("wealth");
  await expect(page.locator(".legend")).toContainText("GDP per person");
});

test("the globe works on a phone-sized screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openGlobe(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await searchFor(page, "egypt");
  await expect(panel(page)).toBeVisible();
});

// ---------- Stage 7: scenarios and the world editor ----------

async function openNewGame(page: Page) {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByLabel("Scenarios")).toBeVisible();
}

test("start the End of the Cold War scenario (1991)", async ({ page }) => {
  await openMap(page);
  await openNewGame(page);
  await page.getByTestId("scenario-cold-war-1991").getByRole("button", { name: "Start…" }).click();
  await page.getByTestId("scenario-cold-war-1991").getByRole("button", { name: "Start new game" }).click();
  await expect(page.getByTestId("game-date")).toContainText("1 Jan 1991");
  await searchFor(page, "soviet union");
  await expect(panel(page).getByRole("heading", { name: "Soviet Union" })).toBeVisible();
  await showDetails(page);
  await expect(panel(page)).toContainText("World Bank figures for 1991");
  await expect(panel(page)).toContainText("Land borders"); // worked out from the 1991 map
  await expect(panel(page)).toContainText("Poland");
  // Ukraine is part of the Soviet Union here.
  await searchFor(page, "kyiv");
  await expect(panel(page)).toContainText("Soviet Union");
});

test("world editor: create a country, give it land, play it", async ({ page }) => {
  await openMap(page, { waitForDetail: true });
  await openNewGame(page);
  await page.getByTestId("open-editor").click();
  await expect(page.getByTestId("editor")).toBeVisible();
  await expect(page.getByRole("button", { name: "Play this world" })).toBeEnabled(); // finished loading
  await page.getByLabel("World name").fill("Free Bavaria test");
  await page.getByLabel("New country name").fill("Free Bavaria");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByTestId("brush")).toContainText("Free Bavaria");
  await searchFor(page, "bavaria");
  await page.waitForTimeout(900);
  const p = await pointOf(page, "province", "DEU-1591");
  await page.mouse.click(p.x, p.y);
  await expect(page.getByTestId("editor-stats")).toContainText("1 province changed · 1 new country");
  // Undo and redo the change.
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByTestId("editor-stats")).toContainText("0 provinces changed");
  await page.mouse.click(p.x, p.y);
  await expect(page.getByTestId("editor-stats")).toContainText("1 province changed");

  await page.getByRole("button", { name: "Save in browser" }).click();
  await expect(page.getByRole("status")).toContainText("Saved");
  await page.getByRole("button", { name: "Play this world" }).click();
  await expect(page.getByTestId("editor")).toHaveCount(0);
  await page.waitForTimeout(900);
  await page.mouse.click(p.x, p.y);
  // Clicking the map opens the country there: the new one.
  await expect(panel(page)).toContainText("Free Bavaria");

  // The saved world is offered as a new game.
  await openNewGame(page);
  await expect(page.getByTestId("world-Free Bavaria test")).toBeVisible();
});

test("closing the editor brings your game back", async ({ page }) => {
  await openMap(page);
  await searchFor(page, "japan");
  await panel(page).getByRole("button", { name: "Play as Japan" }).click();
  await openNewGame(page);
  await page.getByTestId("open-editor").click();
  await expect(page.getByTestId("editor")).toBeVisible();
  await page.getByRole("button", { name: "Close editor" }).click();
  await expect(page.getByTestId("player-card")).toContainText("Japan");
});

test("importing a file that isn't a custom world shows a clear error", async ({ page }) => {
  await openMap(page);
  await openNewGame(page);
  await page.getByTestId("open-editor").click();
  await page.getByTestId("world-import").setInputFiles({ name: "notes.json", mimeType: "application/json", buffer: Buffer.from('{"hello":1}') });
  await expect(page.getByRole("status")).toContainText(/scenario this game doesn't have|isn't a custom world|different version/);
});

test("fog of war hides foreign forces far from you, and can be switched off", async ({ page }) => {
  await openMap(page);
  // Brazil's starting armies are in its biggest provinces, such as São Paulo.
  const forces = panel(page).getByRole("heading", { name: "Forces here" });
  await searchFor(page, "são paulo");
  await expect(panel(page).getByRole("heading", { name: "São Paulo" })).toBeVisible();
  await expect(forces).toBeVisible(); // no country chosen yet: nothing is hidden

  await playAs(page, "Japan");
  await searchFor(page, "são paulo");
  await expect(panel(page).getByRole("heading", { name: "São Paulo" })).toBeVisible();
  await expect(forces).toHaveCount(0); // far from Japan: hidden
  await searchFor(page, "tokyo");
  await expect(forces).toBeVisible(); // your own are always shown

  // Switch fog off in the Game menu.
  await page.getByRole("button", { name: "Settings" }).click();
  const fog = page.getByRole("checkbox", { name: /Fog of war/ });
  await expect(fog).toBeChecked();
  await fog.uncheck();
  await page.getByRole("button", { name: "Close menu" }).click();
  await searchFor(page, "são paulo");
  await expect(forces).toBeVisible();
});

test.describe("top navigation (first-time player)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("start screen, guide, every screen opens with its tabs, and your country stays yours", async ({ page }) => {
    const errors = await openMap(page);
    const start = page.getByTestId("start-screen");
    await expect(start).toContainText("Your goal");
    await expect(page.getByTestId("start-scenario")).toContainText("Modern World");
    // Search any country, see its starting figures, pick a difficulty, start.
    await page.getByTestId("start-search").fill("viet");
    await start.getByRole("option", { name: /Vietnam/ }).click();
    await expect(page.getByTestId("start-detail")).toContainText("Population");
    await expect(page.getByTestId("start-detail")).toContainText("Military (est.)");
    await page.getByTestId("start-search").fill("");
    await start.getByRole("option", { name: /France/ }).click();
    await page.getByTestId("difficulty-hard").click();
    await page.getByTestId("start-game").click();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __gsGame: { getState: () => { state: { settings: { difficulty: string } } } } }).__gsGame.getState().state.settings.difficulty))
      .toBe("hard");
    await expect(page.getByTestId("guide")).toContainText("You lead France");
    await page.getByRole("button", { name: "Let's go" }).click();
    await expect(page.getByTestId("player-card")).toContainText("Rank");

    // Every navigation button opens its own screen; every tab shows content; World goes back to the map.
    const screens: [string, string[]][] = [
      ["country", ["Overview", "Provinces", "History"]],
      ["economy", ["Overview", "Budget & taxes", "Resources & trade", "Debt", "Detailed budget"]],
      ["military", ["Overview", "Forces", "Generals", "Unit types", "Military budget"]],
      ["diplomacy", ["Relations", "Wars & peace", "Alliances", "Treaties", "Organizations"]],
      ["government", ["Overview", "Parties & elections", "Laws", "Stability"]],
      ["research", ["Overview", "Technology tree", "Research spending"]],
      ["construction", ["Overview", "Build", "By province", "Infrastructure"]],
      ["statistics", ["Economy (GDP)", "Population", "GDP per person", "Military spending", "Technology", "Your charts"]],
      ["more", ["Population", "News", "Intelligence", "Settings"]],
    ];
    for (const [id, tabs] of screens) {
      await page.getByTestId(`nav-${id}`).click();
      const screen = page.getByTestId(`screen-${id}`);
      await expect(screen).toBeVisible();
      await expect(page.locator(".screen")).toHaveCount(1); // only one screen at a time
      for (const t of tabs) {
        await screen.getByRole("tab", { name: t, exact: true }).click();
        await expect(screen.getByRole("tabpanel")).not.toBeEmpty();
      }
    }
    await page.getByTestId("screen-more").getByRole("tab", { name: "Intelligence" }).click();
    await expect(page.getByTestId("screen-more").getByTestId("planned")).toContainText("Coming in a later update");
    await page.getByTestId("nav-world").click();
    await expect(page.locator(".screen")).toHaveCount(0);

    // Economy: a focus sets a balanced budget.
    await page.getByTestId("nav-economy").click();
    await page.getByRole("tab", { name: "Budget & taxes" }).click();
    await page.getByRole("button", { name: /Grow the economy/ }).click();
    await expect(page.getByRole("button", { name: /Grow the economy/ })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Back to map" }).click();
    await expect(page.locator(".screen")).toHaveCount(0);

    // Diplomacy: declare war on a neighbour, then one-click attack.
    await page.getByTestId("nav-diplomacy").click();
    await page.getByRole("tab", { name: "Relations" }).click();
    // (Not Belgium or Germany: fellow NATO members can't attack each other.)
    const neighbour = page.getByTestId("relations-CHE");
    await neighbour.getByRole("button", { name: "War" }).click();
    await neighbour.getByRole("button", { name: "Yes, declare war" }).click();
    await page.getByRole("tab", { name: "Wars & peace" }).click();
    const war = page.locator(".swar");
    await expect(war).toContainText("vs Switzerland");
    await war.getByRole("button", { name: "Attack" }).click();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const s = (window as unknown as { __gsGame: { getState: () => { state: { units: Record<string, { owner: string; type: string; path: string[] }> } } } }).__gsGame.getState().state;
          return Object.values(s.units).filter((u) => u.owner === "FRA" && u.type === "army" && u.path.length > 0).length;
        }),
      )
      .toBeGreaterThan(0);

    // Your country is locked in: other countries offer no way to switch.
    await page.keyboard.press("Escape");
    await searchFor(page, "germany");
    await expect(panel(page)).toContainText("start a new game");
    await expect(panel(page).getByRole("button", { name: /Play as/ })).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("navigation never overlaps, from a phone to a wide screen", async ({ page }) => {
    for (const width of [390, 800, 1180, 1440, 1920]) {
      await page.setViewportSize({ width, height: 860 });
      await openMap(page);
      const boxes = await page
        .locator(".topnav__btn, .topnav__tools > :not(dialog)")
        .evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width })));
      for (const b of boxes) expect(b.w).toBeGreaterThan(0); // every button is shown
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) {
          const [a, b] = [boxes[i]!, boxes[j]!];
          const overlap = a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5;
          expect(overlap, `overlap at ${width}px`).toBe(false);
        }
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    }
  });
});

test("government: real starting government, party support, changing a law, early elections only for democracies", async ({ page }) => {
  await openMap(page);
  // Short panels say how a country is governed (V-Dem / Wikidata).
  await searchFor(page, "saudi arabia");
  await expect(page.getByTestId("government-line")).toContainText("Absolute monarchy");
  await searchFor(page, "united kingdom");
  await expect(page.getByTestId("government-line")).toContainText("Constitutional monarchy");
  await panel(page).getByRole("button", { name: "Play as United Kingdom" }).click();

  await page.getByTestId("nav-government").click();
  const screen = page.getByTestId("screen-government");
  await expect(screen).toContainText("Liberal democracy");
  await expect(screen).toContainText("V-Dem");
  await screen.getByRole("tab", { name: "Parties & elections" }).click();
  await expect(screen.getByTestId("party-support")).toContainText("In government");
  // Too soon? No: no election has happened yet, so an early one can be called.
  await expect(screen.getByRole("button", { name: "Call an early election" })).toBeEnabled();

  await screen.getByRole("tab", { name: "Laws" }).click();
  await screen.getByRole("button", { name: /Limited conscription/ }).click();
  await expect(screen.getByRole("button", { name: /Limited conscription/ })).toHaveAttribute("aria-pressed", "true");
  await expect(screen.getByRole("button", { name: /Mass mobilisation/ })).toBeDisabled(); // cooldown
  await expect(page.getByTestId("news-list")).toContainText("changed its conscription law");

  // The map can show every country's government.
  await page.getByTestId("nav-world").click();
  await page.getByLabel("Map mode").selectOption("government");
  await expect(page.locator(".legend")).toContainText("Closed autocracy");
});

test("research: three branches, choosing a focus, and the technology tree", async ({ page }) => {
  await openMap(page);
  await playAs(page, "Germany");
  await page.getByTestId("nav-research").click();
  const screen = page.getByTestId("screen-research");
  await expect(screen).toContainText("Economy");
  await expect(screen).toContainText("Infrastructure");
  await screen.getByRole("radio", { name: "Military" }).click();
  await expect(screen.getByRole("radio", { name: "Military" })).toHaveAttribute("aria-checked", "true");
  await expect(screen).toContainText("Researching now: Military");
  await screen.getByRole("tab", { name: "Technology tree" }).click();
  // Germany starts at level 6: Computing (economy 6) is unlocked, Automation (economy 9) is not yet.
  await expect(screen.getByTestId("tech-computing")).toContainText("Unlocked");
  await expect(screen.getByTestId("tech-automation")).toContainText("Next");
  await expect(screen.getByTestId("tech-ai")).toContainText("Level 15");
});

test("construction: order a factory, see it under construction, and it finishes", async ({ page }) => {
  test.setTimeout(60_000);
  await openMap(page);
  await playAs(page, "France");
  await page.getByTestId("nav-construction").click();
  const screen = page.getByTestId("screen-construction");
  await screen.getByRole("tab", { name: "Build" }).click();
  await screen.getByRole("radio", { name: "Factory" }).click();
  // The biggest province is first; order a factory there.
  const first = screen.getByTestId("build-table").locator("tbody tr").first();
  await first.getByRole("button", { name: "Build" }).click();
  await expect(first).toContainText("(+1)");
  await expect(page.getByTestId("player-card")).toContainText(/Treasury\s*-\$/); // paid by borrowing
  await screen.getByRole("tab", { name: "Overview" }).click();
  await expect(screen.getByTestId("projects")).toContainText("Factory");
  // Time runs by itself until it's done.
  await expect(screen).toContainText("Nothing being built", { timeout: 30_000 });
  await screen.getByRole("tab", { name: "By province" }).click();
  await expect(screen.getByTestId("province-buildings").locator("tbody tr").first()).toContainText("1");
});

test("treaties and organizations: sign a pact, see your real organizations, found one", async ({ page }) => {
  const errors = await openMap(page);
  await playAs(page, "France");
  await page.getByTestId("nav-diplomacy").click();
  const screen = page.getByTestId("screen-diplomacy");
  await screen.getByRole("tab", { name: "Treaties" }).click();
  await expect(screen.getByTestId("my-treaties")).toHaveCount(0);
  // Pick Germany (a neighbour) and propose a non-aggression pact: the computer says yes at neutral relations.
  await screen.getByTestId("treaty-pick-DEU").click();
  const options = screen.getByTestId("treaty-options");
  await expect(options).toContainText("Trade agreement");
  await expect(options.getByTestId("propose-trade")).toBeDisabled(); // relations aren't good enough yet
  await options.getByTestId("propose-nonAggression").click();
  await expect(screen.getByTestId("my-treaties")).toContainText("Germany");
  await expect(screen.getByTestId("my-treaties")).toContainText("Non-aggression pact");
  await page.screenshot({ path: process.env.SHOTS ? `${process.env.SHOTS}/treaties.png` : "test-results/treaties.png" });
  // A pact means no war: the War button is off for Germany.
  await screen.getByRole("tab", { name: "Relations" }).click();
  await expect(screen.getByTestId("relations-DEU").getByRole("button", { name: "War" })).toBeDisabled();

  // France starts in its real organizations.
  await screen.getByRole("tab", { name: "Organizations" }).click();
  await expect(screen.getByTestId("org-data:NATO")).toContainText("Defense alliance");
  await expect(screen.getByTestId("org-data:EU")).toContainText("28 members");
  await page.screenshot({ path: process.env.SHOTS ? `${process.env.SHOTS}/organizations.png` : "test-results/organizations.png" });
  // Found a new one.
  await screen.getByLabel("Organization name").fill("Channel Union");
  await screen.getByRole("button", { name: "Found" }).click();
  await expect(screen).toContainText("Channel Union");
  await expect(screen.getByRole("button", { name: "Found" })).toBeDisabled(); // one per country
  expect(errors).toEqual([]);
});

test("W/A/S/D move the camera on the flat map and the globe, but not while typing", async ({ page }) => {
  const errors = await openMap(page);
  const france = () => page.evaluate(() => window.__gsMap!.screenPointOf("country", "FRA"));
  const before = (await france())!;
  await page.keyboard.down("d");
  await page.waitForTimeout(400);
  await page.keyboard.up("d");
  const after = (await france())!;
  expect(after[0]).toBeLessThan(before[0] - 50); // looking further east: France moves left on screen
  expect(Math.abs(after[1] - before[1])).toBeLessThan(5);
  // Typing a "d" in the search box doesn't move the map.
  await page.getByLabel("Search", { exact: true }).click();
  await page.keyboard.down("d");
  await page.waitForTimeout(300);
  await page.keyboard.up("d");
  expect((await france())![0]).toBeCloseTo(after[0], 0);
  await page.getByLabel("Search", { exact: true }).fill("");
  await page.locator("body").click({ position: { x: 5, y: 400 } });

  // The globe turns the same way.
  await page.getByTestId("view-toggle").click();
  await page.waitForFunction(() => window.__gsGlobe, null, { timeout: 20_000 });
  const cam0 = await page.evaluate(() => window.__gsGlobe!.camera());
  await page.keyboard.down("s");
  await page.waitForTimeout(400);
  await page.keyboard.up("s");
  const cam1 = await page.evaluate(() => window.__gsGlobe!.camera());
  expect(cam1.lat).toBeLessThan(cam0.lat - 3); // looking further south
  expect(errors).toEqual([]);
});

test("the game is autosaved and comes back after a page refresh", async ({ page }) => {
  await openMap(page);
  await playAs(page, "Japan");
  const tickNow = () => page.evaluate(() => (window as unknown as { __gsGame: { getState: () => { state: { tick: number } } } }).__gsGame.getState().state.tick);
  await page.waitForTimeout(6000); // past the first autosave
  const before = await tickNow();
  expect(before).toBeGreaterThan(30);
  await page.reload();
  await page.waitForFunction(() => window.__gsMap);
  await expect(page.getByTestId("autosave-notice")).toContainText("Japan");
  await expect(page.getByTestId("player-card")).toContainText("Japan");
  // At most one autosave interval (5 seconds, ~105 days at 2x) is lost, even if the save on closing doesn't finish.
  const restored = await tickNow();
  expect(restored).toBeGreaterThan(30);
  expect(restored).toBeGreaterThanOrEqual(before - 110);
  // Time keeps running after the restore.
  const t = await tickNow();
  await page.waitForTimeout(1000);
  expect(await tickNow()).toBeGreaterThan(t);
});

test("military: recruit a chosen unit type in numbers, it trains first; hire and assign a general", async ({ page }) => {
  await openMap(page);
  await playAs(page, "France");
  await page.getByTestId("nav-military").click();
  const screen = page.getByTestId("screen-military");
  const count = () =>
    page.evaluate(() => Object.values((window as unknown as { __gsGame: { getState: () => { state: { units: Record<string, { owner: string; kind: string; training?: number }> } } } }).__gsGame.getState().state.units).filter((u) => u.owner === "FRA" && u.kind === "artillery" && u.training).length);
  await screen.getByTestId("kind-artillery").click();
  await screen.getByTestId("recruit-count").fill("2");
  await screen.getByTestId("recruit-button").click();
  await expect.poll(count).toBe(2);
  await screen.getByRole("tab", { name: "Forces" }).click();
  await expect(page.getByTestId("forces-table")).toContainText("artillery");
  // Unit types: locked kinds say what research they need.
  await screen.getByRole("tab", { name: "Unit types" }).click();
  await expect(page.getByTestId("unit-catalogue")).toContainText("Aircraft carriers");
  // Generals.
  await screen.getByRole("tab", { name: "Generals" }).click();
  await page.getByTestId("hire-general").click();
  const list = page.getByTestId("generals-list");
  await expect(list.locator(".general")).toHaveCount(1);
  const select = list.locator("select").first();
  const option = await select.locator("option").nth(1).getAttribute("value");
  await select.selectOption(option!);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __gsGame: { getState: () => { state: { generals: { unit: number | null }[] } } } }).__gsGame.getState().state.generals.filter((g) => g.unit !== null).length))
    .toBeGreaterThan(0);
});
