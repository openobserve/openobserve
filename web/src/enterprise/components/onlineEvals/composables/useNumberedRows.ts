import { computed, type ComputedRef, type Ref } from "vue";

export function useNumberedRows<T extends Record<string, unknown>>(
  source: Ref<T[]> | ComputedRef<T[]>,
): ComputedRef<(T & { "#": string })[]> {
  return computed(() =>
    source.value.map((row, index) => ({
      ...row,
      "#": index < 9 ? `0${index + 1}` : String(index + 1),
    })),
  );
}
