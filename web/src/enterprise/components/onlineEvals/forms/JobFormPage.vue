<template>
  <form class="eval-form-page" @submit.prevent="save">
    <div class="eval-form-page__top">
      <button class="eval-form-page__back" type="button" @click="$emit('cancel')">
        <OIcon name="chevron-left" size="xs" />
        {{ t("onlineEvals.job.backTo") }}
      </button>
      <div class="eval-form-page__top-actions">
        <OButton type="button" icon-left="close" variant="ghost" size="icon-sm" @click="$emit('cancel')" />
      </div>
    </div>

    <div class="eval-form-page__head">
      <h1>{{ mode === "create" ? t("onlineEvals.job.createTitle") : t("onlineEvals.job.editTitle") }}</h1>
      <p>{{ t("onlineEvals.job.subtitle") }}</p>
    </div>

    <div class="eval-form-page__body eval-form-page__body--split">
      <div class="eval-form-page__main">
        <div class="eval-stepper">
          <span class="is-active"><i>1</i> {{ t("onlineEvals.job.stepper.target") }}</span>
          <span><i>2</i> {{ t("onlineEvals.job.stepper.scorers") }}</span>
          <span><i>3</i> {{ t("onlineEvals.job.stepper.mapping") }}</span>
          <span><i>4</i> {{ t("onlineEvals.job.stepper.sampling") }}</span>
        </div>

        <section class="eval-form-section">
          <div class="eval-form-section__title"><span>01</span> {{ t("onlineEvals.job.targetSection") }}</div>
          <label>
            {{ t("onlineEvals.job.nameLabel") }}
            <input v-model.trim="form.name" required :placeholder="t('onlineEvals.job.namePlaceholder')" />
          </label>
          <label>
            {{ t("onlineEvals.job.streamLabel") }}
            <input v-model.trim="form.stream" required :placeholder="t('onlineEvals.job.streamPlaceholder')" />
          </label>
          <label>
            {{ t("onlineEvals.job.streamTypeLabel") }}
            <input v-model.trim="form.streamType" required :placeholder="t('onlineEvals.job.streamTypePlaceholder')" />
          </label>
          <label class="eval-form-section__wide">
            {{ t("onlineEvals.job.descriptionLabel") }}
            <textarea v-model.trim="form.description" rows="3" />
          </label>
          <label>
            {{ t("onlineEvals.job.samplingModeLabel") }}
            <select v-model="form.samplingMode">
              <option value="rate">{{ t("onlineEvals.job.samplingModes.rate") }}</option>
              <option value="all">{{ t("onlineEvals.job.samplingModes.all") }}</option>
              <option value="count">{{ t("onlineEvals.job.samplingModes.count") }}</option>
            </select>
          </label>
          <label>
            {{ t("onlineEvals.job.samplingValueLabel") }}
            <textarea v-model="form.samplingValue" rows="4" required />
          </label>
        </section>

        <section class="eval-form-section">
          <div class="eval-form-section__title"><span>02</span> {{ t("onlineEvals.job.scorersSection") }}</div>

          <JobScorerPicker
            :scorers="scorers"
            :selected-ids="form.scorerIds"
            @toggle="toggleScorer"
          />

          <JobFilterBuilder
            :group="filterGroup"
            @update:group="filterGroup = $event"
          />

          <JobInputMapping
            :selected-scorers="selectedScorers"
            :input-mappings="inputMappings"
            @update:input-mappings="inputMappings = $event"
          />
        </section>
      </div>

      <JobPreviewPanel :name="form.name" :stream-type="form.streamType" :mode="mode" />
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
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import onlineEvalsService, {
  type EvalJob,
  type Scorer,
} from "@/services/online-evals.service";
import {
  entityId,
  samplingModeOf,
  scorerRefId,
  scorerRefVersion,
  streamTypeOf,
  valueOf,
} from "../utils/evalEntity";
import { parseJson, showError, stringifyJson } from "../utils/evalFormat";
import {
  buildJobFilterConditionPayload,
  createEmptyJobFilterGroup,
  normalizeJobFilterCondition,
} from "../utils/jobFilter";
import {
  buildJobInputMappingPayload,
  normalizeJobInputMappings,
  syncJobInputMappings,
} from "../utils/jobMappings";
import JobScorerPicker from "./job/JobScorerPicker.vue";
import JobFilterBuilder from "./job/JobFilterBuilder.vue";
import JobInputMapping from "./job/JobInputMapping.vue";
import JobPreviewPanel from "./job/JobPreviewPanel.vue";

const props = defineProps<{
  orgId: string;
  mode: "create" | "edit";
  row: EvalJob | null;
  scorers: Scorer[];
}>();

const emit = defineEmits<{
  (e: "saved"): void;
  (e: "cancel"): void;
}>();

const { t } = useI18n();
const form = ref(initForm(props.row));
const filterGroup = ref(initFilterGroup(props.row));
const inputMappings = ref(initInputMappings(props.row));
const scorerVersions = ref(initScorerVersions(props.row));
const isSaving = ref(false);

const selectedScorers = computed(() =>
  form.value.scorerIds
    .map((id) => props.scorers.find((scorer) => entityId(scorer) === id))
    .filter((scorer): scorer is Scorer => Boolean(scorer)),
);

watch(() => form.value.scorerIds.slice(), () => syncMappings());
watch(() => props.scorers, () => syncMappings());

function initForm(row: EvalJob | null) {
  if (!row) {
    return {
      name: "",
      description: "",
      stream: "",
      streamType: "traces",
      scorerIds: [] as string[],
      samplingMode: "rate",
      samplingValue: "0.1",
    };
  }
  return {
    name: row.name,
    description: row.description || "",
    stream: row.stream,
    streamType: streamTypeOf(row),
    scorerIds: (row.scorers || []).map(scorerRefId),
    samplingMode: samplingModeOf(row),
    samplingValue: stringifyJson(valueOf(row, "samplingValue", "sampling_value")),
  };
}

function initFilterGroup(row: EvalJob | null) {
  if (!row) return createEmptyJobFilterGroup();
  return normalizeJobFilterCondition(valueOf(row, "filterCondition", "filter_condition"));
}

function initInputMappings(row: EvalJob | null) {
  if (!row) return {} as Record<string, Record<string, string>>;
  const selectedScorerIds = (row.scorers || []).map(scorerRefId);
  return normalizeJobInputMappings(
    valueOf(row, "inputMapping", "input_mapping"),
    selectedScorerIds,
  );
}

function initScorerVersions(row: EvalJob | null) {
  if (!row) return {} as Record<string, number | null>;
  return Object.fromEntries(
    (row.scorers || []).map((scorer) => [scorerRefId(scorer), scorerRefVersion(scorer)]),
  );
}

function toggleScorer(scorerId: string) {
  const selected = new Set(form.value.scorerIds);
  if (selected.has(scorerId)) selected.delete(scorerId);
  else selected.add(scorerId);

  form.value.scorerIds = [...selected];
  if (!(scorerId in scorerVersions.value)) scorerVersions.value[scorerId] = null;
  syncMappings();
}

function syncMappings() {
  const { nextMappings, nextVersions } = syncJobInputMappings(
    form.value.scorerIds,
    props.scorers,
    inputMappings.value,
    scorerVersions.value,
  );
  inputMappings.value = nextMappings;
  scorerVersions.value = nextVersions;
}

async function save() {
  if (!props.orgId) return;
  if (!form.value.scorerIds.length) {
    showError(new Error(t("onlineEvals.job.selectAtLeastOne")), t("onlineEvals.job.saveError"));
    return;
  }

  isSaving.value = true;
  try {
    const payload = {
      name: form.value.name,
      description: form.value.description || null,
      stream: form.value.stream,
      streamType: form.value.streamType,
      filterCondition: buildJobFilterConditionPayload(filterGroup.value),
      scorers: form.value.scorerIds.map((id) => ({ id, version: scorerVersions.value[id] ?? null })),
      inputMapping: buildJobInputMappingPayload(form.value.scorerIds, inputMappings.value),
      samplingMode: form.value.samplingMode as any,
      samplingValue: parseJson(form.value.samplingValue, t("onlineEvals.job.samplingValueLabel")),
    };

    if (props.mode === "edit" && props.row) {
      await onlineEvalsService.jobs.update(props.orgId, props.row.id, payload);
    } else {
      await onlineEvalsService.jobs.create(props.orgId, payload);
    }
    toast({
      variant: "success",
      message: t("onlineEvals.saved", { label: t("onlineEvals.singular.jobs") }),
    });
    emit("saved");
  } catch (err: any) {
    showError(err, t("onlineEvals.job.saveError"));
  } finally {
    isSaving.value = false;
  }
}
</script>
