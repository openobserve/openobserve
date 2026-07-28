// useAiFilterUrlSync — the type/stream/agent URL-sync logic extracted
// byte-identical from SessionsList.vue (syncFilterUrl + url reads at setup).
// Behavior must remain identical to the original inline implementation.

import { type Ref, type ComputedRef } from "vue";
import { useRoute, useRouter } from "vue-router";

export function useAiFilterUrlSync(args: {
  filterMode: Ref<"stream" | "agent">;
  activeStream: Ref<string>;
  selectedAgent: Ref<{ name?: string } | null> | ComputedRef<{ name?: string } | null>;
}) {
  const route = useRoute();
  const router = useRouter();

  const urlType = typeof route.query.type === "string" ? route.query.type : "";
  const urlStream = typeof route.query.stream === "string" ? route.query.stream : "";
  const urlAgentName = typeof route.query.agent === "string" ? route.query.agent : "";

  function syncFilterUrl() {
    const query: Record<string, any> = { ...route.query, type: args.filterMode.value };
    if (args.filterMode.value === "agent") {
      delete query.stream;
      if (args.selectedAgent.value?.name) query.agent = args.selectedAgent.value.name;
      else delete query.agent;
    } else {
      delete query.agent;
      if (args.activeStream.value) query.stream = args.activeStream.value;
      else delete query.stream;
    }
    router.replace({ query }).catch(() => {});
  }

  return { urlType, urlStream, urlAgentName, syncFilterUrl };
}
