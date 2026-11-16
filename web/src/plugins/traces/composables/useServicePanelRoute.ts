import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { serviceKey } from "@/utils/serviceCount";
import {
  queryText,
  withoutKeys,
  compareKeys,
  panelKeys,
  PANEL_KIND_KEY,
  PANEL_SYSTEM_KEY,
} from "@/enterprise/composables/useVersionCompareDrawer";

interface PanelNode {
  name?: string;
  label?: string;
  id?: string;
  service_type?: string;
}

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
  function named(node: PanelNode | null | undefined, folded: boolean) {
    if (!state.value.open || !node || (node.service_type || "") !== state.value.kind) return false;
    const names = [node.name, node.label, node.id];
    if (!folded) return names.includes(state.value.service);
    // The catalog folds an instrumented service's spellings into one row, so a link may name any of them.
    const key = serviceKey(state.value.service);
    return (
      !state.value.kind && names.some((name) => name !== undefined && serviceKey(name) === key)
    );
  }
  // Parents keep the last service's route while another node is selected, so only the node it names owns it.
  function owns(node?: PanelNode | null) {
    return named(node, false) || named(node, true);
  }
  // Nodes keep their raw spellings apart, so the spelling the link names wins over a folded one.
  function find<T extends PanelNode>(nodes: readonly T[]) {
    return nodes.find((node) => named(node, false)) ?? nodes.find((node) => named(node, true));
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
  return { state, owns, find, open, close, update };
}
