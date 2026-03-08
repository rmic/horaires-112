import { expect, test, type Page } from "@playwright/test";

function formatMonth(month: number) {
  return String(month).padStart(2, "0");
}

async function dragAvailabilityRange(page: Page, startCellTestId: string, endCellTestId: string) {
  const startCell = page.getByTestId(startCellTestId);
  const endCell = page.getByTestId(endCellTestId);

  await startCell.hover();
  await page.mouse.down();
  await endCell.hover();
  await page.mouse.up();
}

test("manager can create schedule, visualize gaps, publish, and open read-only view", async ({ page, context }) => {
  const seed = Date.now();
  const month = (seed % 12) + 1;
  const year = 2030 + (Math.floor(seed / 12) % 60);
  const monthLabel = formatMonth(month);
  const monthRowId = `month-row-${year}-${monthLabel}`;
  const aliceName = `Alice E2E ${year}-${monthLabel}`;
  const bobName = `Bob E2E ${year}-${monthLabel}`;
  const chloeName = `Chloe E2E ${year}-${monthLabel}`;

  await page.goto("/manager");
  await expect(page.getByText("Horaire 112 - Manager")).toBeVisible();

  for (const [name, color] of [
    [aliceName, "#0ea5e9"],
    [bobName, "#22c55e"],
    [chloeName, "#f97316"],
  ] as const) {
    await page.getByTestId("new-volunteer-name").fill(name);
    await page.getByTestId("new-volunteer-color").fill(color);
    await page.getByTestId("create-volunteer").click();
    await expect(page.locator(`tbody input[value="${name}"]`).first()).toBeVisible();
  }

  if ((await page.getByTestId(monthRowId).count()) > 0) {
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByTestId(monthRowId).first().click();
    await page.getByTestId("delete-month").click();
    await expect(page.getByText("Mois supprimé.")).toBeVisible();
    await expect(page.getByTestId(monthRowId)).toHaveCount(0);
  }

  await page.getByTestId("create-month-year").fill(String(year));
  await page.getByTestId("create-month-month").selectOption(String(month));
  await page.getByTestId("create-month").click();

  await expect(page.getByTestId(monthRowId)).toBeVisible();
  await page.getByTestId(monthRowId).first().click();
  await expect(page.getByText(`Actif: ${monthLabel}/${year}`)).toBeVisible();

  const dayStart = `${year}-${monthLabel}-01T06:00`;
  const dayEnd = `${year}-${monthLabel}-01T18:00`;
  const day2Start = `${year}-${monthLabel}-02T06:00`;
  const day2End = `${year}-${monthLabel}-02T18:00`;
  const day1RangeLabel = `01/${monthLabel} 06:00 - 01/${monthLabel} 18:00`;
  const day2RangeLabel = `02/${monthLabel} 06:00 - 02/${monthLabel} 18:00`;

  await page.getByTestId("availability-volunteer-select").selectOption({ label: aliceName });
  await page.getByTestId("availability-month-max").fill("10");
  await page.getByTestId("save-availability-month-max").click();
  await expect(page.getByText("Plafond mensuel mis à jour.")).toBeVisible();

  await dragAvailabilityRange(page, "availability-cell-0-6", "availability-cell-0-17");
  await expect(page.getByText(day1RangeLabel)).toBeVisible();

  await page.getByTestId("availability-volunteer-select").selectOption({ label: bobName });
  await dragAvailabilityRange(page, "availability-cell-0-6", "availability-cell-0-17");
  await expect(page.getByText(day1RangeLabel)).toBeVisible();

  await dragAvailabilityRange(page, "availability-cell-1-6", "availability-cell-1-17");
  await expect(page.getByText(day2RangeLabel)).toBeVisible();

  await page.getByTestId("availability-volunteer-select").selectOption({ label: chloeName });
  await dragAvailabilityRange(page, "availability-cell-1-6", "availability-cell-1-17");
  await expect(page.getByText(day2RangeLabel)).toBeVisible();

  await page.getByTestId("new-assignment-volunteer").selectOption({ label: aliceName });
  await page.getByTestId("new-assignment-volunteer-2").selectOption({ label: bobName });
  await page.getByTestId("new-assignment-start").fill(dayStart);
  await page.getByTestId("new-assignment-end").fill(dayEnd);
  await page.getByTestId("new-assignment-status").selectOption("CONFIRMED");
  await page.getByTestId("add-assignment").click();
  await expect(page.getByText("Binôme ajouté.")).toBeVisible();

  await page.getByTestId("new-assignment-volunteer").selectOption({ label: chloeName });
  await page.getByTestId("new-assignment-volunteer-2").selectOption("");
  await page.getByTestId("new-assignment-start").fill(day2Start);
  await page.getByTestId("new-assignment-end").fill(day2End);
  await page.getByTestId("add-assignment").click();
  await expect(page.getByText("Garde ajoutée.")).toBeVisible();

  const chloeTimelineBlock = page.getByRole("button", {
    name: new RegExp(`${chloeName} 06:00 - 18:00`),
  });
  await expect(chloeTimelineBlock.first()).toBeVisible();
  await chloeTimelineBlock.first().click();
  await expect(page.getByText(`Édition directe: 02/${monthLabel} 06:00 - 02/${monthLabel} 18:00`)).toBeVisible();
  await page.getByTestId("new-assignment-volunteer-2").selectOption({ label: bobName });
  await page.getByTestId("add-assignment").click();
  await expect(page.getByText("Plage mise à jour.")).toBeVisible();

  await expect(page.locator('[data-testid="timeline-block"][data-variant="gap"]').first()).toBeVisible();

  await page.getByTestId("publish-month").click();
  await expect(page.getByText("Planning publié.")).toBeVisible();

  const publicLink = page.locator('a[href*="/p/"]').first();
  const href = await publicLink.getAttribute("href");
  expect(href).toBeTruthy();

  const readonlyPage = await context.newPage();
  await readonlyPage.goto(href!);

  await expect(readonlyPage.getByText("Planning publié")).toBeVisible();
  await expect(readonlyPage.getByText("Liste des créneaux à couvrir")).toBeVisible();
  await expect(readonlyPage.getByText(/personne manquante/).first()).toBeVisible();
});
