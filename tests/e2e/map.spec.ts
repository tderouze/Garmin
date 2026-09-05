// @ts-nocheck
import { test, expect } from "@playwright/test";

test("map page loads and shows selection", async ({ page }) => {
  await page.goto("/map");
  await expect(page.getByRole("heading", { name: /Carte & superposition/i })).toBeVisible();
  // selection counter visible
  await expect(page.getByTestId("selection-count")).toBeVisible();
});

test("map overlay with mocked activities", async ({ page }) => {
  // Mock /api/activities?type=running
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

  // Mock detail for each activity — minimal trackPoints
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

  // Wait for the mocked list to render checkboxes
  const checkboxes = page.getByRole("checkbox");
  await expect(checkboxes.first()).toBeVisible({ timeout: 10000 });

  // Check two traces
  await checkboxes.nth(0).check();
  await checkboxes.nth(1).check();

  // Map container should appear (canvas inside maplibre, or at least container)
  await expect(page.getByTestId("map-container")).toBeVisible({ timeout: 10000 });

  // Opacity slider should be present
  await expect(page.getByLabel(/Opacité des traces/i)).toBeVisible();
});
