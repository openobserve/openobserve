// Diagnostics for "the click did nothing" failures.
//
// A waitForURL timeout says only that the URL never changed. When the app
// declines to navigate there are four distinct causes, and they need different
// fixes: the handler returned early, it refused and said so in a toast, it
// threw, or it did navigate and something sent us back. Telling them apart
// after the fact is impossible from a screenshot, so collect the evidence while
// the test runs and print it with the failure.

/**
 * Start collecting evidence. Call once per test, before the interaction.
 * Listeners live on the page and die with it.
 */
export function attachDiagnostics(page) {
  if (page.__diagnostics) return page.__diagnostics;

  const diagnostics = { errors: [], navigations: [] };
  page.__diagnostics = diagnostics;

  page.on("pageerror", (error) => {
    diagnostics.errors.push(`pageerror: ${error.message}`);
  });

  page.on("console", (message) => {
    if (message.type() === "error") {
      diagnostics.errors.push(`console.error: ${message.text()}`);
    }
  });

  // Same-document (SPA) navigations included — this is what proves whether a
  // push ever landed and was reverted, versus never having been issued.
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) diagnostics.navigations.push(frame.url());
  });

  return diagnostics;
}

/** A multi-line report of what the page is and how it got there. */
export async function describePage(page) {
  const diagnostics = page.__diagnostics ?? { errors: [], navigations: [] };

  const state = await page
    .evaluate(() => ({
      url: location.href,
      onAlertForm: !!document.querySelector('[data-test="add-alert-name-input"]'),
      onDashboard: !!document.querySelector('[data-test="dashboard-panel-container"]'),
      onAlertList: !!document.querySelector('[data-test="alert-list-add-alert-btn"]'),
      // A refused prefill explains itself in a toast rather than navigating —
      // its text names the exact guard that rejected the panel.
      toasts: Array.from(document.querySelectorAll('[data-test^="o-toast-"]'))
        .map((el) => el.getAttribute("data-test-message") || el.textContent?.trim())
        .filter(Boolean),
    }))
    .catch((error) => ({ url: page.url(), evaluateFailed: String(error) }));

  const lines = [
    `  url:         ${state.url}`,
    `  onAlertForm: ${state.onAlertForm}  onDashboard: ${state.onDashboard}  onAlertList: ${state.onAlertList}`,
    `  toasts:      ${state.toasts?.length ? JSON.stringify(state.toasts) : "none"}`,
    `  navigations: ${JSON.stringify(diagnostics.navigations.slice(-6))}`,
    `  errors:      ${diagnostics.errors.length ? JSON.stringify(diagnostics.errors.slice(-6)) : "none"}`,
  ];

  // Best effort: the saved panel's stream. Both entry points refuse to launch
  // an alert when it is empty (PanelContainer.alertDisabledReason disables the
  // menu item; buildPrefillFromPanel raises a blocking `noStream`), so an empty
  // value here would explain a click that does nothing from either surface.
  try {
    const url = new URL(page.url());
    const org = url.searchParams.get("org_identifier");
    const dashboard = url.searchParams.get("dashboard");
    const folder = url.searchParams.get("folder") ?? "default";

    if (org && dashboard) {
      const response = await page.request.get(
        `${url.origin}/api/${org}/dashboards/${dashboard}?folder=${folder}`
      );
      const body = await response.json();
      const panels = (body?.v5 ?? body?.v4 ?? body?.v3 ?? body)?.tabs?.flatMap(
        (tab) => tab.panels ?? []
      );
      lines.push(
        `  panelStreams: ${JSON.stringify(
          (panels ?? []).map((panel) => ({
            id: panel.id,
            stream: panel.queries?.[0]?.fields?.stream,
            customQuery: panel.queries?.[0]?.customQuery,
          }))
        )}`
      );
    }
  } catch (error) {
    lines.push(`  panelStreams: unavailable (${String(error).slice(0, 120)})`);
  }

  return lines.join("\n");
}
