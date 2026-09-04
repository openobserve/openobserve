import { computed, type ComputedRef, type Ref } from "vue";

// `object` (not Record<string, unknown>): interfaces lack implicit index signatures
export function useNumberedRows<T extends object>(
  source: Ref<T[]> | ComputedRef<T[]>,
): ComputedRef<(T & { "#": string })[]> {
  return computed(() =>
    source.value.map((row, index) => ({
      ...row,
      "#": index < 9 ? `0${index + 1}` : String(index + 1),
    })),
  );
}
