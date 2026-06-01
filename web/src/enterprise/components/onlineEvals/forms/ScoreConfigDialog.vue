<template>
  <div class="eval-dialog" role="dialog" aria-modal="true" @click.self="$emit('cancel')">
    <form class="eval-dialog__panel" @submit.prevent="save">
      <div class="eval-dialog__head">
        <div>
          <h2>{{ mode === "create" ? "New Score Config" : "Edit Score Config" }}</h2>
          <p>Score configs define score type, health thresholds, and categories.</p>
        </div>
        <OButton type="button" icon-left="close" variant="ghost" size="icon-sm" @click="$emit('cancel')" />
      </div>

      <div class="eval-dialog__content">
        <label>Name <input v-model.trim="form.name" required /></label>
        <label>Data type
          <select v-model="form.dataType" :disabled="mode === 'edit'">
            <option value="numeric">Numeric</option>
            <option value="categorical">Categorical</option>
            <option value="boolean">Boolean</option>
          </select>
        </label>
        <label class="eval-dialog__wide">Description <input v-model.trim="form.description" /></label>
        <label>Numeric range JSON <textarea v-model="form.numericRange" rows="4" /></label>
        <label>Categories JSON <textarea v-model="form.categories" rows="4" /></label>
        <label class="eval-dialog__wide">Healthy threshold JSON <textarea v-model="form.healthyThreshold" rows="4" /></label>
      </div>

      <div class="eval-dialog__foot">
        <OButton type="button" variant="outline" @click="$emit('cancel')">Cancel</OButton>
        <OButton type="submit" :loading="isSaving">{{ mode === "create" ? "Create" : "Save" }}</OButton>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import onlineEvalsService, { type ScoreConfig } from "@/services/online-evals.service";
import { dataTypeOf, entityId, valueOf } from "../utils/evalEntity";
import { parseOptionalJson, showError, stringifyJson } from "../utils/evalFormat";

const props = defineProps<{
  orgId: string;
  mode: "create" | "edit";
  row: ScoreConfig | null;
}>();

const emit = defineEmits<{
  (e: "saved"): void;
  (e: "cancel"): void;
}>();

const form = ref(initForm(props.row));
const isSaving = ref(false);

function initForm(row: ScoreConfig | null) {
  if (!row) {
    return {
      name: "",
      dataType: "numeric",
      description: "",
      numericRange: '{\n  "min": 0,\n  "max": 1\n}',
      categories: "",
      healthyThreshold: '{\n  "direction": "gte",\n  "value": 0.8\n}',
    };
  }
  return {
    name: row.name,
    dataType: dataTypeOf(row),
    description: row.description || "",
    numericRange: stringifyJson(valueOf(row, "numericRange", "numeric_range")),
    categories: stringifyJson(row.categories),
    healthyThreshold: stringifyJson(valueOf(row, "healthyThreshold", "healthy_threshold")),
  };
}

async function save() {
  if (!props.orgId) return;
  isSaving.value = true;
  try {
    const basePayload: Record<string, any> = {
      name: form.value.name,
      description: form.value.description || null,
      numericRange: parseOptionalJson(form.value.numericRange, "Numeric range"),
      categories: parseOptionalJson(form.value.categories, "Categories"),
      healthyThreshold: parseOptionalJson(form.value.healthyThreshold, "Healthy threshold"),
    };

    if (props.mode === "edit" && props.row) {
      await onlineEvalsService.scoreConfigs.update(props.orgId, entityId(props.row), basePayload);
    } else {
      await onlineEvalsService.scoreConfigs.create(props.orgId, {
        ...basePayload,
        dataType: form.value.dataType,
      });
    }
    toast({ variant: "success", message: "Score Config saved" });
    emit("saved");
  } catch (err: any) {
    showError(err, "Failed to save score config");
  } finally {
    isSaving.value = false;
  }
}
</script>
