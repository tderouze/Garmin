import { test, expect } from "@playwright/test";

test("races page loads with heading and PB section", async ({ page }) => {
  await page.goto("/races");
  await expect(page.getByRole("heading", { name: /Courses & records personnels/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Records personnels/i })).toBeVisible();
  await expect(page.getByText(/Détection automatique/i).first()).toBeVisible();
});

test("races PBs display with mocked personal-records", async ({ page }) => {
  await page.route("**/api/personal-records", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          distance: "5K",
          canonical: 5000,
          label: "5 km",
          bestTime: 875,
          activityId: "race-5k-1",
          date: "2024-06-01T08:00:00.000Z",
          activity: { id: "race-5k-1", name: "5K PB Run", distance: 5000, duration: 875, date: "2024-06-01T08:00:00.000Z" },
        },
        {
          distance: "10K",
          canonical: 10000,
          label: "10 km",
          bestTime: 1920,
          activityId: "race-10k-1",
          date: "2024-06-05T08:00:00.000Z",
          activity: { id: "race-10k-1", name: "10K PB Run", distance: 10000, duration: 1920, date: "2024-06-05T08:00:00.000Z" },
        },
      ]),
    });
  });

  await page.route("**/api/activities?**", async (route) => {
    const url = route.request().url();
    if (url.includes("/api/activities/")) return route.continue();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        { id: "race-5k-1", type: "race", name: "5K PB Run", date: "2024-06-01T08:00:00.000Z", distance: 5000, duration: 875, avgPace: 175, avgHR: 165 },
        { id: "race-10k-1", type: "race", name: "10K PB Run", date: "2024-06-05T08:00:00.000Z", distance: 10000, duration: 1920, avgPace: 192, avgHR: 160 },
        { id: "race-semi-1", type: "race", name: "Semi Run", date: "2024-06-10T08:00:00.000Z", distance: 21097, duration: 5400, avgPace: 256, avgHR: 158 },
      ]),
    });
  });

  await page.goto("/races");

  await expect(page.getByRole("heading", { name: /Courses & records personnels/i })).toBeVisible();

  // PB cards: distance badges visible
  await expect(page.getByText("5K").first()).toBeVisible({ timeout: 10000 });
  await expect(page.getByText("10K").first()).toBeVisible();

  // Durations: 875s = 14:35, 1920s = 32:00
  await expect(page.getByText("14:35").first()).toBeVisible();
  await expect(page.getByText("32:00").first()).toBeVisible();

  // Activity names in PB cards
  await expect(page.getByText("5K PB Run").first()).toBeVisible();
  await expect(page.getByText("10K PB Run").first()).toBeVisible();

  // PB count badge
  await expect(page.getByText(/2 distance\(s\) avec PB/i)).toBeVisible();

  // Race list shows detected courses
  await expect(page.getByText(/3 course\(s\) détectée/i)).toBeVisible();
});
