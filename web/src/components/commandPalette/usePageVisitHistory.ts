import { onScopeDispose } from "vue";
import { useQueryClient } from "@tanstack/vue-query";
import { useRouter } from "vue-router";
import { useI18nTyped, type I18nKey } from "@/types/i18n";
import {
  captureRecentVisitScope,
  recordPageVisit,
  type RecentVisitScope,
} from "./useRecentlyViewed";
import { RECENT_PAGE_ROUTES, type RecentPageRoute } from "./resourceRoutes";

const PAGE_LABELS: Record<RecentPageRoute, I18nKey> = {
  logs: "common.logs",
  metrics: "common.metrics",
  traces: "common.traces",
  dashboards: "menu.dashboard",
  alertList: "menu.alerts",
  functionList: "function.header",
  pipelines: "menu.pipeline",
  synthetics: "menu.synthetic",
  users: "iam.basicUsers",
  serviceAccounts: "iam.serviceAccounts",
};
function mainList(page: RecentPageRoute, key: readonly unknown[]): boolean {
  const domain = key[2],
    list = key[3];
  switch (page) {
    case "dashboards":
      return domain === "dashboards" && (list === "list" || list === "search");
    case "alertList":
      return domain === "alerts" && (list === "list" || list === "search");
    case "functionList":
      return domain === "functions" && list === "list";
    case "pipelines":
      return domain === "pipelines" && list === "list";
    case "synthetics":
      return domain === "synthetics" && list === "monitors";
    case "users":
      return domain === "iam" && list === "users" && key.length === 4;
    case "serviceAccounts":
      return domain === "iam" && list === "serviceAccounts" && key.length === 4;
    case "logs":
    case "metrics":
    case "traces":
      return domain === "streams" && (list === "nameList" || list === "page") && key[4] === page;
  }
}
export function usePageVisitHistory() {
  const client = useQueryClient();
  const router = useRouter();
  const { t } = useI18nTyped();
  const pending = new WeakMap<object, { scope: RecentVisitScope; page: RecentPageRoute }>();
  function context(key: readonly unknown[]) {
    const route = router.currentRoute.value;
    const name = route.name;
    const scope = captureRecentVisitScope();
    if (
      !scope ||
      key[0] !== "org" ||
      key[1] !== scope.org ||
      route.query.action ||
      typeof name !== "string" ||
      !RECENT_PAGE_ROUTES.includes(name as RecentPageRoute)
    )
      return null;
    const page = name as RecentPageRoute;
    return mainList(page, key) ? { scope, page } : null;
  }
  const unsubscribe = client.getQueryCache().subscribe((event) => {
    const query = event.query;
    if (
      event.type === "added" ||
      event.type === "observerAdded" ||
      (event.type === "updated" && event.action.type === "fetch")
    ) {
      const current = context(query.queryKey);
      if (current) pending.set(query, current);
      else pending.delete(query);
    }
    const success =
      (event.type === "observerAdded" && query.state.status === "success") ||
      (event.type === "updated" && event.action.type === "success");
    const target = pending.get(query);
    if (
      !success ||
      !target ||
      target.page !== router.currentRoute.value.name ||
      router.currentRoute.value.query.action ||
      document.querySelector('[role="dialog"]')
    )
      return;
    recordPageVisit(target.scope, target.page, t(PAGE_LABELS[target.page]));
  });
  onScopeDispose(unsubscribe);
}
