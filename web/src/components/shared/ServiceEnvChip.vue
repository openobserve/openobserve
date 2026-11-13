<template>
  <OTooltip v-if="readonlyChip"
    ><template #content
      ><span class="flex flex-col gap-0.5" data-test="svcver-env-tooltip"
        ><span
          ><b>{{ shown }}</b
          ><template v-if="pinnedShown">{{ raw(" · ") }}{{ sentence }}</template></span
        ><span v-if="alsoSeen" class="opacity-70" data-test="svcver-env-also">{{
          alsoSeen
        }}</span></span
      ></template
    ><span class="inline-flex max-w-full min-w-0" data-test="svcver-env-chip"
      ><ODimensionChip
        dim-key="env"
        :key-label="t('serviceVersions.compare.envChip')"
        :value="shown"
        :variant="noEnv ? 'default-soft' : 'success-soft'"
        :muted="noEnv"
        :data-test="noEnv ? 'svcver-env-none' : undefined"
        :value-tooltip="false"
        :qualifier="qualifier"
        qualifier-data-test="svcver-env-inferred"
        :hide-key="hideKey" /></span
  ></OTooltip>
  <ChangeEnvPopover v-else :identity="identity" :service="service" :side-offset="offset"
    ><button
      type="button"
      class="rounded-default inline-flex max-w-full min-w-0 cursor-pointer"
      :aria-label="t('serviceVersions.envEdit.title')"
      data-test="svcver-env-chip"
      @click.stop
      @pointerenter="prepare"
      @focus="prepare"
    >
      <ODimensionChip
        dim-key="env"
        :key-label="t('serviceVersions.compare.envChip')"
        :value="shown"
        :variant="noEnv ? 'default-soft' : 'success-soft'"
        :muted="noEnv"
        :data-test="noEnv ? 'svcver-env-none' : undefined"
        :value-tooltip="false"
        :qualifier="qualifier"
        qualifier-data-test="svcver-env-inferred"
        :hide-key="hideKey"
      />
      <OTooltip side="top"
        ><template #content
          ><span class="flex flex-col gap-0.5" data-test="svcver-env-tooltip"
            ><span
              ><b>{{ shown }}</b
              ><template v-if="pinnedShown">{{ raw(" · ") }}{{ sentence }}</template
              ><span class="opacity-70"
                >{{ raw(" · ")
                }}{{
                  noEnv
                    ? t("serviceVersions.envEdit.clickToSet")
                    : t("serviceVersions.envEdit.clickToChange")
                }}</span
              ></span
            ><span v-if="alsoSeen" class="opacity-70" data-test="svcver-env-also">{{
              alsoSeen
            }}</span
            ><span v-if="detected" class="opacity-70">{{ detected }}</span
            ><span class="opacity-70">{{ whereLine }}</span></span
          ></template
        ></OTooltip
      >
    </button></ChangeEnvPopover
  >
</template>
<script setup lang="ts">
import { computed, ref } from "vue";
import { useStore } from "vuex";
import { useQuery } from "@tanstack/vue-query";
import { raw, useI18nTyped } from "@/types/i18n";
import type { Environment } from "@/services/service_versions";
import { identityQuery } from "@/services/service_versions.queries";
import { useLicenseLock } from "@/composables/useFeatureLock";
import { envListText, envSet, isInferredSource } from "@/services/service_versions.envs";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import ODimensionChip from "@/lib/core/Badge/ODimensionChip.vue";
import ChangeEnvPopover, {
  belowRowOffset,
  CHIP_OVERRIDES_PARAMS,
  envDetectedLine,
  envSourceSentence,
  envWhereLine,
} from "@/components/shared/ChangeEnvPopover.vue";
const props = defineProps<{
  identity: Environment;
  service?: string;
  readonly?: boolean;
  shownEnv?: string;
  hideInferred?: boolean;
  hideKey?: boolean;
}>();
const { t, locale } = useI18nTyped();
const store = useStore();
const correlationLock = useLicenseLock("correlation");
const readonlyChip = computed(() => props.readonly || correlationLock.locked.value);
const hovered = ref(false);
const offset = ref<number>();
// Measured before the click opens the popover, so it never moves once open.
function prepare(event: Event) {
  hovered.value = true;
  offset.value = belowRowOffset(event.currentTarget as Element | null);
}
// Who set an override lives only on its row, so it is read once the chip is hovered.
const overrides = useQuery(
  computed(() => ({
    ...identityQuery(
      String(store.state.selectedOrganization?.identifier || ""),
      String(store.state.userInfo?.email || ""),
      "identityOverrides",
      CHIP_OVERRIDES_PARAMS,
    ),
    enabled: hovered.value && !readonlyChip.value && Boolean(props.identity.override_key),
  })),
);
const sentence = computed(() =>
  envSourceSentence(
    props.identity,
    t,
    String(store.state.timezone || "UTC"),
    overrides.data.value?.overrides.find((row) => row.rule_key === props.identity.override_key),
  ),
);
const detected = computed(() => envDetectedLine(props.identity, t));
// A scope with no reported env keeps its stored text, which the chip never prints.
const noEnv = computed(
  () =>
    Boolean(props.identity.no_env) && (!props.shownEnv || props.shownEnv === props.identity.env),
);
const shown = computed(() =>
  noEnv.value ? t("serviceVersions.env.noEnv") : props.shownEnv || props.identity.env,
);
// The source sentence explains how the pinned env was derived, so it only describes that env.
const pinnedShown = computed(() => noEnv.value || shown.value === props.identity.env);
const qualifier = computed(() =>
  !props.hideInferred && pinnedShown.value && isInferredSource(props.identity.env_source)
    ? t("serviceVersions.env.inferred")
    : undefined,
);
// The first tooltip line names the shown env, so the list holds every other env, the pinned one included.
const alsoSeen = computed(() => {
  const hidden = noEnv.value ? props.identity.env : shown.value;
  const envs = envSet(props.identity).filter((env) => env && env !== hidden);
  if (!envs.length) return "";
  const list = envListText(envs, String(locale.value), (count) =>
    t("serviceVersions.env.moreEnvs", { count }),
  );
  return t("serviceVersions.env.alsoSeenIn", { envs: list });
});
const whereLine = computed(() => envWhereLine(props.identity, t));
</script>
