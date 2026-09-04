// useFilterMode — shared filterMode (stream|agent) state + persistence,
// extracted from SessionsList.vue. State + persistence ONLY; page-specific
// side-effects (reload/skeleton/clear) stay per-page via a caller-wrapped
// setter around setMode().
//
// Init precedence matches SessionsList.vue:344-345 EXACTLY:
//   const filterMode = ref<"stream" | "agent">(
//     urlType === "stream" ? "stream" : "agent",
//   );
// i.e. the initial value comes from `initialFromUrlType` ONLY — localStorage
// is never read for init, even when a persistKey is supplied. localStorage
// is only written to on setMode(), matching SessionsList's load-path write
// (localStorage.setItem(MODE_LS_KEY, filterMode.value) at line 595).

import { ref } from "vue";

export type FilterMode = "stream" | "agent";

export interface UseFilterModeOptions {
  /** Default mode when initialFromUrlType is not "stream". Defaults to "agent". */
  default?: FilterMode;
  /** When set, localStorage is written on setMode() using this key. Never read for init. */
  persistKey?: string;
  /** Typically route.query.type. When exactly "stream", initial mode is "stream". */
  initialFromUrlType?: string;
}

export function useFilterMode(opts: UseFilterModeOptions = {}) {
  const def: FilterMode = opts.default ?? "agent";
  const initial: FilterMode = opts.initialFromUrlType === "stream" ? "stream" : def;

  const filterMode = ref<FilterMode>(initial);

  function setMode(mode: FilterMode) {
    filterMode.value = mode;
    if (opts.persistKey) {
      localStorage.setItem(opts.persistKey, mode);
    }
  }

  return { filterMode, setMode };
}
