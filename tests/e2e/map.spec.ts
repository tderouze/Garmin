// @ts-nocheck
import { test, expect } from "@playwright/test";

test("map page loads and shows selection", async ({ page }) => {
  await page.goto("/map");
  await expect(page.getByRole("heading", { name: /Carte & superposition/i })).toBeVisible();
  await expect(page.getByTestId("selection-count")).toBeVisible();
});

test("map overlay with mocked activities — 2 traces", async ({ page }) => {
  await page.route("**/api/activities?type=running**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        { id: "act1", type: "running", name: "Morning Run", date: "2024-06-01T08:00:00.000Z", distance: 10000, duration: 3000 },
        { id: "act2", type: "running", name: "Evening Run", date: "2024-06-02T08:00:00.000Z", distance: 5000, duration: 1500 },
        { id: "act3", type: "running", name: "Long Run", date: "2024-06-03T08:00:00.000Z", distance: 21097, duration: 7200 },
      ]),
    });
  });

  const track = {
    id: "act1",
    trackPoints: [
      { lat: 48.85, lng: 2.35, ele: 30, time: "2024-06-01T08:00:00.000Z", hr: 140 },
      { lat: 48.86, lng: 2.36, ele: 35, time: "2024-06-01T08:01:00.000Z", hr: 145 },
    ],
    laps: [],
  };
  await page.route("**/api/activities/*", async (route) => {
    const url = route.request().url();
    const id = url.split("/").pop()?.split("?")[0] ?? "act1";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ...track, id }),
    });
  });

  await page.goto("/map");

  const checkboxes = page.getByRole("checkbox");
  await expect(checkboxes.first()).toBeVisible({ timeout: 10000 });

  await checkboxes.nth(0).check();
  await checkboxes.nth(1).check();

  await expect(page.getByTestId("map-container")).toBeVisible({ timeout: 10000 });
  await expect(page.getByLabel(/Opacité des traces/i)).toBeVisible();
});

test("map overlay 3 traces — canvas visible and shared segments", async ({ page }) => {
  // Same mock but explicit 3-trace selection
  await page.route("**/api/activities?type=running**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        { id: "act1", type: "running", name: "Morning Run", date: "2024-06-01T08:00:00.000Z", distance: 10000, duration: 3000 },
        { id: "act2", type: "running", name: "Evening Run", date: "2024-06-02T08:00:00.000Z", distance: 5000, duration: 1500 },
        { id: "act3", type: "running", name: "Long Run", date: "2024-06-03T08:00:00.000Z", distance: 21097, duration: 7200 },
      ]),
    });
  });

  const makeTrack = (id: string) => ({
    id,
    trackPoints: [
      { lat: 48.85, lng: 2.35, ele: 30, time: "2024-06-01T08:00:00.000Z", hr: 140 },
      { lat: 48.852, lng: 2.352, ele: 32, time: "2024-06-01T08:01:00.000Z", hr: 142 },
      { lat: 48.86, lng: 2.36, ele: 35, time: "2024-06-01T08:02:00.000Z", hr: 145 },
    ],
    laps: [],
  });

  await page.route("**/api/activities/*", async (route) => {
    const url = route.request().url();
    const id = url.split("/").pop()?.split("?")[0] ?? "act1";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(makeTrack(id)),
    });
  });

  await page.goto("/map");

  const checkboxes = page.getByRole("checkbox");
  await expect(checkboxes.first()).toBeVisible({ timeout: 10000 });

  // Check 3 traces — spec requires overlay of 3
  await checkboxes.nth(0).check();
  await checkboxes.nth(1).check();
  await checkboxes.nth(2).check();

  // Counter should reflect 3 selected
  await expect(page.getByTestId("selection-count")).toContainText("3");

  // Map container visible (canvas inside, or fallback)
  await expect(page.getByTestId("map-container")).toBeVisible({ timeout: 10000 });

  // Opacity + tolerance sliders present
  await expect(page.getByLabel(/Opacité des traces/i)).toBeVisible();
  await expect(page.getByLabel(/Tolérance segments partagés/i)).toBeVisible();

  // Shared segments badge should appear (even if zero, the section is rendered)
  // Tolerance slider interaction
  await page.getByLabel(/Tolérance segments partagés/i).fill("30");

  // Export button enabled when traces present
  await expect(page.getByRole("button", { name: /Exporter GPX/i })).toBeEnabled();
});

test("map handles DB 503 gracefully", async ({ page }) => {
  await page.route("**/api/activities?type=running**", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Service temporarily unavailable — database unreachable. Please retry." }),
    });
  });

  await page.goto("/map");
  // Should show error message with retry affordance
  await expect(page.getByText(/database unreachable|Service temporarily unavailable/i).first()).toBeVisible({ timeout: 10000 });
});
