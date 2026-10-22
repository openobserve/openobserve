// Copyright 2026 OpenObserve Inc.
// The accessibility matrix helpers: axe with the shared-component allow-list, live-region recording and captures.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

import { OUT } from "./setup.mjs";

const require = createRequire(import.meta.url);
const AXE_SOURCE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

export const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** What the matrix scans: the assistant roots, the header button and any open overlay. */
export const AXE_SCOPE = [
  "[data-assistant-root]",
  '[data-test="menu-link-ai-item"]',
  '[data-test^="settings-assistant-panel-"]',
  '[role="dialog"]',
  '[role="menu"]',
  '[role="listbox"]',
  '[role="tooltip"]',
];

/** Serious and critical results owned by shared components outside the assistant; each entry is matched by rule and by the node's closest ancestor. */
export const AXE_ALLOW = [
  {
    rule: "color-contrast",
    selector: ".text-text-link",
    reason: "the shared text-text-link token is 3.94:1 on white app-wide; a token change restyles every flag-off link",
  },
  {
    rule: "color-contrast",
    selector: '[role="menu"] [data-test="o-shortcut"]',
    reason: "ODropdownItem's shortcut cap uses the shared kbd pair (text-secondary on surface-subtle, 4.34:1) in every menu; darkening it restyles every flag-off menu",
  },
];

/** The assistant's own surfaces: their results are fixed at the owner and never allow-listed. */
export const AXE_OWNED = '[data-assistant-root], [data-test="menu-link-ai-item"], [data-test^="settings-assistant-panel-"]';

/** Runs axe over the scope, writes `out/axe/<flow>.json` and returns the serious/critical nodes the allow-list does not cover. */
export async function axeScan(page, flow, { scope = AXE_SCOPE } = {}) {
  if (!(await page.evaluate(() => !!window.axe))) await page.addScriptTag({ content: AXE_SOURCE });
  const result = await page.evaluate(
    async ({ scope, tags, allow, owned }) => {
      const include = scope.filter((s) => document.querySelector(s)).map((s) => [s]);
      if (include.length === 0) return { scanned: [], blocking: [], allowed: [] };
      const report = await window.axe.run({ include }, { runOnly: { type: "tag", values: tags }, resultTypes: ["violations"] });
      const blocking = [];
      const allowed = [];
      for (const v of report.violations) {
        if (v.impact !== "serious" && v.impact !== "critical") continue;
        for (const node of v.nodes) {
          const selector = node.target.flat().join(" ");
          const el = typeof node.target[0] === "string" ? document.querySelector(node.target[0]) : null;
          const entry = !el?.closest(owned) && allow.find((a) => a.rule === v.id && el?.closest(a.selector));
          const related = [...node.any, ...node.all, ...node.none].flatMap((c) => c.relatedNodes ?? []).map((r) => r.target.flat().join(" ")).slice(0, 5);
          const row = { rule: v.id, impact: v.impact, selector, html: node.html.slice(0, 200), summary: node.failureSummary?.split("\n")[1]?.trim() ?? "", related };
          (entry ? allowed : blocking).push(entry ? { ...row, reason: entry.reason } : row);
        }
      }
      return { scanned: include.flat(), blocking, allowed };
    },
    { scope, tags: AXE_TAGS, allow: AXE_ALLOW, owned: AXE_OWNED },
  );
  mkdirSync(join(OUT, "axe"), { recursive: true });
  writeFileSync(join(OUT, "axe", `${flow}.json`), JSON.stringify({ flow, ...result }, null, 2));
  return result;
}

export async function capture(page, name, locator) {
  mkdirSync(join(OUT, "captures"), { recursive: true });
  const path = join(OUT, "captures", `${name}.png`);
  return locator ? locator.screenshot({ path, animations: "disabled" }) : page.screenshot({ path, animations: "disabled" });
}

/** Records every sentence each live region speaks, keyed by its `data-test`, into `window.__o2announcements`. */
export async function recordAnnouncements(context) {
  await context.addInitScript(() => {
    const log = (window.__o2announcements = []);
    const last = new Map();
    const LIVE = '[role="status"], [role="alert"], [aria-live="polite"], [aria-live="assertive"]';
    const note = (node) => {
      const el = node?.nodeType === 1 ? node : node?.parentElement;
      const region = el?.closest?.(LIVE);
      if (!region || region.getAttribute("aria-live") === "off") return;
      const key = region.getAttribute("data-test") || region.getAttribute("role") || "live";
      const text = region.textContent.replace(/\s+/g, " ").trim();
      // Clearing a region ends an utterance, so the same sentence spoken again afterwards is logged as a repeat.
      if (!text) return void last.delete(region);
      if (last.get(region) === text) return;
      last.set(region, text);
      log.push({ region: key, text });
    };
    // Init scripts run before <html> exists, so the observer watches the document node itself.
    new MutationObserver((records) => records.forEach((r) => note(r.target))).observe(document, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  });
}

export async function announcements(page, from = 0) {
  return page.evaluate((i) => (window.__o2announcements ?? []).slice(i), from);
}
