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

import { ref } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import searchService from "@/services/search";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useI18nTyped } from "@/types/i18n";
import { sqlLiteral } from "@/utils/query/sqlFilterBuilder";
import { PA_ROUTES } from "@/utils/rum/productAnalyticsRoutes";

const DEFAULT_WINDOW_US = 7 * 24 * 3_600_000_000;

/** Opens the Product Analytics heatmap on the page a session started on. */
export default function useSessionHeatmap() {
  const { t } = useI18nTyped();
  const router = useRouter();
  const store = useStore();
  const opening = ref(false);
  const openingSessionId = ref("");

  // The window always reaches back to the session so an old session's page is still in the list.
  async function openSessionHeatmap(sessionId: string, sessionStartUs: number) {
    if (!sessionId || opening.value) return;
    opening.value = true;
    openingSessionId.value = sessionId;
    try {
      const org = store.state.selectedOrganization.identifier;
      const nowUs = Date.now() * 1000;
      const fromUs = Math.min(sessionStartUs || nowUs, nowUs - DEFAULT_WINDOW_US);
      const res: any = await searchService.search(
        {
          org_identifier: org,
          query: {
            query: {
              sql: `SELECT application_id AS app, view_url AS url FROM "_rumdata" WHERE session_id = ${sqlLiteral(sessionId)} AND type = 'view' AND view_url IS NOT NULL ORDER BY ${store.state.zoConfig.timestamp_column || "_timestamp"} ASC LIMIT 1`,
              start_time: fromUs,
              end_time: nowUs,
              from: 0,
              size: 1,
            },
          },
          page_type: "logs",
        },
        "RUM",
      );
      const hit = res.data?.hits?.[0];
      if (!hit?.url || !hit?.app) {
        toast({ message: t("rum.heatmap.sessionNoPage"), variant: "warning" });
        return;
      }
      await router.push({
        name: PA_ROUTES.heatmaps,
        query: {
          org_identifier: org,
          app: String(hit.app),
          page_url: String(hit.url),
          from: String(Math.trunc(fromUs)),
          to: String(Math.trunc(nowUs)),
        },
      });
    } catch (error) {
      console.error("Session heatmap link failed", error);
      toast({ message: t("rum.heatmap.sessionOpenFailed"), variant: "error" });
    } finally {
      opening.value = false;
      openingSessionId.value = "";
    }
  }

  return { openSessionHeatmap, opening, openingSessionId };
}
