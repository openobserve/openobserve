<template>
  <span
    class="text-text-heading inline-flex items-baseline gap-1.5 text-base font-semibold whitespace-nowrap"
    :data-test="testId"
    ><span>{{ service }}</span
    >{{ " "
    }}<template v-if="title"
      ><template v-if="title.baseline"
        ><span class="font-mono"
          >{{ title.baseline
          }}<span
            v-if="title.baselineImage"
            class="text-text-secondary font-normal"
            data-test="svcver-version-image"
            >{{ raw(" · ")
            }}{{ t("serviceVersions.image.short", { image: title.baselineImage }) }}</span
          ></span
        >{{ " " }}<span class="text-text-muted font-normal">→</span>{{ " " }}</template
      ><span class="font-mono"
        >{{ title.compared
        }}<span
          v-if="title.comparedImage"
          class="text-text-secondary font-normal"
          data-test="svcver-version-image"
          >{{ raw(" · ")
          }}{{ t("serviceVersions.image.short", { image: title.comparedImage }) }}</span
        ></span
      ><template v-if="title.suffix"
        >{{ " "
        }}<span class="text-text-secondary text-sm font-medium">{{ title.suffix }}</span></template
      ></template
    ></span
  >
</template>
<script setup lang="ts">
import { raw, useI18nTyped } from "@/types/i18n";
import type { CompareTitle } from "@/utils/serviceVersionsCopy";
const { t } = useI18nTyped();
withDefaults(defineProps<{ service: string; title?: CompareTitle; testId?: string }>(), {
  title: undefined,
  testId: "svcver-title",
});
</script>
