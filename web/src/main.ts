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

import { configQuery } from "@/services/config.queries";
import { createApp } from "vue";
import { VueQueryPlugin } from "@tanstack/vue-query";
import store from "./stores";
import App from "./App.vue";
import createRouter from "./router";
import i18n, { applyDocumentLocale, getLocale, loadLocaleMessages } from "./locales";
import "./styles/tailwind.css";
import "./styles/rtl.css";
// Global generated-content stylesheet: syntax classes (.log-key, .log-string, …)
// applied to v-html-highlighted log output across logs/traces/RUM. Loaded once
// here instead of re-@imported inside each consumer's <style> block.
import "./assets/styles/log-highlighting.css";
import config from "./aws-exports";

import { useReo } from "./services/reodotdev_analytics";
import { contextRegistry, createDefaultContextProvider } from "./composables/contextProviders";
import { buildVersionChecker, isChunkLoadError } from "./utils/buildVersionChecker";
import { queryClient, setMutationNotifier } from "./composables/query/queryClient";
import { toast } from "@/lib/feedback/Toast/useToast";
import { bootstrapTheme } from "@/utils/themeManager";
import { raw } from "@/types/i18n";
import { isAssistantV2 } from "@/composables/assistant/flags";

// Apply the resolved theme synchronously before the app mounts so the first
// paint already uses the correct colors (no flash of the base stylesheet theme).
bootstrapTheme();

const activeLocale = getLocale();
applyDocumentLocale(activeLocale);

// Only the assistant's sheet needs the keyboard to resize the layout; with the flag off every page keeps the default viewport.
if (isAssistantV2())
  document
    .querySelector('meta[name="viewport"]')
    ?.setAttribute(
      "content",
      "width=device-width, initial-scale=1.0, interactive-widget=resizes-content",
    );

const app = createApp(App);
const router = createRouter(store);

app.use(i18n);

// const router = createRouter(store);
app.use(store).use(router);

app.use(VueQueryPlugin, { queryClient });

// Mutation success/error feedback. Injected rather than imported by the query
// client so that module stays free of UI and i18n at runtime.
setMutationNotifier((variant, message) => toast({ variant, message }));

// Initialize default context provider globally
const defaultProvider = createDefaultContextProvider(router, store);
contextRegistry.register("default", defaultProvider);

const { reoInit } = useReo();

reoInit();

// app.use(SearchPlugin);

// Unauthenticated bootstrap payload: only what the login page needs. The full
// configuration is fetched authenticated (per org) once the user is signed in.
interface ConfigResponse {
  data?: {
    telemetry_enabled?: boolean;
    build_type?: string;
    commit_hash?: string;
  };
}

const getConfig = async () => {
  // Seeds the shared bootstrap `/config` query — Login and the version checker
  // read the same cached entry instead of each issuing their own request. The
  // authenticated full config is a separate entry (`configFullQuery`), fetched
  // per org once the user is signed in.
  await queryClient.fetchQuery(configQuery()).then((data: ConfigResponse["data"]) => {
    const res: ConfigResponse = { data };
    if (!res.data) return;

    // Never clobber the authenticated full config with the bootstrap subset if
    // the full fetch (MainLayout) happens to resolve first.
    if (!store.state.zoConfig?.version) {
      store.dispatch("setConfig", res.data);
    }
    config.enableAnalytics = res.data.telemetry_enabled?.toString() ?? "false";

    // Store initial commit hash for version checking
    if (res.data.commit_hash) {
      buildVersionChecker.setInitialVersion(res.data.commit_hash);
    }
    startAssistantOffPublicShare(res.data.commit_hash?.slice(0, 12) ?? "unknown");
  });
};

const PUBLIC_SHARE_PATH = /(?:^|\/)ai\/public\//;

let assistantStarted = false;

// A public shared page never loads the runtime; leaving it for the app starts it then.
function startAssistantOffPublicShare(uiVersion: string) {
  if (!isAssistantV2()) return;
  const start = () => {
    if (assistantStarted) return;
    assistantStarted = true;
    // A failed chunk load leaves the assistant off; the rest of the app is unaffected.
    initAssistant(uiVersion).catch((err) => console.error("Assistant runtime failed to load", err));
  };
  if (!PUBLIC_SHARE_PATH.test(window.location.pathname)) return start();
  const stop = router.afterEach((to) => {
    if (PUBLIC_SHARE_PATH.test(to.path)) return;
    stop();
    start();
  });
}

// Dynamic imports only: with the flag off nothing of the assistant runtime is loaded.
async function initAssistant(uiVersion: string) {
  const [{ assistantStore }, { setAssistantTelemetryContext }, share] = await Promise.all([
    import("@/composables/assistant"),
    import("@/services/assistantAnalytics"),
    import("@/components/ai-assistant/share/chatShare"),
  ]);
  assistantStore.init({
    getOrg: () => {
      const org = store.state.selectedOrganization;
      return org?.identifier ? { identifier: org.identifier, name: org.label ?? "" } : null;
    },
    getUser: () => {
      const email = (store.state.userInfo as { email?: string })?.email;
      const role = (store.state.currentuser as { role?: string })?.role ?? "";
      return email ? { email, role } : null;
    },
    getConfig: () => {
      const zo = store.state.zoConfig;
      if (typeof zo?.ai_enabled !== "boolean") return null;
      return {
        aiEnabled: zo.ai_enabled,
        rbacEnabled: zo.rbac_enabled !== false,
        persistence: share.isChatPersistenceEnabled(zo),
        publicLinks: share.isPublicChatEnabled(zo),
        publicMaxExpiryDays: share.publicMaxExpirySecs(zo) / 86_400,
        rcaEnabled: zo.rca_enabled === true,
      };
    },
    isOrgAdmin: () => share.orgAdminFlag(store.state),
    getOrganizations: () =>
      (store.state.organizations as { identifier?: string }[])
        .map((org) => org.identifier)
        .filter((id): id is string => !!id),
    router,
  });
  setAssistantTelemetryContext(assistantStore.telemetryContext(uiVersion));
}

getConfig();

// ===== Smart Stale Build Detection (Industry Standard) =====
// Detects stale build errors (new deployment, old chunks deleted) and prompts user to refresh

// Track if notification is already shown to prevent duplicates
let staleNotificationShown = false;

// Helper: Show new version notification (only once)
function showNewVersionNotification() {
  if (staleNotificationShown) {
    return;
  }

  staleNotificationShown = true;
  toast({
    variant: "error",
    message: raw(i18n.global.t("common.chunkLoadErrorMsg")),
    timeout: 0, // Don't auto-dismiss
    action: {
      label: raw(i18n.global.t("common.refresh")),
      handler: () => {
        window.location.reload();
      },
    },
  });
}

// Handle resource load errors (script/link tags)
window.addEventListener(
  "error",
  async (event) => {
    const target = event.target as HTMLScriptElement | HTMLLinkElement;

    // Check if the error is from loading a script or stylesheet
    if (target && (target.tagName === "SCRIPT" || target.tagName === "LINK")) {
      const url =
        target.tagName === "SCRIPT"
          ? (target as HTMLScriptElement).src
          : (target as HTMLLinkElement).href;

      if (!url) return;

      // Only check for OpenObserve's own chunks (relative URLs or same origin)
      // Ignore external CDN resources (absolute URLs with different origins)
      const isOpenObserveResource = (() => {
        try {
          // Resolve relative URLs against current origin
          const resourceUrl = new URL(url, window.location.origin);
          // Only check resources from same origin
          return resourceUrl.origin === window.location.origin;
        } catch (e) {
          // Invalid URL - assume it's a relative path (OpenObserve resource)
          return true;
        }
      })();

      if (isOpenObserveResource) {
        // Smart detection: Check if it's stale build
        const isStale = await buildVersionChecker.isStaleResourceError();

        if (isStale) {
          showNewVersionNotification();
          event.preventDefault();
        }
      }
    }
  },
  true,
);

// Handle dynamic import errors (for code splitting)
router.onError(async (error) => {
  if (isChunkLoadError(error)) {
    // Smart detection: Check if it's stale build or network error
    const isStale = await buildVersionChecker.isStaleChunkError(error);

    if (isStale) {
      showNewVersionNotification();
    }
  }
});

// router.onError only sees route chunks; lazy components (e.g. the alert dialog) fail through Vite's preload hook.
window.addEventListener("vite:preloadError", async (event) => {
  if (
    isChunkLoadError(event.payload) &&
    (await buildVersionChecker.isStaleChunkError(event.payload))
  ) {
    showNewVersionNotification();
  }
});

// Ensure the active locale's messages are loaded (en-us is bundled; any other
// language is fetched as a code-split chunk) before the first render.
loadLocaleMessages(activeLocale)
  // On a locale-chunk load failure, fall back to the bundled en-us messages
  // (no console noise). The app must mount regardless.
  .catch(() => {})
  .finally(() => {
    app.mount("#app");
  });
