import { computed, onScopeDispose, ref, watch, type Ref } from "vue";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import { resourceKeys, resourcesQuery } from "@/services/resources.queries";
import type {
  ResourceKind,
  ResourceSearchParams,
  ResourceSearchResponse,
} from "@/ts/interfaces/resources";

let scopeSequence = 0;
export function useResourceSearch(input: {
  open: Ref<boolean>;
  org: Ref<string>;
  subject: Ref<string>;
  query: Ref<string>;
  type: Ref<ResourceKind | "all">;
  offset?: Ref<number>;
  limit?: number;
}) {
  const scope = ++scopeSequence;
  const client = useQueryClient();
  const debouncing = ref(true);
  const params = ref<ResourceSearchParams>({ q: "", limit: input.limit ?? 20 });
  const patches = ref<ResourceSearchResponse[]>([]);
  const retrying = ref<false | "manual" | "poll">(false);
  const retryError = ref<unknown>(null);
  let sequence = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let previousScope = resourceKeys.scope(input.org.value, input.subject.value, scope);
  const eligible = computed(
    () =>
      input.open.value &&
      !!input.org.value &&
      !!input.subject.value &&
      (!!input.query.value.trim() || input.type.value !== "all"),
  );
  const query = useQuery(() => ({
    ...resourcesQuery(input.org.value, input.subject.value, params.value, scope),
    enabled: eligible.value && !debouncing.value,
  }));
  const cancel = () => {
    clearTimeout(timer);
    clearTimeout(pollTimer);
    void client.cancelQueries({ queryKey: previousScope });
    client.removeQueries({ queryKey: previousScope });
  };
  watch(
    [input.open, input.org, input.subject, input.query, input.type, () => input.offset?.value],
    () => {
      sequence += 1;
      debouncing.value = eligible.value;
      cancel();
      previousScope = resourceKeys.scope(input.org.value, input.subject.value, scope);
      patches.value = [];
      retryError.value = null;
      retrying.value = false;
      if (!eligible.value) return;
      timer = setTimeout(() => {
        params.value = {
          q: input.query.value.trim(),
          types: input.type.value === "all" ? undefined : [input.type.value],
          limit: input.limit ?? 20,
          offset: input.offset?.value || undefined,
        };
        debouncing.value = false;
      }, 200);
    },
    { immediate: true, flush: "sync" },
  );
  const data = computed<ResourceSearchResponse | undefined>(() => {
    if (!eligible.value || debouncing.value || !query.data.value) return undefined;
    return patches.value.reduce((base, patch) => {
      const types = new Set(patch.sources.map((s) => s.type));
      return {
        hits: [...base.hits.filter((h) => !types.has(h.type)), ...patch.hits],
        sources: [...base.sources.filter((s) => !types.has(s.type)), ...patch.sources],
        took_ms: patch.took_ms,
      };
    }, query.data.value);
  });
  const retryFailed = async (poll = false) => {
    const failed =
      data.value?.sources
        .filter(
          (s) =>
            s.status !== "complete" && s.reason !== "disabled" && s.reason !== "permission_denied",
        )
        .map((s) => s.type) ?? [];
    if (!failed.length || retrying.value) return;
    const token = sequence;
    retrying.value = poll ? "poll" : "manual";
    retryError.value = null;
    try {
      const patch = await client.fetchQuery(
        resourcesQuery(
          input.org.value,
          input.subject.value,
          { ...params.value, types: failed, offset: undefined },
          scope,
        ),
      );
      if (token === sequence) patches.value.push(patch);
    } catch (error) {
      if (token === sequence) retryError.value = error;
    } finally {
      if (token === sequence) retrying.value = false;
    }
  };
  watch(data, (result) => {
    clearTimeout(pollTimer);
    if (result?.sources.some((source) => source.reason === "loading")) {
      const token = sequence;
      pollTimer = setTimeout(() => {
        if (token === sequence && eligible.value) void retryFailed(true);
      }, 1000);
    }
  });
  onScopeDispose(cancel);
  return {
    data,
    pending: computed(
      // A background poll flipping this each second resizes the centred dialog under the pointer.
      () =>
        (eligible.value && debouncing.value) ||
        query.isFetching.value ||
        retrying.value === "manual",
    ),
    error: computed(() =>
      eligible.value && !debouncing.value ? (retryError.value ?? query.error.value) : null,
    ),
    retryFailed,
    refetch: () => {
      retryError.value = null;
      return query.refetch();
    },
  };
}
