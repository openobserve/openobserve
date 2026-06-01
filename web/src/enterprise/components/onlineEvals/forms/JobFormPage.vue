<template>
  <form class="eval-form-page" @submit.prevent="save">
    <div class="eval-form-page__top">
      <button class="eval-form-page__back" type="button" @click="$emit('cancel')">
        <OIcon name="chevron-left" size="xs" />
        Back to Eval Jobs
      </button>
      <div class="eval-form-page__top-actions">
        <OButton type="button" icon-left="close" variant="ghost" size="icon-sm" @click="$emit('cancel')" />
      </div>
    </div>

    <div class="eval-form-page__head">
      <h1>{{ mode === "create" ? "Create" : "Edit" }} Online Eval Job</h1>
      <p>Pick the stream, scorers, mapping, and sampling behavior for this evaluation job.</p>
    </div>

    <div class="eval-form-page__body eval-form-page__body--split">
      <div class="eval-form-page__main">
        <div class="eval-stepper">
          <span class="is-active"><i>1</i> Target</span>
          <span><i>2</i> Scorers</span>
          <span><i>3</i> Mapping</span>
          <span><i>4</i> Sampling</span>
        </div>

        <section class="eval-form-section">
          <div class="eval-form-section__title"><span>01</span> Target</div>
          <label>Name <input v-model.trim="form.name" required placeholder="Production Faithfulness Monitor" /></label>
          <label>Input stream <input v-model.trim="form.stream" required placeholder="default" /></label>
          <label>Stream type <input v-model.trim="form.streamType" required placeholder="traces" /></label>
          <label class="eval-form-section__wide">Description <textarea v-model.trim="form.description" rows="3" /></label>
          <label>Sampling mode
            <select v-model="form.samplingMode">
              <option value="rate">Rate</option>
              <option value="all">All</option>
              <option value="count">Count</option>
            </select>
          </label>
          <label>Sampling value JSON <textarea v-model="form.samplingValue" rows="4" required /></label>
        </section>

        <section class="eval-form-section">
          <div class="eval-form-section__title"><span>02</span> Scorers and mapping</div>

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
      <OButton type="button" variant="outline" @click="$emit('cancel')">Cancel</OButton>
      <OButton type="submit" :loading="isSaving">{{ mode === "create" ? "Create" : "Save" }}</OButton>
    </div>
  </form>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
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
    showError(new Error("Select at least one scorer"), "Failed to save eval job");
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
      samplingValue: parseJson(form.value.samplingValue, "Sampling value"),
    };

    if (props.mode === "edit" && props.row) {
      await onlineEvalsService.jobs.update(props.orgId, props.row.id, payload);
    } else {
      await onlineEvalsService.jobs.create(props.orgId, payload);
    }
    toast({ variant: "success", message: "Eval Job saved" });
    emit("saved");
  } catch (err: any) {
    showError(err, "Failed to save eval job");
  } finally {
    isSaving.value = false;
  }
}
</script>
