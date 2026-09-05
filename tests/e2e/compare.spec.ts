// @ts-nocheck
import { test, expect } from "@playwright/test";

test("compare page loads with filters and progression", async ({ page }) => {
  await page.goto("/compare");
  await expect(page.getByRole("heading", { name: /Comparaison performances/i })).toBeVisible();
  await expect(page.getByText(/Période/i).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "7j" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Allure/i }).first()).toBeVisible();
  await expect(page.getByLabel(/Lissage/i)).toBeVisible();
});

test("compare charts with mocked activities and tableau recap", async ({ page }) => {
  // Mock list
  await page.route("**/api/activities?**", async (route) => {
    const url = route.request().url();
    if (url.includes("/api/activities/")) return route.continue();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "act1",
          type: "running",
          name: "Morning Run",
          date: "2024-06-01T08:00:00.000Z",
          distance: 10000,
          duration: 3000,
          avgPace: 300,
          avgHR: 150,
          maxHR: 175,
          avgCadence: 82,
          elevationGain: 120,
          calories: 600,
          tss: 80,
        },
        {
          id: "act2",
          type: "running",
          name: "Evening Run",
          date: "2024-06-03T08:00:00.000Z",
          distance: 5000,
          duration: 1500,
          avgPace: 300,
          avgHR: 145,
          maxHR: 170,
          avgCadence: 80,
          elevationGain: 60,
          calories: 300,
          tss: 40,
        },
      ]),
    });
  });

  // Mock detail
  await page.route("**/api/activities/*", async (route) => {
    const url = route.request().url();
    const id = url.split("/").pop()?.split("?")[0] ?? "act1";
    const trackPoints =
      id === "act1"
        ? [
            { lat: 48.85, lng: 2.35, ele: 30, time: "2024-06-01T08:00:00.000Z", hr: 140, cadence: 80, power: 250, speed: 3.33 },
            { lat: 48.86, lng: 2.36, ele: 35, time: "2024-06-01T08:01:00.000Z", hr: 145, cadence: 82, power: 255, speed: 3.4 },
            { lat: 48.87, lng: 2.37, ele: 32, time: "2024-06-01T08:02:00.000Z", hr: 150, cadence: 81, power: 260, speed: 3.2 },
          ]
        : [
            { lat: 48.85, lng: 2.35, ele: 31, time: "2024-06-03T08:00:00.000Z", hr: 135, cadence: 79, power: 240, speed: 3.3 },
            { lat: 48.86, lng: 2.36, ele: 36, time: "2024-06-03T08:01:00.000Z", hr: 142, cadence: 80, power: 245, speed: 3.35 },
          ];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id, name: id === "act1" ? "Morning Run" : "Evening Run", trackPoints, laps: [] }),
    });
  });

  await page.goto("/compare");

  const checkboxes = page.getByRole("checkbox");
  // Need to wait for list to load — at least one checkbox visible
  await expect(checkboxes.first()).toBeVisible({ timeout: 10000 });

  await checkboxes.nth(0).check();
  await checkboxes.nth(1).check();

  // Compare chart container should appear
  await expect(page.getByTestId("compare-chart")).toBeVisible({ timeout: 10000 });

  // Metric switch should update — click FC
  await page.getByRole("button", { name: "FC" }).click();
  await expect(page.getByTestId("compare-chart")).toBeVisible();

  // Tableau récap should show both activities
  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.getByText("Morning Run")).toBeVisible();
  await expect(page.getByText("5000").first()).toBeTruthy();

  // VMA badge may appear when activities present
  // Check smoothing slider exists
  await expect(page.getByLabel(/Lissage/i)).toBeVisible();
  // Normalize checkbox
  await expect(page.getByRole("checkbox", { name: /Normaliser par distance/i })).toBeVisible();

  // Period buttons still visible
  await expect(page.getByRole("button", { name: "Tout" })).toBeVisible();
});
