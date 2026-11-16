import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  queryText,
  withoutKeys,
  compareKeys,
  panelKeys,
  PANEL_KIND_KEY,
  PANEL_SYSTEM_KEY,
} from "@/enterprise/composables/useVersionCompareDrawer";
export function useServicePanelRoute() {
  const route = useRoute(),
    router = useRouter();
  const state = computed(() => ({
    open: !route.query.cmp && Boolean(route.query.panel && route.query.panelSvc),
    service: queryText(route.query.panelSvc),
    where: queryText(route.query.panelWhere),
    // Links written before the place existed carry no panelWhere at all, unlike a link to every place.
    whereSet: route.query.panelWhere !== undefined,
    tab: queryText(route.query.panel) || "operations",
    kind: queryText(route.query[PANEL_KIND_KEY]),
    // Links written before the system existed match a dependency of any system.
    system:
      route.query[PANEL_SYSTEM_KEY] === undefined
        ? undefined
        : queryText(route.query[PANEL_SYSTEM_KEY]),
  }));
  // Parents keep the last service's route while another node is selected, so only the node it names owns it.
  function owns(
    node?: { name?: string; label?: string; id?: string; service_type?: string } | null,
  ) {
    if (!state.value.open || !node || (node.service_type || "") !== state.value.kind) return false;
    return [node.name, node.label, node.id].includes(state.value.service);
  }
  function open(service: string, where: string, tab = "operations", kind = "", system?: string) {
    return router.push({
      query: {
        ...withoutKeys(route.query, [...panelKeys, ...compareKeys]),
        panel: tab,
        panelSvc: service,
        panelWhere: where,
        ...(kind ? { [PANEL_KIND_KEY]: kind } : {}),
        ...(kind && system !== undefined ? { [PANEL_SYSTEM_KEY]: system } : {}),
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
