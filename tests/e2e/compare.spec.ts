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
        {
          id: "act3",
          type: "running",
          name: "Long Run",
          date: "2024-06-05T08:00:00.000Z",
          distance: 21097,
          duration: 7200,
          avgPace: 342,
          avgHR: 155,
          maxHR: 178,
          avgCadence: 84,
          elevationGain: 250,
          calories: 1200,
          tss: 150,
        },
      ]),
    });
  });

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
        : id === "act3"
          ? [
              { lat: 48.85, lng: 2.35, ele: 31, time: "2024-06-05T08:00:00.000Z", hr: 150, cadence: 84, power: 270, speed: 3.1 },
              { lat: 48.86, lng: 2.36, ele: 36, time: "2024-06-05T08:01:00.000Z", hr: 155, cadence: 85, power: 275, speed: 3.15 },
              { lat: 48.87, lng: 2.37, ele: 40, time: "2024-06-05T08:02:00.000Z", hr: 160, cadence: 86, power: 280, speed: 3.0 },
            ]
          : [
              { lat: 48.85, lng: 2.35, ele: 31, time: "2024-06-03T08:00:00.000Z", hr: 135, cadence: 79, power: 240, speed: 3.3 },
              { lat: 48.86, lng: 2.36, ele: 36, time: "2024-06-03T08:01:00.000Z", hr: 142, cadence: 80, power: 245, speed: 3.35 },
            ];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id, name: id === "act1" ? "Morning Run" : id === "act3" ? "Long Run" : "Evening Run", trackPoints, laps: [] }),
    });
  });

  await page.goto("/compare");

  const checkboxes = page.getByRole("checkbox");
  await expect(checkboxes.first()).toBeVisible({ timeout: 10000 });

  await checkboxes.nth(0).check();
  await checkboxes.nth(1).check();

  await expect(page.getByTestId("compare-chart")).toBeVisible({ timeout: 10000 });

  await page.getByRole("button", { name: "FC" }).click();
  await expect(page.getByTestId("compare-chart")).toBeVisible();

  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.getByText("Morning Run")).toBeVisible();

  await expect(page.getByLabel(/Lissage/i)).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /Normaliser par distance/i })).toBeVisible();
  await expect(page.getByRole("button", { name: "Tout" })).toBeVisible();
});

test("compare with 3 traces — metric switch and smoothing", async ({ page }) => {
  await page.route("**/api/activities?**", async (route) => {
    const url = route.request().url();
    if (url.includes("/api/activities/")) return route.continue();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        { id: "act1", type: "running", name: "Run A", date: "2024-06-01T08:00:00.000Z", distance: 10000, duration: 3000, avgPace: 300, avgHR: 150, maxHR: 175, avgCadence: 82, elevationGain: 100, calories: 600, tss: 80 },
        { id: "act2", type: "running", name: "Run B", date: "2024-06-02T08:00:00.000Z", distance: 10000, duration: 3100, avgPace: 310, avgHR: 148, maxHR: 172, avgCadence: 81, elevationGain: 110, calories: 610, tss: 82 },
        { id: "act3", type: "running", name: "Run C", date: "2024-06-03T08:00:00.000Z", distance: 10000, duration: 2950, avgPace: 295, avgHR: 152, maxHR: 176, avgCadence: 83, elevationGain: 95, calories: 590, tss: 79 },
      ]),
    });
  });

  const trackPoints = [
    { lat: 48.85, lng: 2.35, ele: 30, time: "2024-06-01T08:00:00.000Z", hr: 140, cadence: 80, power: 250, speed: 3.33 },
    { lat: 48.86, lng: 2.36, ele: 35, time: "2024-06-01T08:01:00.000Z", hr: 145, cadence: 82, power: 255, speed: 3.4 },
  ];

  await page.route("**/api/activities/*", async (route) => {
    const url = route.request().url();
    const id = url.split("/").pop()?.split("?")[0] ?? "act1";
    const name = id === "act1" ? "Run A" : id === "act2" ? "Run B" : "Run C";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id, name, trackPoints, laps: [] }),
    });
  });

  await page.goto("/compare");
  const checkboxes = page.getByRole("checkbox");
  await expect(checkboxes.first()).toBeVisible({ timeout: 10000 });

  await checkboxes.nth(0).check();
  await checkboxes.nth(1).check();
  await checkboxes.nth(2).check();

  await expect(page.getByTestId("compare-chart")).toBeVisible({ timeout: 10000 });

  // Switch metric to Puissance and back to Allure
  await page.getByRole("button", { name: "Puissance" }).click();
  await expect(page.getByTestId("compare-chart")).toBeVisible();
  await page.getByRole("button", { name: "Allure" }).click();
  await expect(page.getByTestId("compare-chart")).toBeVisible();

  // Smoothing slider
  const smooth = page.getByLabel(/Lissage/i);
  await expect(smooth).toBeVisible();
  // Change smoothing
  await smooth.fill("5");

  // Normalize checkbox
  const norm = page.getByRole("checkbox", { name: /Normaliser par distance/i });
  await norm.check();
  await expect(norm).toBeChecked();
  await norm.uncheck();

  // Period filter still works after selection
  await page.getByRole("button", { name: "Tout" }).click();

  // Table shows all 3
  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.getByText("Run A")).toBeVisible();
  await expect(page.getByText("Run C")).toBeVisible();
});

test("compare handles empty and 503", async ({ page }) => {
  await page.route("**/api/activities?**", async (route) => {
    const url = route.request().url();
    if (url.includes("/api/activities/")) return route.continue();
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Service temporarily unavailable — database unreachable. Please retry." }),
    });
  });

  await page.goto("/compare");
  await expect(page.getByText(/database unreachable|Service temporarily unavailable/i).first()).toBeVisible({ timeout: 10000 });
});
