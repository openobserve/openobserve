// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

// localStorage key for the LLM UI toggle. Must be declared *above* the
// `config` object — `readLLMUIFlag()` is called during config
// initialization, and a `const` declared below would be in the TDZ at
// that moment. The try/catch inside the helper would then silently
// swallow the ReferenceError and always return "false", which is why
// the feature wouldn't enable even after `enableLLMUI()`.
const LLM_UI_LS_KEY = "openobserve.llm_ui_visible";

function readLLMUIFlag(): "true" | "false" {
  if (typeof window === "undefined") return "false";
  try {
    return window.localStorage.getItem(LLM_UI_LS_KEY) === "true"
      ? "true"
      : "false";
  } catch {
    // Private mode / disabled storage — fall back to hidden.
    return "false";
  }
}

const config = {
  aws_mobile_analytics_app_id: "ab7e9321f83c45a8967ff3b9bd90e83a",
  aws_mobile_analytics_app_region: "us-west-2",
  openReplayKey: import.meta.env.VITE_OPENREPLAY_KEY,
  sentryDSN: import.meta.env.VITE_SENTRY_DSN,
  zincQuotaThreshold: import.meta.env.VITE_ZINC_QUOTA_THRESHOLD,
  enableAnalytics: import.meta.env.VITE_ZINC_ANALYTICS_ENABLED,
  isCloud: import.meta.env.VITE_OPENOBSERVE_CLOUD
    ? import.meta.env.VITE_OPENOBSERVE_CLOUD
    : "false",
  isEnterprise: import.meta.env.VITE_OPENOBSERVE_ENTERPRISE
    ? import.meta.env.VITE_OPENOBSERVE_ENTERPRISE
    : "false",
  freePlan: "free",
  paidPlan: "pay-as-you-go",
  enterprisePlan: "enterprise",
  ooApplicationID: import.meta.env.VITE_OO_APP_ID,
  ooClientToken: import.meta.env.VITE_OO_CLIENT_TOKEN,
  ooSite: import.meta.env.VITE_OO_SITE,
  ooService: import.meta.env.VITE_OO_SERVICE,
  ooOrgIdentifier: import.meta.env.VITE_OO_ORG_IDENTIFIER,
  environment: import.meta.env.VITE_ENVIRONMENT,
  ddAPPID: import.meta.env.VITE_DD_APP_ID,
  ddClientToken: import.meta.env.VITE_DD_CLIENT_TOKEN,
  ddSite: import.meta.env.VITE_DD_SITE,
  REO_CLIENT_KEY: import.meta.env.VITE_REODOTDEV_CLIENT_KEY || "",
  // Master switch for the LLM Observability UI (LLM Insights + Sessions
  // tabs on the traces page, Thread tab inside trace details).
  //
  // Hidden by default. Users enable it at runtime from the browser
  // console: `enableLLMUI()` → reloads with feature on. `disableLLMUI()`
  // turns it back off. The choice is persisted in localStorage so it
  // survives reloads and tab switches without rebuilds.
  //
  // Consumers continue to use the existing string check
  // `config.showLLMUI !== 'false'`, so a "true" value flips the feature
  // on. Anything else (including unset) keeps it hidden.
  showLLMUI: readLLMUIFlag(),
};

// Install the console helpers exactly once. Keeping them on `window`
// (not behind any namespace) so they're trivially discoverable: a user
// in DevTools can just type `enableLLMUI()` to see the feature.
if (typeof window !== "undefined" && !(window as any).__o2LLMUIInstalled) {
  (window as any).__o2LLMUIInstalled = true;
  (window as any).enableLLMUI = () => {
    try {
      window.localStorage.setItem(LLM_UI_LS_KEY, "true");
    } catch {
      // No-op if storage write fails; user will see the same message.
    }
    // eslint-disable-next-line no-console
    console.info(
      "[openobserve] LLM Observability UI enabled — reloading the page.",
    );
    window.location.reload();
  };
  (window as any).disableLLMUI = () => {
    try {
      window.localStorage.setItem(LLM_UI_LS_KEY, "false");
    } catch {
      // No-op
    }
    // eslint-disable-next-line no-console
    console.info(
      "[openobserve] LLM Observability UI disabled — reloading the page.",
    );
    window.location.reload();
  };
}

export default config;
