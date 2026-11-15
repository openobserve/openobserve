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
    tab: queryText(route.query.panel) || "operations",
  }));
  // Parents keep the last service's route while a dependency is selected, so only the node it names owns it.
  function owns(
    node?: { name?: string; label?: string; id?: string; service_type?: string } | null,
  ) {
    if (!state.value.open || !node || node.service_type) return false;
    return [node.name, node.label, node.id].includes(state.value.service);
  }
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
  return { state, owns, open, close, update };
}
