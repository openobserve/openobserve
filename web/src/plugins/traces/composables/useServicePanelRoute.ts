import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  queryText,
  withoutKeys,
  compareKeys,
  panelKeys,
} from "@/enterprise/composables/useVersionCompareDrawer";
export function useServicePanelRoute() {
  const route = useRoute(),
    router = useRouter();
  const state = computed(() => ({
    open: !route.query.cmp && Boolean(route.query.panel && route.query.panelSvc),
    service: queryText(route.query.panelSvc),
    where: queryText(route.query.panelWhere),
    tab: queryText(route.query.panel) === "versions" ? "versions" : "operations",
  }));
  function open(service: string, where: string, tab = "operations") {
    return router.push({
      query: {
        ...withoutKeys(route.query, [...panelKeys, ...compareKeys]),
        panel: tab,
        panelSvc: service,
        panelWhere: where,
      },
    });
  }
  function close() {
    return router.replace({ query: withoutKeys(route.query, panelKeys) });
  }
  function update(where: string, tab: string) {
    return router.replace({ query: { ...route.query, panel: tab, panelWhere: where } });
  }
  return { state, open, close, update };
}
