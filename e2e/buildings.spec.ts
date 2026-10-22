import { expect, test, type Page } from "@playwright/test";

// Seed users from supabase/seed.sql (local stack only).
const PASSWORD = "password123";

async function signIn(page: Page, email: string) {
  await page.goto("/");
  await expect(page).toHaveURL(/\/auth$/);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Buildings", exact: true })).toBeVisible();
}

function csv(name: string, text: string) {
  return { name, mimeType: "text/csv", buffer: Buffer.from(text) };
}

test("the sign-in page offers no public sign-up", async ({ page }) => {
  await page.goto("/auth");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.getByText(/sign up/i)).toHaveCount(0);
});

test("protected pages redirect to sign-in", async ({ page }) => {
  await page.goto("/buildings");
  await expect(page).toHaveURL(/\/auth$/);
});

test("the Excel template downloads", async ({ page }) => {
  await signIn(page, "alice@test.local");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Download Excel template" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("buildings-template.xlsx");
});

test("a user imports buildings, and other users cannot see them", async ({ page, browser }) => {
  const name = `E2E Tower ${Date.now()}`;
  await signIn(page, "alice@test.local");

  await page
    .locator('input[type="file"]')
    .setInputFiles(csv("buildings.csv", `name,city,floors\n${name},Athens,7\n`));
  await expect(page.getByText("Imported 1 buildings.")).toBeVisible();
  await expect(page.getByRole("cell", { name, exact: true })).toBeVisible();

  const bobContext = await browser.newContext();
  const bobPage = await bobContext.newPage();
  await signIn(bobPage, "bob@test.local");
  await expect(bobPage.getByRole("cell", { name, exact: true })).toHaveCount(0);
  await expect(bobPage.getByText("No buildings yet.", { exact: false })).toBeVisible();
  await bobContext.close();
});

test("an invalid file imports nothing and lists the problems", async ({ page }) => {
  const name = `Broken Tower ${Date.now()}`;
  await signIn(page, "alice@test.local");

  await page
    .locator('input[type="file"]')
    .setInputFiles(csv("broken.csv", `name,floors\n${name},seven\n`));
  const alert = page.getByRole("alert").filter({ hasText: "Nothing was imported" });
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("Row 2: floors must be a number");
  await expect(page.getByRole("cell", { name, exact: true })).toHaveCount(0);
});

test("signing out returns to the sign-in page", async ({ page }) => {
  await signIn(page, "alice@test.local");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/auth$/);
  await page.goto("/buildings");
  await expect(page).toHaveURL(/\/auth$/);
});
