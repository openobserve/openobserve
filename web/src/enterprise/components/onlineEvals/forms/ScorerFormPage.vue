<template>
  <form class="eval-form-page" @submit.prevent="save">
    <div class="eval-form-page__top">
      <button class="eval-form-page__back" type="button" @click="$emit('cancel')">
        <OIcon name="chevron-left" size="xs" />
        {{ t("onlineEvals.scorer.backTo") }}
      </button>
      <div class="eval-form-page__top-actions">
        <span class="eval-form-page__badge">
          {{ form.scorerType === "remote" ? t("onlineEvals.scorer.badgeRemote") : t("onlineEvals.scorer.badgeLlm") }}
        </span>
        <OButton type="button" icon-left="close" variant="ghost" size="icon-sm" @click="$emit('cancel')" />
      </div>
    </div>

    <div class="eval-form-page__head">
      <h1>{{ titleText }}</h1>
      <p>
        {{
          form.scorerType === "remote"
            ? t("onlineEvals.scorer.subtitleRemote")
            : t("onlineEvals.scorer.subtitleLlm")
        }}
      </p>
    </div>

    <div class="eval-form-page__body eval-form-page__body--split">
      <div class="eval-form-page__main">
        <section class="eval-form-section">
          <div class="eval-form-section__title"><span>01</span> {{ t("onlineEvals.scorer.identitySection") }}</div>
          <label>
            {{ t("onlineEvals.scorer.nameLabel") }}
            <input v-model.trim="form.name" required :placeholder="t('onlineEvals.scorer.namePlaceholder')" />
          </label>
          <label>
            {{ t("onlineEvals.scorer.producesScoreConfigLabel") }}
            <select v-model="form.producesScoreConfigId" @change="handleScoreConfigSelection">
              <option value="">{{ t("onlineEvals.scorer.producesScoreConfigNone") }}</option>
              <option v-for="config in scoreConfigs" :key="entityId(config)" :value="entityId(config)">
                {{ config.name }}
              </option>
            </select>
          </label>
          <label>
            {{ t("onlineEvals.scorer.scoreConfigVersionLabel") }}
            <select
              v-model="form.producesScoreConfigVersion"
              :disabled="!form.producesScoreConfigId"
              @change="form.pinScoreConfigVersion = true"
            >
              <option
                v-for="(configVersion, index) in selectedScoreConfigVersions"
                :key="`${entityId(configVersion)}-${configVersion.version}`"
                :value="String(configVersion.version)"
              >
                v{{ configVersion.version }}{{ index === 0 ? t("onlineEvals.scorer.latestSuffix") : "" }}
              </option>
            </select>
          </label>
          <label class="eval-form-check">
            <input
              v-model="form.pinScoreConfigVersion"
              type="checkbox"
              :disabled="!form.producesScoreConfigId || !form.producesScoreConfigVersion"
            />
            <span>{{ t("onlineEvals.scorer.pinVersion") }}</span>
          </label>
          <label class="eval-form-section__wide">
            {{ t("onlineEvals.scorer.descriptionLabel") }}
            <textarea v-model.trim="form.description" rows="3" />
          </label>
        </section>

        <section class="eval-form-section">
          <div class="eval-form-section__title">
            <span>02</span>
            {{ form.scorerType === "remote" ? t("onlineEvals.scorer.endpointSection") : t("onlineEvals.scorer.judgeSection") }}
          </div>
          <template v-if="form.scorerType === 'llm_judge'">
            <label>
              {{ t("onlineEvals.scorer.providerLabel") }}
              <select v-model="form.providerId" required>
                <option value="">{{ t("onlineEvals.scorer.providerPlaceholder") }}</option>
                <option v-for="provider in providers" :key="provider.id" :value="provider.id">
                  {{ provider.name }}
                </option>
              </select>
            </label>
            <label>
              {{ t("onlineEvals.scorer.modelLabel") }}
              <input v-model.trim="form.model" :placeholder="t('onlineEvals.scorer.modelPlaceholder')" />
            </label>
            <label class="eval-form-section__wide">
              {{ t("onlineEvals.scorer.promptLabel") }}
              <textarea v-model="form.template" rows="10" required />
            </label>
            <label class="eval-form-section__wide">
              {{ t("onlineEvals.scorer.outputSchemaLabel") }}
              <textarea v-model="form.outputSchema" rows="7" />
            </label>
          </template>
          <template v-else>
            <label class="eval-form-section__wide">
              {{ t("onlineEvals.scorer.remoteEndpointLabel") }}
              <input v-model.trim="form.remoteEndpoint" required :placeholder="t('onlineEvals.scorer.remoteEndpointPlaceholder')" />
            </label>
            <label class="eval-form-section__wide">
              {{ t("onlineEvals.scorer.requestBodyLabel") }}
              <textarea v-model="form.template" rows="10" required />
            </label>
          </template>
        </section>
      </div>

      <ScorerTestPanel
        :variables="scorerTestVariables"
        :inputs="scorerTestInputs"
        :scenario="scorerTestScenario"
        :state="scorerTestState"
        @run="runScorerTest"
        @update:scenario="scorerTestScenario = $event"
        @update:inputs="scorerTestInputs = $event"
      />
    </div>

    <div class="eval-form-page__foot">
      <OButton type="button" variant="outline" @click="$emit('cancel')">{{ t("onlineEvals.buttons.cancel") }}</OButton>
      <OButton type="submit" :loading="isSaving">
        {{ mode === "create" ? t("onlineEvals.buttons.create") : t("onlineEvals.buttons.save") }}
      </OButton>
    </div>
  </form>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, toRef } from "vue";
import { useI18n } from "vue-i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import onlineEvalsService, {
  type Provider,
  type ScoreConfig,
  type Scorer,
  type ScorerType,
} from "@/services/online-evals.service";
import { entityId, valueOf } from "../utils/evalEntity";
import {
  defaultOutputSchema,
  parseOptionalJson,
  showError,
  stringifyJson,
} from "../utils/evalFormat";
import { useScorerTest } from "../composables/useScorerTest";
import ScorerTestPanel from "./scorer/ScorerTestPanel.vue";

const props = defineProps<{
  orgId: string;
  mode: "create" | "edit";
  row: Scorer | null;
  scorerType: ScorerType;
  providers: Provider[];
  scoreConfigs: ScoreConfig[];
  scoreConfigVersions: Record<string, ScoreConfig[]>;
}>();

const emit = defineEmits<{
  (e: "saved"): void;
  (e: "cancel"): void;
  (e: "request-versions", scoreConfigId: string): void;
}>();

const { t } = useI18n();
const form = ref(initForm(props.row, props.scorerType));
const isSaving = ref(false);

const {
  scorerTestInputs,
  scorerTestScenario,
  scorerTestState,
  scorerTestVariables,
  runScorerTest,
} = useScorerTest(toRef(() => form.value.template));

const selectedScoreConfigVersions = computed(() => {
  const selectedId = form.value.producesScoreConfigId;
  if (!selectedId) return [];
  const cachedVersions = props.scoreConfigVersions[selectedId];
  const fallback = props.scoreConfigs.filter((config) => entityId(config) === selectedId);
  return [...(cachedVersions || fallback)].sort(
    (a, b) => Number(b.version || 0) - Number(a.version || 0),
  );
});

const titleText = computed(() => {
  const isRemote = form.value.scorerType === "remote";
  if (props.mode === "create") {
    return isRemote
      ? t("onlineEvals.scorer.createTitleRemote")
      : t("onlineEvals.scorer.createTitleLlm");
  }
  return isRemote
    ? t("onlineEvals.scorer.editTitleRemote")
    : t("onlineEvals.scorer.editTitleLlm");
});

onMounted(() => {
  if (props.mode === "edit" && form.value.producesScoreConfigId) {
    void prepareSelectedScoreConfigVersion(true);
  }
});

function initForm(row: Scorer | null, scorerType: ScorerType) {
  if (!row) {
    return {
      name: "",
      scorerType,
      description: "",
      producesScoreConfigId: "",
      producesScoreConfigVersion: "",
      pinScoreConfigVersion: false,
      providerId: "",
      model: "",
      remoteEndpoint: "",
      template: "Evaluate {{input}} and {{output}}.",
      outputSchema: stringifyJson(defaultOutputSchema()),
    };
  }
  const rowScorerType = (valueOf(row, "scorerType", "scorer_type") || "llm_judge") as ScorerType;
  return {
    name: row.name,
    scorerType: rowScorerType,
    description: row.description || "",
    producesScoreConfigId: String(valueOf(row, "producesScoreConfigId", "produces_score_config_id") || ""),
    producesScoreConfigVersion: String(
      valueOf(row, "producesScoreConfigVersion", "produces_score_config_version") || "",
    ),
    pinScoreConfigVersion: Boolean(
      valueOf(row, "producesScoreConfigVersion", "produces_score_config_version"),
    ),
    providerId: String(row.params?.provider_id || ""),
    model: String(row.params?.model || ""),
    remoteEndpoint: String(row.params?.endpoint || ""),
    template: row.template || "",
    outputSchema: stringifyJson(valueOf(row, "outputSchema", "output_schema") || defaultOutputSchema()),
  };
}

async function handleScoreConfigSelection() {
  form.value.pinScoreConfigVersion = false;
  form.value.producesScoreConfigVersion = "";
  await prepareSelectedScoreConfigVersion(false);
}

async function prepareSelectedScoreConfigVersion(keepSelectedVersion: boolean) {
  const selectedId = form.value.producesScoreConfigId;
  if (!selectedId) return;

  emit("request-versions", selectedId);
  await Promise.resolve();

  const latestVersion = selectedScoreConfigVersions.value[0]?.version;
  if (!latestVersion) return;

  const currentVersion = form.value.producesScoreConfigVersion;
  const selectedVersionExists = selectedScoreConfigVersions.value.some(
    (config) => String(config.version) === currentVersion,
  );

  if (!keepSelectedVersion || !currentVersion || !selectedVersionExists) {
    form.value.producesScoreConfigVersion = String(latestVersion);
  }
}

async function save() {
  if (!props.orgId) return;
  isSaving.value = true;
  try {
    const isLlmJudge = form.value.scorerType === "llm_judge";
    const scoreConfigRef = {
      producesScoreConfigId: form.value.producesScoreConfigId || null,
      producesScoreConfigVersion:
        form.value.pinScoreConfigVersion && form.value.producesScoreConfigVersion
          ? Number(form.value.producesScoreConfigVersion)
          : null,
    };
    const scorerPayload: Record<string, any> = isLlmJudge
      ? {
          type: "llm_judge",
          ...scoreConfigRef,
          template: form.value.template,
          outputSchema:
            parseOptionalJson(form.value.outputSchema, t("onlineEvals.scorer.outputSchemaLabel")) ||
            defaultOutputSchema(),
          params: {
            provider_id: form.value.providerId,
            ...(form.value.model ? { model: form.value.model } : {}),
            include_reasoning: true,
          },
        }
      : {
          type: "remote",
          ...scoreConfigRef,
          template: form.value.template,
          params: {
            endpoint: form.value.remoteEndpoint,
            http_method: "POST",
            timeout_ms: 30000,
          },
        };

    if (props.mode === "edit" && props.row) {
      await onlineEvalsService.scorers.update(props.orgId, entityId(props.row), {
        name: form.value.name,
        description: form.value.description || null,
        scorer: scorerPayload,
      });
    } else {
      await onlineEvalsService.scorers.create(props.orgId, {
        name: form.value.name,
        description: form.value.description || null,
        scorer: scorerPayload,
      });
    }
    toast({
      variant: "success",
      message: t("onlineEvals.saved", { label: t("onlineEvals.singular.scorers") }),
    });
    emit("saved");
  } catch (err: any) {
    showError(err, t("onlineEvals.scorer.saveError"));
  } finally {
    isSaving.value = false;
  }
}
</script>
