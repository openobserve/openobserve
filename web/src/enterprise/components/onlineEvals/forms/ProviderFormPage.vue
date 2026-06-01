<template>
  <form class="eval-form-page" @submit.prevent="save">
    <div class="eval-form-page__top">
      <button class="eval-form-page__back" type="button" @click="$emit('cancel')">
        <OIcon name="chevron-left" size="xs" />
        Back to Providers
      </button>
      <div class="eval-form-page__top-actions">
        <OButton type="button" icon-left="close" variant="ghost" size="icon-sm" @click="$emit('cancel')" />
      </div>
    </div>

    <div class="eval-form-page__head">
      <h1>{{ mode === "create" ? "Create" : "Edit" }} LLM Provider</h1>
      <p>Configure the model endpoint used by LLM judge scorers.</p>
    </div>

    <div class="eval-form-page__body">
      <div class="eval-form-page__main">
        <section class="eval-form-section">
          <div class="eval-form-section__title"><span>01</span> Provider</div>
          <label>Name <input v-model.trim="form.name" required placeholder="Production OpenAI" /></label>
          <label>Provider type <input v-model.trim="form.providerType" required placeholder="openai" /></label>
          <label class="eval-form-section__wide">Endpoint <input v-model.trim="form.endpoint" placeholder="Optional custom endpoint" /></label>
          <label>Default model <input v-model.trim="form.defaultModel" required placeholder="gpt-4o-mini" /></label>
          <label>Available models <input v-model.trim="form.availableModels" placeholder="gpt-4o-mini, gpt-4.1" /></label>
          <label class="eval-form-check">
            <input v-model="form.isDefault" type="checkbox" />
            <span>Use as default provider</span>
          </label>
          <label class="eval-form-section__wide">Auth config JSON
            <textarea v-model="form.authConfig" rows="7" required />
          </label>
        </section>
      </div>
    </div>

    <div class="eval-form-page__foot">
      <OButton type="button" variant="outline" @click="$emit('cancel')">Cancel</OButton>
      <OButton type="submit" :loading="isSaving">{{ mode === "create" ? "Create" : "Save" }}</OButton>
    </div>
  </form>
</template>

<script setup lang="ts">
import { ref } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import onlineEvalsService, { type Provider } from "@/services/online-evals.service";
import { availableModelsOf, booleanOf, defaultModelOf, providerTypeOf } from "../utils/evalEntity";
import { parseJson, showError, splitCsv } from "../utils/evalFormat";

const props = defineProps<{
  orgId: string;
  mode: "create" | "edit";
  row: Provider | null;
}>();

const emit = defineEmits<{
  (e: "saved"): void;
  (e: "cancel"): void;
}>();

const form = ref(initForm(props.row));
const isSaving = ref(false);

function initForm(row: Provider | null) {
  if (!row) {
    return {
      name: "",
      providerType: "openai",
      endpoint: "",
      defaultModel: "",
      availableModels: "",
      authConfig: '{\n  "api_key": ""\n}',
      isDefault: false,
    };
  }
  return {
    name: row.name,
    providerType: providerTypeOf(row),
    endpoint: row.endpoint || "",
    defaultModel: defaultModelOf(row),
    availableModels: availableModelsOf(row).join(", "),
    authConfig: '{\n  "api_key": ""\n}',
    isDefault: booleanOf(row, "isDefault", "is_default"),
  };
}

async function save() {
  if (!props.orgId) return;
  isSaving.value = true;
  try {
    const payload = {
      name: form.value.name,
      providerType: form.value.providerType,
      endpoint: form.value.endpoint || null,
      defaultModel: form.value.defaultModel,
      availableModels: splitCsv(form.value.availableModels),
      authConfig: parseJson(form.value.authConfig, "Auth config"),
      isDefault: form.value.isDefault,
    };

    if (props.mode === "edit" && props.row) {
      await onlineEvalsService.providers.update(props.orgId, props.row.id, payload);
    } else {
      await onlineEvalsService.providers.create(props.orgId, payload);
    }
    toast({ variant: "success", message: "Provider saved" });
    emit("saved");
  } catch (err: any) {
    showError(err, "Failed to save provider");
  } finally {
    isSaving.value = false;
  }
}
</script>
