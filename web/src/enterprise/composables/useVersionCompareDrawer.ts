import { computed, watch } from "vue";
import { useRoute, useRouter, type LocationQuery, type LocationQueryRaw } from "vue-router";
const openedEntries = new Set<string>();
export const compareKeys = [
  "cmp",
  "cmpSvc",
  "cmpWhere",
  "cmpEnv",
  "cmpBase",
  "cmpPin",
  "cmpFrom",
  "cmpDeploy",
  "cmpImgA",
  "cmpImgB",
];
export const panelKeys = ["panel", "panelSvc", "panelWhere"];
export const queryText = (value: LocationQuery[string]) => (typeof value === "string" ? value : "");
export function withoutKeys(query: LocationQuery, keys: string[]): LocationQueryRaw {
  return Object.fromEntries(Object.entries(query).filter(([key]) => !keys.includes(key)));
}
export interface CompareLocation {
  service: string;
  where: string;
  a: string;
  b?: string;
  // The image picks one build when a version text has several; omitted means the server's default row.
  aImage?: string | null;
  bImage?: string | null;
  deployKey?: string;
  fromPanel?: boolean;
}
export function resolveCompareArms(value: string, knownVersions: readonly string[]) {
  const splits: { a: string; b: string }[] = [];
  for (let index = value.indexOf(".."); index !== -1; index = value.indexOf("..", index + 1)) {
    splits.push({ a: value.slice(0, index), b: value.slice(index + 2) });
  }
  if (!splits.length) return { a: value, b: undefined, ambiguous: false };
  if (splits.length === 1) return { ...splits[0], ambiguous: false };
  const matches = splits.filter(
    ({ a, b }) => knownVersions.includes(a) && knownVersions.includes(b),
  );
  return matches.length === 1
    ? { ...matches[0], ambiguous: false }
    : { a: "", b: undefined, ambiguous: true };
}
export function useVersionCompareDrawer(knownVersions: () => readonly string[] = () => []) {
  const route = useRoute();
  const router = useRouter();
  const state = computed(() => {
    const { a, b, ambiguous } = resolveCompareArms(queryText(route.query.cmp), knownVersions());
    return {
      service: queryText(route.query.cmpSvc),
      where: queryText(route.query.cmpWhere),
      a: a || "",
      b,
      aImage: queryText(route.query.cmpImgA),
      bImage: queryText(route.query.cmpImgB),
      ambiguous,
      deployKey: queryText(route.query.cmpDeploy),
      baseline: queryText(route.query.cmpBase),
      pinned: route.query.cmpPin === "1",
      fromPanel: route.query.cmpFrom === "panel",
      legacyEnv: queryText(route.query.cmpEnv),
    };
  });
  const isOpen = computed(() => Boolean(queryText(route.query.cmp) && state.value.service));
  watch(
    () => route.query,
    (query) => {
      if (query.cmp && panelKeys.some((key) => query[key])) {
        void router.replace({ query: withoutKeys(query, panelKeys) });
      }
    },
    { immediate: true },
  );
  async function open(input: CompareLocation) {
    if (input.fromPanel && route.query.panel && route.query.panel !== "versions")
      await router.replace({ query: { ...route.query, panel: "versions" } });
    const entry = crypto.randomUUID();
    openedEntries.add(entry);
    return router.push({
      query: {
        ...withoutKeys(route.query, [...compareKeys, ...panelKeys]),
        cmp: input.b ? `${input.a}..${input.b}` : input.a,
        cmpSvc: input.service,
        cmpWhere: input.where,
        ...(input.deployKey ? { cmpDeploy: input.deployKey } : {}),
        ...(input.aImage ? { cmpImgA: input.aImage } : {}),
        ...(input.b && input.bImage ? { cmpImgB: input.bImage } : {}),
        ...(input.fromPanel ? { cmpFrom: "panel" } : {}),
      },
      state: { o2CmpOpened: entry, o2CmpFromPanel: Boolean(input.fromPanel) },
    });
  }
  function backToService() {
    if (
      openedEntries.has(window.history.state?.o2CmpOpened) &&
      window.history.state?.o2CmpFromPanel
    )
      return router.back();
    return router.replace({
      query: {
        ...withoutKeys(route.query, compareKeys),
        panel: "versions",
        panelSvc: state.value.service,
        panelWhere: state.value.where,
      },
    });
  }
  function close() {
    if (state.value.fromPanel) return backToService();
    if (openedEntries.has(window.history.state?.o2CmpOpened)) return router.back();
    return router.replace({ query: withoutKeys(route.query, compareKeys) });
  }
  function update(query: LocationQueryRaw) {
    return router.replace({ query: { ...route.query, ...query } });
  }
  return {
    state,
    isOpen,
    open,
    close,
    backToService,
    openService: () =>
      router.replace({
        name: "traces",
        query: {
          ...withoutKeys(route.query, compareKeys),
          tab: "services-catalog",
          panel: "versions",
          panelSvc: state.value.service,
          panelWhere: state.value.where,
        },
      }),
    update,
  };
}
