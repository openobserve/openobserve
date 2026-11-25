import { computed, onScopeDispose, ref, watch, type Ref } from "vue";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import { resourceKeys, resourcesQuery } from "@/services/resources.queries";
import type {
  ResourceKind,
  ResourceSearchParams,
  ResourceSearchResponse,
  ResourceSource,
} from "@/ts/interfaces/resources";

let scopeSequence = 0;
// A denied or disabled source stays that way, so it is neither retried nor reported as incomplete.
export function retryable(source: ResourceSource) {
  return (
    source.status !== "complete" &&
    source.reason !== "disabled" &&
    source.reason !== "permission_denied"
  );
}
export function useResourceSearch(input: {
  open: Ref<boolean>;
  org: Ref<string>;
  subject: Ref<string>;
  query: Ref<string>;
  type: Ref<ResourceKind | "all">;
  /** The kinds this user's navigation shows; "all" searches only these. */
  kinds: Ref<ResourceKind[]>;
}) {
  const scope = ++scopeSequence;
  const client = useQueryClient();
  const debouncing = ref(true);
  const params = ref<ResourceSearchParams>({ q: "", limit: 20 });
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
      (input.type.value !== "all" || (!!input.query.value.trim() && input.kinds.value.length > 0)),
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
    [input.open, input.org, input.subject, input.query, input.type, input.kinds],
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
          types: input.type.value === "all" ? input.kinds.value : [input.type.value],
          limit: 20,
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
    const failed = data.value?.sources.filter(retryable).map((s) => s.type) ?? [];
    if (!failed.length || retrying.value) return;
    const token = sequence;
    retrying.value = poll ? "poll" : "manual";
    retryError.value = null;
    try {
      const patch = await client.fetchQuery(
        resourcesQuery(
          input.org.value,
          input.subject.value,
          { ...params.value, types: failed },
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
  const schedulePoll = (result: ResourceSearchResponse | undefined) => {
    clearTimeout(pollTimer);
    if (result?.sources.some((source) => source.reason === "loading")) {
      const token = sequence;
      pollTimer = setTimeout(() => {
        if (token === sequence && eligible.value) void retryFailed(true);
      }, 1000);
    }
  };
  watch(data, schedulePoll);
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
    refetch: async () => {
      // Supersedes in-flight polls and retries, whose older answers would cover the fresh one.
      sequence += 1;
      const token = sequence;
      clearTimeout(pollTimer);
      retrying.value = false;
      retryError.value = null;
      patches.value = [];
      const result = await query.refetch();
      // An answer equal to the last one keeps its reference, so the data watcher would not re-arm.
      if (token === sequence) schedulePoll(data.value);
      return result;
    },
  };
}
