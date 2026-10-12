<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<!--
  Shared wrapper for ingestion (data source) detail pages.

  It centralizes the page padding and the vertical rhythm between sections
  (code blocks, doc links, notes) so every data-source tab looks identical,
  and mounts the page's FirstEventStatus bar under its snippets.
-->
<template>
  <div ref="root" class="flex flex-col gap-4 p-3 text-sm">
    <SlotWithBar />
  </div>
</template>

<script setup lang="ts">
import { computed, h, ref, useSlots, type VNode } from "vue";
import { useRoute } from "vue-router";
import { useStore } from "vuex";
import FirstEventStatus from "./FirstEventStatus.vue";
import IngestionDocLink from "./IngestionDocLink.vue";
import type { StreamSignal } from "@/composables/firstEvent/useFirstEventWatch";
import { provideSnippetCopied } from "@/composables/firstEvent/firstEventCopied";

const props = defineProps<{
  docUrl?: string;
  guideName?: string;
  snippetKind?: "command" | "config";
  signal?: StreamSignal;
  targetStream?: string;
}>();

const SIGNAL_PARENT_ROUTES: Record<string, StreamSignal> = {
  ingestLogs: "logs",
  ingestMetrics: "metrics",
  ingestTraces: "traces",
};
// the curl guide posts its test record to this stream (Curl.vue)
const TEST_GUIDES: Record<string, string> = { curl: "default" };

const slots = useSlots();
const route = useRoute();
const store = useStore();
const root = ref<HTMLElement | null>(null);
const bar = ref<InstanceType<typeof FirstEventStatus> | null>(null);
const snippetCopied = provideSnippetCopied(bar);

const routeName = computed(() => String(route?.name ?? ""));
const signal = computed<StreamSignal | undefined>(() => {
  if (props.signal) return props.signal;
  for (const r of route?.matched ?? []) {
    const s = SIGNAL_PARENT_ROUTES[String(r.name ?? "")];
    if (s) return s;
  }
  return undefined;
});
const isTestGuide = computed(() => routeName.value in TEST_GUIDES);
const targetStream = computed(() => props.targetStream ?? TEST_GUIDES[routeName.value]);
const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");

const isDocLink = (node: VNode) => node.type === IngestionDocLink;

// Re-copies through the page's own block, so the clipboard, the toast and snippet_copied match a click on it.
const copyPageSnippet = () => {
  const buttons = Array.from(
    root.value?.querySelectorAll<HTMLElement>(
      '[data-test^="ingestion-"][data-test$="-code-block-copy-btn"]',
    ) ?? [],
  );
  const button = props.snippetKind === "config" ? buttons[buttons.length - 1] : buttons[0];
  button?.click();
};

const SlotWithBar = () => {
  const nodes = slots.default?.() ?? [];
  const docIndex = nodes.findIndex(isDocLink);
  const docUrl =
    props.docUrl ??
    (docIndex >= 0 ? (nodes[docIndex].props?.href as string | undefined) : undefined);
  const barNode = h(FirstEventStatus, {
    key: `${org.value}/${routeName.value}`,
    ref: bar,
    org: org.value,
    signal: signal.value,
    targetStream: targetStream.value,
    kind: isTestGuide.value ? "test" : "standard",
    guideName: props.guideName ?? "",
    docUrl,
    snippetKind: props.snippetKind ?? "command",
    onCopyCommand: copyPageSnippet,
  });
  if (!org.value) return nodes;
  const at = docIndex >= 0 ? docIndex : nodes.length;
  return [...nodes.slice(0, at), barNode, ...nodes.slice(at)];
};

// for guides whose copies are handled in their own setup, above this component's provide
defineExpose({ snippetCopied });
</script>
