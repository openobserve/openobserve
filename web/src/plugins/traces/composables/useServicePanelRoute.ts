import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  queryText,
  withoutKeys,
  compareKeys,
  panelKeys,
} from "@/enterprise/composables/useVersionCompareDrawer";
// A dependency panel (datastore, RPC, …) carries its kind, since a service and a dependency can share a name.
const KIND_KEY = "panelKind";
const ownKeys = [...panelKeys, KIND_KEY];
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
    kind: queryText(route.query[KIND_KEY]),
  }));
  // Parents keep the last service's route while another node is selected, so only the node it names owns it.
  function owns(
    node?: { name?: string; label?: string; id?: string; service_type?: string } | null,
  ) {
    if (!state.value.open || !node || (node.service_type || "") !== state.value.kind) return false;
    return [node.name, node.label, node.id].includes(state.value.service);
  }
  function open(service: string, where: string, tab = "operations", kind = "") {
    return router.push({
      query: {
        ...withoutKeys(route.query, [...ownKeys, ...compareKeys]),
        panel: tab,
        panelSvc: service,
        panelWhere: where,
        ...(kind ? { [KIND_KEY]: kind } : {}),
      },
    });
  }
  function close() {
    return router.replace({ query: withoutKeys(route.query, ownKeys) });
  }
  function update(where: string, tab: string) {
    return router.replace({ query: { ...route.query, panel: tab, panelWhere: where } });
  }
  return { state, owns, open, close, update };
}
