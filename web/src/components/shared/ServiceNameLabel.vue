<template>
  <span
    v-if="!serviceKey"
    class="text-text-muted"
    data-test="svcver-service-name"
    data-display-source="none"
    >{{ raw("—") }}</span
  >
  <span
    v-else-if="layout === 'chip'"
    class="inline-flex min-w-0"
    data-test="svcver-service-name"
    :data-display-source="displaySource || 'none'"
    ><ODimensionChip
      dim-key="service"
      :key-label="keyLabel || t('serviceVersions.names.serviceChip')"
      :value="primaryText"
      :value-tooltip="false" /><OTooltip v-if="hasDisplay" side="top"
      ><template #content
        ><ServiceNameHover v-bind="hoverProps" :show-candidates="true" /></template></OTooltip
  ></span>
  <span
    v-else
    :class="[
      'min-w-0',
      layout === 'stacked' ? 'inline-flex flex-col' : 'inline-flex items-baseline gap-1',
    ]"
    data-test="svcver-service-name"
    :data-display-source="displaySource || 'none'"
    ><span class="flex min-w-0 items-center gap-1"
      ><OTruncatedText :class="['min-w-0', mono ? 'font-mono' : '', primaryClass]"
        ><slot name="primary" :label="name">{{ name }}</slot></OTruncatedText
      ><span
        v-if="qualifier"
        class="text-text-secondary shrink-0"
        data-test="svcver-service-name-qualifier"
        >{{ t("serviceVersions.names.qualifier", { qualifier: raw(qualifier) }) }}</span
      ><OTooltip v-if="hasDisplay" side="top"
        ><template #content><ServiceNameHover v-bind="hoverProps" /></template></OTooltip
      ><OPopover v-if="ambiguous" v-model:open="candidatesOpen" side="bottom" align="start"
        ><template #trigger
          ><button type="button" class="shrink-0 cursor-pointer" @click.stop>
            <OTag
              variant="default-soft"
              size="xs"
              :label="t('serviceVersions.names.ambiguity', { count }, count)"
              data-test="svcver-service-name-ambiguity"
            /></button
        ></template>
        <div
          class="flex max-w-80 flex-col gap-1 p-2 text-xs"
          data-test="svcver-service-name-candidates"
        >
          <span class="font-semibold">{{
            t("serviceVersions.names.candidatesTitle", { name: raw(serviceKey), count }, count)
          }}</span>
          <span v-for="candidate in sortedCandidates" :key="candidate" class="font-mono">{{
            raw(candidate)
          }}</span>
          <span class="text-text-secondary">{{
            t("serviceVersions.names.candidatesNote", { name: raw(serviceKey) })
          }}</span>
          <OButton
            v-if="canReview"
            variant="ghost"
            size="sm-action"
            class="self-start"
            data-test="svcver-service-name-review-link"
            @click="openReview"
          >
            {{ t("serviceVersions.names.reviewNames") }}
          </OButton>
        </div></OPopover
      ></span
    ><span
      v-if="layout === 'stacked' && (detected || placeholder || $slots.meta)"
      :class="['text-text-secondary flex min-w-0 flex-wrap items-center gap-x-1', secondaryClass]"
      ><slot name="meta" /><span v-if="$slots.meta && (detected || placeholder)">{{
        raw("·")
      }}</span
      ><span
        v-if="detected"
        :class="['min-w-0', wrapDetected ? 'break-all' : 'truncate']"
        data-test="svcver-service-name-detected"
        ><i18n-t keypath="serviceVersions.names.detectedAs" tag="span" scope="global"
          ><template #name
            ><span class="font-mono">{{ raw(serviceKey) }}</span></template
          ></i18n-t
        ><OTooltip
          overflow-only
          :content="t('serviceVersions.names.detectedAs', { name: raw(serviceKey) })"
          data-test="svcver-service-name-detected-tip" /></span
      ><span v-else-if="placeholder" data-test="svcver-service-name-placeholder">{{
        t(placeholder)
      }}</span></span
    ></span
  >
</template>
<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { raw, useI18nTyped } from "@/types/i18n";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import ODimensionChip from "@/lib/core/Badge/ODimensionChip.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import ServiceNameHover from "./ServiceNameHover.vue";
import {
  placeholderLineKey,
  qualifiedName,
  showsDetectedAs,
  type DisplaySource,
} from "@/types/serviceRef";
const props = withDefaults(
  defineProps<{
    serviceKey: string;
    displayName?: string | null;
    displaySource?: DisplaySource | string | null;
    candidates?: string[] | null;
    qualifier?: string | null;
    layout?: "stacked" | "inline" | "chip";
    detectedFrom?: string | null;
    /** The chip's key segment, for hosts that name the service dimension their own way. */
    keyLabel?: string | null;
    canReview?: boolean;
    primaryClass?: string;
    secondaryClass?: string;
    /** Wraps a long detected name instead of cutting it, where the full key must read without hover. */
    wrapDetected?: boolean;
  }>(),
  {
    displayName: null,
    displaySource: null,
    candidates: null,
    qualifier: null,
    layout: "stacked",
    detectedFrom: null,
    keyLabel: null,
    canReview: false,
    primaryClass: "",
    secondaryClass: "text-2xs",
  },
);
const { t } = useI18nTyped();
const router = useRouter();
const store = useStore();
const candidatesOpen = ref(false);
const name = computed(() => props.displayName || props.serviceKey);
const primaryText = computed(() => qualifiedName(name.value, props.qualifier));
const hasDisplay = computed(() => !!(props.displaySource || props.displayName));
const mono = computed(
  () => props.displaySource === "detection" || props.displaySource === "detection_ambiguous",
);
const sortedCandidates = computed(() => [...(props.candidates ?? [])].sort());
const count = computed(() => sortedCandidates.value.length);
const ambiguous = computed(
  () => props.displaySource === "detection_ambiguous" && count.value > 0 && props.layout !== "chip",
);
const detected = computed(() => showsDetectedAs(props.serviceKey, props.displayName));
const placeholder = computed(() => (detected.value ? null : placeholderLineKey(props.serviceKey)));
const hoverProps = computed(() => ({
  serviceKey: props.serviceKey,
  name: name.value,
  qualifier: props.qualifier,
  displaySource: props.displaySource,
  detected: detected.value,
  detectedFrom: props.detectedFrom,
  placeholder: Boolean(placeholder.value),
  candidates: sortedCandidates.value,
}));
function openReview() {
  candidatesOpen.value = false;
  void router.push({
    name: "correlationSettings",
    params: { tab: "services" },
    query: {
      org_identifier: store.state.selectedOrganization?.identifier,
      view: "name-review",
    },
  });
}
</script>
