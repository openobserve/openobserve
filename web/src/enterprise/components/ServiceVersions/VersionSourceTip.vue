<template>
  <OTooltip v-if="fromImage || disabledReason"
    ><template #content
      ><span class="flex flex-col gap-0.5" data-test="svcver-version-source-tip"
        ><span
          ><b>{{ label }}</b
          ><template v-if="fromImage"
            >{{ raw(" · ") }}{{ t("serviceVersions.versionSource.image") }}</template
          ></span
        ><span v-if="fromImage && imageRef" class="font-mono opacity-70">{{ imageRef }}</span
        ><span v-if="fromImage" class="opacity-70">{{
          t("serviceVersions.versionSource.imageNote")
        }}</span
        ><span
          v-if="disabledReason"
          class="opacity-70"
          data-test="svcver-compare-disabled-reason"
          >{{ disabledReason }}</span
        ></span
      ></template
    ></OTooltip
  >
</template>
<script setup lang="ts">
import { computed } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { isImageSource } from "./versionImages";
const props = defineProps<{
  label: string;
  source?: string | null;
  imageRef?: string | null;
  disabledReason?: string;
}>();
const { t } = useI18nTyped();
const fromImage = computed(() => isImageSource(props.source));
</script>
