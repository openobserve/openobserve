<!-- Copyright 2026 OpenObserve Inc.

  One variant as a full column in the editor bench: header, config, output.
  The config scrolls and the output is pinned to the bottom, so the thing you
  are waiting for never scrolls out from under you while you edit the prompt.
-->
<template>
  <section
    class="border-border-default bg-surface-base rounded-surface flex min-h-0 max-w-140 min-w-85 flex-1 flex-col overflow-hidden border"
    :data-test="`ai-playground-variant-${label}`"
  >
    <div class="border-border-default shrink-0 border-b px-2.5 py-1.5">
      <PlaygroundVariantHeader
        :variant="variant"
        :label="label"
        :running="running"
        :run-disabled="runDisabled"
        :can-remove="canRemove"
        :can-duplicate="canDuplicate"
        @run="emit('run')"
        @duplicate="emit('duplicate')"
        @remove="emit('remove')"
        @create-experiment="emit('create-experiment')"
      />
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto px-2.5 py-2.5">
      <PlaygroundVariantConfig
        :variant="variant"
        :providers="providers"
        :fields="fields"
        @change="(next) => emit('change', next)"
      />
    </div>

    <div class="border-border-default shrink-0 border-t px-2.5 py-2.5">
      <PlaygroundOutputCell
        :cell="cell"
        :stale="variant.stale"
        show-actions
        :data-test="`ai-playground-output-${label}`"
        @retry="emit('run')"
        @copy="emit('copy')"
        @add-to-messages="emit('add-to-messages')"
        @create-experiment="emit('create-experiment')"
      />
    </div>
  </section>
</template>

<script setup lang="ts">
import PlaygroundOutputCell from "./PlaygroundOutputCell.vue";
import PlaygroundVariantConfig from "./PlaygroundVariantConfig.vue";
import PlaygroundVariantHeader from "./PlaygroundVariantHeader.vue";
import type {
  PlaygroundCell,
  PlaygroundVariant,
} from "@/enterprise/views/AIObservability/playgroundDraft";
import type { Provider } from "@/services/online-evals.service";

withDefaults(
  defineProps<{
    variant: PlaygroundVariant;
    label: string;
    cell: PlaygroundCell | undefined;
    providers: Provider[];
    fields: string[] | null;
    running?: boolean;
    runDisabled?: boolean;
    canRemove?: boolean;
    canDuplicate?: boolean;
  }>(),
  { running: false, runDisabled: false, canRemove: true, canDuplicate: true },
);

const emit = defineEmits<{
  change: [variant: PlaygroundVariant];
  run: [];
  duplicate: [];
  remove: [];
  copy: [];
  "add-to-messages": [];
  "create-experiment": [];
}>();
</script>
