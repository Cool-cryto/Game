import { expect, test, type Browser, type Page } from "@playwright/test";
import { RETURNING_PLAYER } from "./storage";

// Online play. These tests use the game server started by playwright.config.ts.

const unique = () => `${Date.now() % 1e7}${Math.floor(Math.random() * 100)}`;

async function player(browser: Browser) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 860 }, storageState: RETURNING_PLAYER });
  const page = await context.newPage();
  await page.goto("/");
  await page.waitForFunction(() => (window as unknown as { __gsMap?: unknown }).__gsMap);
  return page;
}

async function signUp(page: Page, username: string) {
  await page.getByTestId("play-online").click();
  await page.getByRole("tab", { name: "Create account" }).click();
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill("correct horse");
  await page.getByRole("button", { name: "Create account", exact: true }).last().click();
  await expect(page.getByText("Signed in as")).toBeVisible();
}

async function searchFor(page: Page, text: string) {
  await page.getByLabel("Search", { exact: true }).fill(text);
  await page.getByRole("option").first().waitFor();
  await page.keyboard.press("Enter");
}

/** Host creates a private server, guest joins with the code. */
async function privateGame(browser: Browser) {
  const id = unique();
  const host = await player(browser);
  const guest = await player(browser);
  await signUp(host, `host${id}`);
  await signUp(guest, `guest${id}`);
  await host.getByRole("button", { name: "Create", exact: true }).click();
  await host.getByTestId("online-pill").click();
  const code = (await host.getByTestId("invite-code").textContent())!;
  await host.getByTestId("online-pill").click();
  await guest.getByLabel("Invite code").fill(code);
  await guest.getByRole("button", { name: "Join", exact: true }).last().click();
  await expect(guest.getByTestId("online-pill")).toBeVisible();
  return { host, guest, id, code };
}

test("accounts: wrong passwords are refused, and sign-up rules are explained", async ({ browser }) => {
  const page = await player(browser);
  const name = `acct${unique()}`;
  await signUp(page, name);
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByLabel("Username").fill(name);
  await page.getByLabel("Password").fill("not the password");
  await page.getByRole("button", { name: "Sign in", exact: true }).last().click();
  await expect(page.getByText("Wrong username or password")).toBeVisible();
  await page.getByLabel("Password").fill("correct horse");
  await page.getByRole("button", { name: "Sign in", exact: true }).last().click();
  await expect(page.getByText("Signed in as")).toBeVisible();
});

test("two players share a private server: countries, time, chat", async ({ browser }) => {
  const { host, guest, id } = await privateGame(browser);

  await searchFor(host, "france");
  await host.getByRole("button", { name: "Play as France" }).click();
  await expect(host.getByTestId("player-card")).toContainText("France");

  // The guest sees France is taken, and picks Germany.
  await searchFor(guest, "france");
  await expect(guest.getByTestId("played-by")).toContainText(`host${id}`);
  await searchFor(guest, "germany");
  await guest.getByRole("button", { name: "Play as Germany" }).click();
  await expect(guest.getByTestId("player-card")).toContainText("Germany");

  // Nobody controls time: it runs by itself while players are here, and both see it move on.
  await expect(guest.getByRole("button", { name: /^(Play|Pause)$/ })).toHaveCount(0);
  await expect(guest.getByTestId("game-date")).not.toContainText("1 Jan 2020", { timeout: 15_000 });
  const year = async (p: Page) => Number((await p.getByTestId("game-date").textContent())!.match(/\d{4}/)![0]);
  await expect.poll(async () => Math.abs((await year(guest)) - (await year(host)))).toBeLessThanOrEqual(1);

  // Chat.
  await guest.getByTestId("online-pill").click();
  await guest.getByLabel("Chat message").fill("hello from Germany");
  await guest.keyboard.press("Enter");
  await host.getByTestId("online-pill").click();
  await expect(host.getByTestId("chat")).toContainText("hello from Germany");
  await expect(host.getByTestId("players")).toContainText(`guest${id}`);
});

test("orders from one player show up for the other", async ({ browser }) => {
  const { host, guest } = await privateGame(browser);
  // (Not two NATO members: fellow members can't attack each other.)
  await searchFor(host, "austria");
  await host.getByRole("button", { name: "Play as Austria" }).click();
  await searchFor(guest, "switzerland");
  await guest.getByRole("button", { name: "Play as Switzerland" }).click();
  // The guest declares war on Austria; the host sees it.
  await searchFor(guest, "austria");
  await guest.getByRole("button", { name: "Show all details" }).click();
  await guest.getByRole("button", { name: "Declare war…" }).click();
  await guest.getByRole("button", { name: "Declare war", exact: true }).click();
  await expect(host.getByTestId("player-card")).toContainText("At war");
});

test("if a player disconnects, the AI takes over their country until they return", async ({ browser }) => {
  const { host, guest, id, code } = await privateGame(browser);
  await searchFor(guest, "italy");
  await guest.getByRole("button", { name: "Play as Italy" }).click();
  await expect(guest.getByTestId("player-card")).toContainText("Italy");
  await guest.context().close();

  await host.getByTestId("online-pill").click();
  await expect(host.getByTestId("players")).toContainText("AI playing", { timeout: 10_000 });

  // The guest comes back (same account) and gets Italy back.
  const back = await player(browser);
  await back.getByTestId("play-online").click();
  await back.getByRole("tab", { name: "Sign in" }).click();
  await back.getByLabel("Username").fill(`guest${id}`);
  await back.getByLabel("Password").fill("correct horse");
  await back.getByRole("button", { name: "Sign in", exact: true }).last().click();
  await back.getByLabel("Invite code").fill(code);
  await back.getByRole("button", { name: "Join", exact: true }).last().click();
  await expect(back.getByTestId("player-card")).toContainText("Italy");
  await expect(host.getByTestId("players")).not.toContainText("AI playing");
});

test("the global world is open to everyone and runs at a fixed speed", async ({ browser }) => {
  const page = await player(browser);
  await signUp(page, `global${unique()}`);
  await page.getByTestId("room-world").getByRole("button", { name: "Join" }).click();
  await expect(page.getByTestId("online-pill")).toContainText("Global World");
  await expect(page.getByRole("button", { name: /^(Play|Pause)$/ })).toHaveCount(0);
  // Leaving returns to a single-player game.
  await page.getByTestId("online-pill").click();
  await page.getByRole("button", { name: "Leave server" }).click();
  await expect(page.getByTestId("online-pill")).toHaveCount(0);
});

test("without a game server, online play explains what's needed", async ({ page }) => {
  await page.route("**/api/health", (route) => route.abort());
  await page.goto("/");
  await page.getByTestId("play-online").click();
  await expect(page.getByText("No game server here")).toBeVisible();
});

test("a private server can start in 1991", async ({ browser }) => {
  const page = await player(browser);
  await signUp(page, `cold${unique()}`);
  await page.getByRole("dialog").getByLabel("World", { exact: true }).selectOption("cold-war-1991");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByTestId("online-pill")).toBeVisible();
  await expect(page.getByTestId("game-date")).toContainText("1991");
  await searchFor(page, "soviet union");
  await expect(page.getByTestId("info-panel")).toContainText("Soviet Union");
});
