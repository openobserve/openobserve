<template>
  <div class="cross-link-manager">
    <!-- Header -->
    <div class="tw:flex tw:justify-between tw:items-center tw:mb-3">
      <div>
        <div class="tw:font-semibold tw:text-sm">{{ title }}</div>
        <div v-if="subtitle" class="tw:text-xs" style="color: var(--o2-text-muted)">
          {{ subtitle }}
        </div>
      </div>
      <q-btn
        v-if="!readonly"
        dense
        flat
        no-caps
        icon="add"
        label="Add Cross-Link"
        class="o2-secondary-button tw:h-[36px]"
        :class="store.state.theme === 'dark' ? 'o2-secondary-button-dark' : 'o2-secondary-button-light'"
        @click="onAddClick"
        data-test="add-cross-link-btn"
      />
    </div>

    <!-- Links List -->
    <div v-if="links.length > 0" class="cross-link-list" data-test="cross-link-list">
      <div
        v-for="(link, idx) in links"
        :key="link.name"
        class="cross-link-item el-border tw:rounded-md tw:mb-2 tw:p-3"
        :data-test="`cross-link-item-${idx}`"
      >
        <div class="tw:flex tw:justify-between tw:items-start">
          <div class="tw:flex-1 tw:min-w-0">
            <!-- Name -->
            <div class="tw:font-semibold tw:text-sm tw:truncate" :title="link.name" style="color: var(--o2-text-primary)">
              {{ link.name }}
              <q-badge
                v-if="link._source"
                :color="link._source === 'stream' ? 'primary' : 'grey'"
                :label="link._source === 'stream' ? 'Stream' : 'Global'"
                class="q-ml-xs"
              />
            </div>
            <!-- URL -->
            <div class="tw:text-xs tw:truncate tw:mt-1" :title="link.url" style="color: var(--o2-text-muted)">
              {{ link.url }}
            </div>
            <!-- Fields -->
            <div v-if="link.fields?.length" class="tw:flex tw:flex-wrap tw:gap-1 tw:mt-2">
              <q-chip
                v-for="(field, fIdx) in link.fields"
                :key="fIdx"
                dense
                class="tw:max-w-[200px]"
              >
                <span class="tw:truncate tw:text-xs" :title="field.name">{{ field.name }}</span>
              </q-chip>
            </div>
          </div>
          <!-- Actions -->
          <div v-if="!readonly" class="tw:flex tw:items-center tw:gap-1 tw:ml-2 tw:shrink-0">
            <q-btn
              dense
              flat
              round
              icon="edit"
              size="sm"
              @click="editLink(link)"
              :data-test="`cross-link-edit-${idx}`"
            />
            <q-btn
              dense
              flat
              round
              icon="delete"
              size="sm"
              color="negative"
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
      class="tw:text-center tw:py-6 tw:text-sm"
      style="color: var(--o2-text-muted)"
      data-test="cross-link-empty"
    >
      No cross-links configured. Click "Add Cross-Link" to create one.
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
import CrossLinkDialog from "./CrossLinkDialog.vue";

export interface CrossLink {
  name: string;
  url: string;
  fields: Array<{ name: string }>;
  _source?: string;
}

export default defineComponent({
  name: "CrossLinkManager",
  components: { CrossLinkDialog },
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
