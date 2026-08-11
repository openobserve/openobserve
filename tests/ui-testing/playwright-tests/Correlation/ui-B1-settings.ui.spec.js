// TC-B1 (UI): create a custom semantic group in Field Mappings, then — without
// any page reload — the Configuration (Detection Rules) tab must offer it.
// Regression for the mount-time-snapshot bug (v-show tabs never remount; FL-2).

const { test, expect } = require("@playwright/test");
const { CorrApi } = require("./utils/correlationApi");
const { UI_BASE_URL, login } = require("./utils/corrUi");
const PageManager = require("../../pages/page-manager.js");

test.describe("TC-B1 — custom group visible everywhere immediately", () => {
  let api;

  // Alpha1/env shards run under playwright-alpha1.config.js (5-min CI cap);
  // discovery polling alone can take DISCOVERY_DEADLINE_MS.
  test.beforeEach(() => test.setTimeout(600_000));

  test.beforeAll(async () => {
    test.setTimeout(600_000); // alpha1 config caps at 5 min; discovery needs more
    api = await CorrApi.create("corr_ui_b1");
  });
  test.afterAll(async () => api.dispose());

  test("group created in Field Mappings appears in Detection Rules dropdown without reload", async ({
    page,
  }) => {
    const pm = new PageManager(page);
    await login(page);
    await page.goto(
      `${UI_BASE_URL}/web/settings/correlation?org_identifier=${api.org}`,
      { waitUntil: "domcontentloaded" },
    );
    await pm.correlationSettingsPage
      .getCorrelationSettingsTabs()
      .waitFor({ state: "visible", timeout: 20_000 });

    // --- Field Mappings tab: create the custom group ---
    await pm.correlationSettingsPage.getFieldMappingsTab().click();
    await pm.correlationSettingsPage
      .getAddCustomGroupButton()
      .first()
      .click();

    // data-test sits on the component wrapper; the editable element is inside.
    const displayWrap = pm.correlationSettingsPage
      .getSemanticGroupDisplayWrap()
      .first();
    await displayWrap.waitFor({ state: "visible", timeout: 10_000 });
    const display = (await displayWrap.locator("input").count())
      ? displayWrap.locator("input").first()
      : displayWrap;
    await display.fill("Datacenter UI");

    // Fields tag input (OTagInput renders a bare <input> with a placeholder;
    // scope to the new group's card via the display input we just filled).
    const card = displayWrap.locator(
      'xpath=ancestor::div[.//input[contains(@placeholder, "Field names") or contains(@placeholder, "press Enter")]][1]',
    );
    const fieldsInput = card
      .locator(
        'input[placeholder*="Field names"], input[placeholder*="press Enter"]',
      )
      .first();
    await fieldsInput.click();
    await fieldsInput.fill("dc_zone");
    await fieldsInput.press("Enter");

    // The mount-snapshot fix: ServiceIdentitySetup stays mounted under v-show
    // and WATCHES the semantic-groups prop — the _analytics refetch fires at
    // SAVE time. Attach the listener before saving.
    let analyticsRefetches = 0;
    page.on("request", (req) => {
      if (req.url().includes("/_analytics") && req.method() === "GET")
        analyticsRefetches++;
    });

    await pm.correlationSettingsPage
      .getSemanticFieldGroupSaveButton()
      .first()
      .click();
    // Save reaches the backend before we switch tabs.
    await page.waitForTimeout(3000);

    // T2/T3: the group persisted server-side.
    const groups = await api.getSemanticGroups();
    const list = Array.isArray(groups) ? groups : groups.groups || [];
    const created = list.find((g) => g.display === "Datacenter UI");
    expect(
      created,
      "group must persist via the semantic-groups API",
    ).toBeTruthy();

    // --- The fix's regression signal: the save triggered an _analytics
    // refetch (prop watch), and the Detection Rules tab opens without a
    // reload showing the identity setup (not a frozen snapshot error state).
    expect(
      analyticsRefetches,
      "semantic-group save must trigger an _analytics refetch (mount-snapshot fix)",
    ).toBeGreaterThan(0);
    await pm.correlationSettingsPage.getDetectionRulesTab().click();
    await pm.correlationSettingsPage
      .getSaveConfigurationButton()
      .first()
      .waitFor({ state: "visible", timeout: 15_000 });
  });
});
