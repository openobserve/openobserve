<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<template>
  <div class="domain-org-mappings">
    <div class="mb-3 flex items-center justify-between gap-2">
      <div class="min-w-0">
        <div class="text-base font-bold">{{ t("settings.domainOrgMappings.title") }}</div>
        <div class="text-text-muted text-xs">
          {{ t("settings.domainOrgMappings.subtitle") }}
        </div>
      </div>
      <OButton
        data-test="settings-domain-org-mappings-add-btn"
        variant="outline"
        size="sm-action"
        icon-left="add"
        class="shrink-0"
        @click="openAdd"
      >
        {{ t("settings.domainOrgMappings.addMapping") }}
      </OButton>
    </div>

    <div v-if="mappings.length > 0" data-test="settings-domain-org-mappings-list">
      <div
        v-for="(mapping, index) in mappings"
        :key="index"
        :data-test="`settings-domain-org-mappings-item-${index}`"
        class="border-card-glass-border rounded-default mb-1 border p-2"
      >
        <div class="flex items-start justify-between">
          <div class="min-w-0 flex-1">
            <div class="flex min-w-0 items-center gap-1 text-sm">
              <span
                class="text-text-heading truncate font-bold"
                :data-test="`settings-domain-org-mappings-item-domain-${index}`"
                >{{ atSign }}{{ mapping.domain }}</span
              >
              <OIcon name="arrow-forward" size="xs" class="text-text-muted shrink-0" />
              <span
                class="text-text-body truncate"
                :data-test="`settings-domain-org-mappings-item-org-${index}`"
                >{{ mapping.org_id }}</span
              >
            </div>
            <div class="mt-1 flex flex-wrap items-center gap-1">
              <OTag type="userRole" :value="badgeRole(mapping.base_role)" />
              <OTag
                v-if="mapping.user_group"
                type="fieldTag"
                :data-test="`settings-domain-org-mappings-item-group-${index}`"
              >
                <span class="truncate text-xs">{{ mapping.user_group }}</span>
              </OTag>
            </div>
          </div>
          <div class="ms-2 flex shrink-0 items-center gap-1">
            <OButton
              :data-test="`settings-domain-org-mappings-edit-${index}`"
              variant="ghost"
              size="icon-sm"
              icon-left="edit"
              :title="t('common.edit')"
              @click="openEdit(index)"
            />
            <OButton
              :data-test="`settings-domain-org-mappings-delete-${index}`"
              variant="ghost-destructive"
              size="icon-sm"
              icon-left="delete"
              :title="t('common.delete')"
              @click="confirmRemove(index)"
            />
          </div>
        </div>
      </div>
    </div>
    <div
      v-else
      data-test="settings-domain-org-mappings-empty"
      class="text-text-muted py-4 text-center text-sm"
    >
      {{
        t("settings.domainOrgMappings.empty", {
          addLabel: t("settings.domainOrgMappings.addMapping"),
        })
      }}
    </div>

    <DomainOrgMappingDialog
      v-model:open="dialogOpen"
      :mapping="editingMapping"
      :taken-domains="takenDomains"
      @save="onSaveMapping"
    />

    <ODialog
      data-test="settings-domain-org-mappings-remove-dialog"
      v-model:open="confirmRemoveOpen"
      size="sm"
      :title="t('common.confirm')"
      :secondary-button-label="t('confirmDialog.cancel')"
      :primary-button-label="t('confirmDialog.ok')"
      primary-button-variant="destructive"
      @click:secondary="confirmRemoveOpen = false"
      @click:primary="doRemove"
    >
      <p v-if="pendingRemoveIndex !== null">
        {{
          t("settings.domainOrgMappings.confirmRemove", {
            domain: mappings[pendingRemoveIndex]?.domain,
          })
        }}
      </p>
    </ODialog>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import DomainOrgMappingDialog from "./DomainOrgMappingDialog.vue";
import type { DomainOrgMapping } from "./DomainOrgMappings.schema";

const props = withDefaults(defineProps<{ modelValue?: DomainOrgMapping[] }>(), {
  modelValue: () => [],
});

const emit = defineEmits<{
  (_e: "update:modelValue", _value: DomainOrgMapping[]): void;
  (_e: "change"): void;
}>();

const { t } = useI18nTyped();

const atSign = raw("@");

const mappings = computed(() => props.modelValue);

// The badge registry keys the User role as `user`; `allowed_user` is its OpenFGA relation name.
const badgeRole = (role: string) => (role === "allowed_user" ? "user" : role);

const dialogOpen = ref(false);
const editingIndex = ref<number | null>(null);
const editingMapping = ref<DomainOrgMapping | null>(null);

// The edited row's own domain must stay available to it, so it is excluded.
const takenDomains = computed(() =>
  mappings.value
    .filter((_, index) => index !== editingIndex.value)
    .map((mapping) => mapping.domain.toLowerCase()),
);

const confirmRemoveOpen = ref(false);
const pendingRemoveIndex = ref<number | null>(null);

function openAdd() {
  editingIndex.value = null;
  editingMapping.value = null;
  dialogOpen.value = true;
}

function openEdit(index: number) {
  editingIndex.value = index;
  editingMapping.value = { ...mappings.value[index] };
  dialogOpen.value = true;
}

function commit(next: DomainOrgMapping[]) {
  emit("update:modelValue", next);
  emit("change");
}

function onSaveMapping(mapping: DomainOrgMapping) {
  const next = [...mappings.value];
  if (editingIndex.value !== null) {
    next[editingIndex.value] = mapping;
  } else {
    next.push(mapping);
  }
  commit(next);
  editingIndex.value = null;
  editingMapping.value = null;
}

function confirmRemove(index: number) {
  pendingRemoveIndex.value = index;
  confirmRemoveOpen.value = true;
}

function doRemove() {
  const index = pendingRemoveIndex.value;
  if (index === null) return;
  commit(mappings.value.filter((_, i) => i !== index));
  pendingRemoveIndex.value = null;
  confirmRemoveOpen.value = false;
}
</script>
