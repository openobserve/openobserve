<template>
  <div class="cross-link-manager">
    <!-- Header -->
    <div class="tw:flex tw:justify-between tw:items-center q-mb-md">
      <div>
        <div class="text-body1 text-bold">{{ title }}</div>
        <div v-if="subtitle" class="text-caption" style="color: var(--o2-text-muted)">
          {{ subtitle }}
        </div>
      </div>
      <OButton
        v-if="!readonly"
        variant="outline"
        size="sm-action"
        icon-left="add"
        @click="onAddClick"
        data-test="add-cross-link-btn"
      >
        {{ t('crossLinks.addCrossLink') }}
      </OButton>
    </div>

    <!-- Links List -->
    <div v-if="links.length > 0" class="cross-link-list" data-test="cross-link-list">
      <div
        v-for="(link, idx) in links"
        :key="link.name"
        class="cross-link-item el-border tw:rounded-md q-mb-xs q-pa-sm"
        :data-test="`cross-link-item-${idx}`"
      >
        <div class="tw:flex tw:justify-between tw:items-start">
          <div class="tw:flex-1 tw:min-w-0">
            <!-- Name -->
            <div class="text-subtitle2 text-bold tw:truncate" :title="link.name" style="color: var(--o2-text-primary)">
              {{ link.name }}
              <q-badge
                v-if="link._source"
                :color="link._source === 'stream' ? 'primary' : 'grey'"
                :label="link._source === 'stream' ? 'Stream' : 'Global'"
                class="q-ml-xs"
              />
            </div>
            <!-- URL -->
            <div class="text-caption tw:truncate q-mt-xs" :title="link.url" style="color: var(--o2-text-muted)">
              {{ link.url }}
            </div>
            <!-- Fields -->
            <div v-if="link.fields?.length" class="tw:flex tw:flex-wrap tw:gap-1 q-mt-xs">
              <q-chip
                v-for="(field, fIdx) in link.fields"
                :key="fIdx"
                dense
                class="tw:max-w-[200px]"
              >
                <span class="tw:truncate text-caption" :title="field.name">{{ field.name }}</span>
              </q-chip>
            </div>
          </div>
          <!-- Actions -->
          <div v-if="!readonly" class="tw:flex tw:items-center tw:gap-1 tw:ml-2 tw:shrink-0">
            <OButton
              variant="ghost"
              size="icon-sm"
              icon-left="edit"
              @click="editLink(link)"
              :data-test="`cross-link-edit-${idx}`"
            />
            <OButton
              variant="ghost-destructive"
              size="icon-sm"
              icon-left="delete"
              @click="removeLink(link)"
              :data-test="`cross-link-delete-${idx}`"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- Empty State -->
    <div
      v-else
      class="tw:text-center q-py-lg text-body2"
      style="color: var(--o2-text-muted)"
      data-test="cross-link-empty"
    >
      {{ t("crossLinks.emptyState", { addLabel: t("crossLinks.addCrossLink") }) }}
    </div>

    <!-- Add/Edit Dialog -->
    <CrossLinkDialog
      v-model="showAddDialog"
      :link="editingLink"
      :availableFields="availableFields"
      @save="onSaveLink"
      @cancel="showAddDialog = false"
    />
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, type PropType } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import CrossLinkDialog from "./CrossLinkDialog.vue";
import OButton from '@/lib/core/Button/OButton.vue';


export interface CrossLink {
  name: string;
  url: string;
  fields: Array<{ name: string }>;
  _source?: string;
}

export default defineComponent({
  name: "CrossLinkManager",
  components: { CrossLinkDialog, OButton },
  props: {
    modelValue: {
      type: Array as PropType<CrossLink[]>,
      default: () => [],
    },
    title: {
      type: String,
      default: "Cross-Links",
    },
    subtitle: {
      type: String,
      default: "",
    },
    readonly: {
      type: Boolean,
      default: false,
    },
    showSourceColumn: {
      type: Boolean,
      default: false,
    },
    availableFields: {
      type: Array as PropType<string[]>,
      default: () => [],
    },
  },
  emits: ["update:modelValue", "change"],
  setup(props, { emit }) {
    const store = useStore();
    const { t } = useI18n();
    const showAddDialog = ref(false);
    const editingLink = ref<CrossLink | null>(null);
    const editingOriginalName = ref("");

    const links = computed(() => props.modelValue);

    function onAddClick() {
      editingLink.value = null;
      editingOriginalName.value = "";
      showAddDialog.value = true;
    }

    function editLink(link: CrossLink) {
      editingLink.value = { ...link };
      editingOriginalName.value = link.name;
      showAddDialog.value = true;
    }

    function removeLink(link: CrossLink) {
      const updated = props.modelValue.filter((l) => l.name !== link.name);
      emit("update:modelValue", updated);
      emit("change");
    }

    function onSaveLink(link: CrossLink) {
      let updated: CrossLink[];

      if (editingOriginalName.value) {
        const idx = props.modelValue.findIndex(
          (l) => l.name === editingOriginalName.value,
        );
        if (idx >= 0) {
          updated = [...props.modelValue];
          updated[idx] = link;
        } else {
          updated = [...props.modelValue, link];
        }
      } else {
        updated = [...props.modelValue, link];
      }

      emit("update:modelValue", updated);
      emit("change");
      showAddDialog.value = false;
      editingLink.value = null;
      editingOriginalName.value = "";
    }

    return {
      t,
      store,
      links,
      showAddDialog,
      editingLink,
      onAddClick,
      editLink,
      removeLink,
      onSaveLink,
    };
  },
});
</script>
