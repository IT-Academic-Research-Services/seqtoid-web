import { acceptCookies } from "@e2e/utils/page";
import { expect, test } from "@playwright/test";
import { ProjectPage } from "../../page-objects/project-page";

/*
 * Projects lifecycle (SMP-1720)
 *
 * Covers the core project lifecycle -- resolve/own a project, render its view, see its
 * samples list -- and, as the P0, the IRREVERSIBLE public-visibility toggle.
 *
 * Making a project public cannot be undone (PublicProjectConfirmationModal.tsx: "This action
 * is not reversible"), so before this ticket it was the one project action with a permanent,
 * platform-visible effect and ZERO coverage. These tests assert the two things that matter:
 *   (1) the UI refuses to publish without an explicit confirmation of the irreversible action,
 *       and Cancel sends no request; and
 *   (2) confirming issues exactly PUT /projects/<id>.json { public_access: true } and flips the
 *       header to "Public project".
 *
 * DETERMINISM + SAFETY: the toggle tests intercept the PUT and fulfill it locally, so the real
 * project is never actually published. That keeps the irreversible action from mutating the
 * backend, makes the tests idempotent (the project stays private across runs), and asserts the
 * exact request the app WOULD send to publish -- all without a flaky wait or a one-way side
 * effect. Project creation via the modal and sample upload + pipeline runs are covered by
 * create-project.spec.ts and the workflow specs respectively and are out of scope here (the
 * subsampled pipeline fixtures they need are deferred in SMP-1720).
 */

const LIFECYCLE_PROJECT = "smp1720_projects_lifecycle";

test.describe("Projects lifecycle: Functional: P-0", () => {
  test.beforeEach(async () => {
    test.setTimeout(120_000);
  });

  test("SNo LIFECYCLE-1: renders an owned private project and its samples list", async ({
    page,
  }) => {
    const projectPage = new ProjectPage(page);

    // Resolve (or create) an owned, PRIVATE project. public_access = 0 keeps it private so the
    // visibility toggle below has something to toggle.
    const project = await projectPage.getOrCreateProject(LIFECYCLE_PROJECT, 0);
    const expectedName = projectPage.getProjectNameForUser(LIFECYCLE_PROJECT);

    // View the project (My Data domain so a private project is visible).
    await projectPage.navigateToSamples(project.id, "", "my_data");
    await acceptCookies(page);

    // Header renders with the project name and the correct (private) visibility.
    const header = page.getByTestId("project-header");
    await expect(header).toBeVisible();
    await expect(header.getByText(expectedName)).toBeVisible();
    expect(await projectPage.getProjectVisibilityLabel()).toEqual(
      "Private project",
    );

    // Samples list renders (an owned project always shows the Samples tab + table area, even
    // when empty). Deterministic: the count is a real, non-negative number.
    await projectPage.waitForTableLoad();
    const samplesCount = await projectPage.getSamplesTabCount();
    expect(Number.isNaN(samplesCount)).toBe(false);
    expect(samplesCount).toBeGreaterThanOrEqual(0);
  });

  test("SNo LIFECYCLE-2: publishing is guarded by an irreversible-action confirmation, and Cancel sends no request", async ({
    page,
  }) => {
    const projectPage = new ProjectPage(page);
    const project = await projectPage.getOrCreateProject(LIFECYCLE_PROJECT, 0);

    // Guard: intercept the publish PUT so this test can NEVER actually make the project public.
    // If the UI (incorrectly) published without confirmation, this records it and fails.
    let publishRequests = 0;
    await page.route(`**/projects/${project.id}.json`, async route => {
      if (route.request().method() === "PUT") {
        publishRequests += 1;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ id: project.id, public_access: 1 }),
        });
      } else {
        await route.fallback();
      }
    });

    await projectPage.navigateToSamples(project.id, "", "my_data");
    await acceptCookies(page);
    expect(await projectPage.getProjectVisibilityLabel()).toEqual(
      "Private project",
    );

    // Open Share -> Change to public: this must open a confirmation, NOT publish immediately.
    await projectPage.clickShareButton();
    await projectPage.clickChangeToPublic();

    // The confirmation names the project, calls out the irreversibility, and offers an explicit
    // confirm + a cancel.
    await expect(
      page.getByText("public", { exact: false }).first(),
    ).toBeVisible();
    const warning = await projectPage.getPublicConfirmationWarningText();
    expect(warning).toContain("not reversible");
    await expect(
      page.getByRole("button", { name: "Make Project Public" }),
    ).toBeVisible();

    // Cancel backs out with no request sent and the project still private.
    await projectPage.cancelMakeProjectPublic();
    expect(publishRequests).toEqual(0);
    expect(await projectPage.getProjectVisibilityLabel()).toEqual(
      "Private project",
    );
  });

  test("SNo LIFECYCLE-3: confirming publishes via PUT public_access=true and flips the header to public", async ({
    page,
  }) => {
    const projectPage = new ProjectPage(page);
    const project = await projectPage.getOrCreateProject(LIFECYCLE_PROJECT, 0);

    // Intercept + capture the publish PUT (still never hits the backend, so the project stays
    // private for the next run). Assert the exact irreversible request the app sends.
    let publishBody: Record<string, unknown> | null = null;
    await page.route(`**/projects/${project.id}.json`, async route => {
      if (route.request().method() === "PUT") {
        publishBody = route.request().postDataJSON();
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ id: project.id, public_access: 1 }),
        });
      } else {
        await route.fallback();
      }
    });

    await projectPage.navigateToSamples(project.id, "", "my_data");
    await acceptCookies(page);

    await projectPage.clickShareButton();
    await projectPage.clickChangeToPublic();
    await projectPage.confirmMakeProjectPublic();

    // Exactly the publish request: public_access true, with the CSRF token the app attaches.
    await expect.poll(() => publishBody, { timeout: 15_000 }).not.toBeNull();
    expect(publishBody).toMatchObject({ public_access: true });
    expect(publishBody).toHaveProperty("authenticity_token");

    // The header reflects the new (client-side) public state.
    await expect(
      page.getByTestId("project-header").getByText("Public project"),
    ).toBeVisible();
  });
});
