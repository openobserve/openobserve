<template>
  <span v-if="truncate" class="inline-flex max-w-full min-w-0 whitespace-nowrap"
    ><OTruncatedText :tooltip="cutTip ? undefined : false">{{ version }}</OTruncatedText
    ><span
      v-if="short"
      class="text-text-secondary shrink-0 whitespace-pre"
      data-test="svcver-version-image"
      >{{ raw(" · ") }}{{ t("serviceVersions.image.short", { image: short }) }}</span
    ></span
  >
  <span v-else class="whitespace-nowrap"
    >{{ version
    }}<span v-if="short" class="text-text-secondary" data-test="svcver-version-image"
      >{{ raw(" · ") }}{{ t("serviceVersions.image.short", { image: short }) }}</span
    ></span
  >
</template>
<script setup lang="ts">
import { computed } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { imageShort } from "@/utils/serviceVersionsCopy";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
const props = defineProps<{
  version: string;
  image?: string | null;
  versionImages?: number;
  /** Truncates the version text alone, so the image that tells two builds apart is never cut. */
  truncate?: boolean;
  /** Give the cut text its own hover, for a cell with no other hover naming the version. */
  cutTip?: boolean;
}>();
const { t } = useI18nTyped();
const short = computed(() => imageShort(props.image, props.versionImages));
</script>
