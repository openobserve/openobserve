<template>
  <!-- Standard app header: back tile + the function NAME as the title (inline-
       edited in place, so it is not a boxed field wedged into the toolbar), the
       mode as the subtitle, the language toggle inline (#tabs) and the
       action buttons (#actions). The name + transType controls are form-owned
       (OForm*); the parent AddFunction.vue provides the <OForm> context they
       inject — which is what lets the title live in the #title slot. -->
  <!-- Embedded (workflow NDV): the host panel owns the title, close (×) and
       navigation, so drop this component's own back chevron + "Add Function"
       subtitle — they read as a competing, mid-flow page header. -->
  <OPageHeader
    :subtitle="embedded ? undefined : t('function.addFunction')"
    title-overflow="visible"
    :tabs-below="narrow"
    :back="
      embedded
        ? undefined
        : {
            label: t('function.header'),
            onClick: redirectToFunctions,
            dataTest: 'add-function-back-btn',
          }
    "
  >
    <template #title>
      <!-- Embedded (workflow NDV): no inline function name here — the name is asked at
           SAVE time in the Update|Create dialog, mirroring the Logs editor. -->
      <OFormInlineEdit
        v-if="!embedded"
        name="name"
        data-test="add-function-name-input"
        :placeholder="t('function.name')"
        :aria-label="t('function.name')"
        :edit-hint="t('function.renameHint')"
        :readonly="disableName"
        :disabled="disableName"
      />
    </template>
    <template #tabs>
      <div
        ref="toggleRef"
        data-test="function-toolbar-tabs"
        class="o2-input flex h-full items-center gap-4 max-md:h-auto max-md:basis-full"
      >
        <!-- Divider between the function name (header #title) and the language
             toggle — they are separate controls sharing one header row. h-full +
             the separator's own self-stretch span the full h-15 header row; my-2
             insets it to ~2.75rem, so it runs past the subtitle line ("Add
             Function") rather than stopping at the name. -->
        <OSeparator v-if="!narrow" vertical class="my-2 max-md:hidden" />
        <!-- Transform-type (language) selector -->
        <div class="flex h-9 items-center gap-4">
          <!-- A segmented toggle rather than a radio group: the two languages are
               mutually exclusive VIEWS of the same editor, so they read as a
               switch. Each option carries its OWN info tip, so both languages can
               be understood WITHOUT selecting one first (the previous single tip
               only ever described the already-selected language).
               Hidden entirely when a host forces a single language (e.g. workflow
               function nodes are JS-only) — the locked language's tip moves to the
               standalone icon below. -->
          <OFormToggleGroup
            v-if="!hideTransType"
            name="transType"
            type="single"
            data-test="function-transform-type-toggle"
          >
            <OToggleGroupItem value="0" data-test="function-transform-type-vrl-option">
              <template #icon-left>
                <!-- Language mark. Colours match the transType column badge in
                     FunctionList so VRL/JS read the same everywhere. -->
                <OBadge size="xs" shape="rounded" variant="blue-soft">{{ raw("V") }}</OBadge>
              </template>
              {{ transformTypeOptions[0]?.label }}
              <template #icon-right>
                <OIcon
                  name="info-outline"
                  size="sm"
                  class="cursor-pointer opacity-70"
                  data-test="function-transform-type-vrl-info"
                >
                  <OTooltip>
                    <template #content>
                      <!-- Wrap in one column container: OTooltip renders the
                           #content slot inside an inline-flex row, so sibling
                           blocks would sit side-by-side. A single flex-col child
                           keeps title over body. -->
                      <div class="flex flex-col">
                        <div class="mb-1 font-semibold">
                          {{ t("function.vrl") }} {{ t("function.tipLabel") }}
                        </div>
                        <div>{{ t("function.vrlFunctionHint") }}</div>
                      </div>
                    </template>
                  </OTooltip>
                </OIcon>
              </template>
            </OToggleGroupItem>

            <!-- Pipe divider between the two options -->
            <OSeparator v-if="transformTypeOptions[1]" vertical class="my-1.5" />

            <!-- JavaScript — shown locked (not hidden) in builds that don't
                 unlock it; see isJsAllowed in AddFunction.vue. The toggle
                 writes straight to form state on click, so a locked click is
                 caught on this wrapper BEFORE it reaches the item — removing
                 `disabled` there would let it write "1" to the form. -->
            <span
              v-if="transformTypeOptions[1]"
              class="contents"
              @click.capture="
                transformTypeOptions[1]?.disabled ? onLockedJsClick($event) : undefined
              "
            >
              <OToggleGroupItem value="1" data-test="function-transform-type-js-option">
                <template #icon-left>
                  <OBadge size="xs" shape="rounded" variant="amber-soft">{{ raw("JS") }}</OBadge>
                </template>
                {{ transformTypeOptions[1]?.label }}
                <template v-if="transformTypeOptions[1]?.disabled" #icon-right>
                  <OIcon
                    name="lock"
                    size="sm"
                    class="lock-chip"
                    data-test="function-transform-type-js-lock"
                  />
                </template>
                <template v-else #icon-right>
                  <OIcon
                    name="info-outline"
                    size="sm"
                    class="cursor-pointer opacity-70"
                    data-test="function-transform-type-js-info"
                  >
                    <OTooltip>
                      <template #content>
                        <div class="flex flex-col">
                          <div class="mb-1 font-semibold">
                            {{ raw("JavaScript") }} {{ t("function.tipLabel") }}
                          </div>
                          <div>{{ t("function.jsFunctionHint") }}</div>
                        </div>
                      </template>
                    </OTooltip>
                  </OIcon>
                </template>
              </OToggleGroupItem>
            </span>
          </OFormToggleGroup>

          <!-- Forced-language hosts get no toggle, so the tip for the locked
               language stays reachable here. -->
          <OIcon
            v-else
            name="info-outline"
            size="sm"
            class="text-icon-color shrink-0 cursor-pointer"
            data-test="function-transform-type-info"
          >
            <OTooltip>
              <template #content>
                <div class="flex flex-col">
                  <div class="mb-1 font-semibold">
                    {{ transTypeValue === "1" ? raw("JavaScript") : t("function.vrl") }}
                    {{ t("function.tipLabel") }}
                  </div>
                  <div>
                    {{
                      transTypeValue === "1"
                        ? t("function.jsFunctionHint")
                        : t("function.vrlFunctionHint")
                    }}
                  </div>
                </div>
              </template>
            </OTooltip>
          </OIcon>
        </div>
      </div>
    </template>
    <template #actions>
      <div ref="actionsRef" data-test="function-toolbar-actions" class="flex items-center gap-2">
        <AiEntryButton
          v-if="assistant && !hideChat"
          :appearance="dockHost ? 'toggle' : 'button'"
          verb="ask"
          entry-kind="editor_toggle"
          object-kind="function"
          thread="current"
          :dock-host="dockHost ? 'function' : undefined"
          :label="t('assistant.entry.assistant')"
          :tooltip="
            dockHost
              ? t('assistant.entry.tooltip.dockedAsk')
              : t('assistant.entry.tooltip.sidebarAsk')
          "
          :pressed="assistant.dock.isOpen.value"
          :build="assistant.dock.build"
          data-test="ai-entry-function-ask"
          @closed="assistant.dock.close"
        />
        <OButton
          v-if="!embedded"
          data-test="add-function-fullscreen-btn"
          v-close-popup="true"
          variant="outline"
          size="sm-action"
          :disabled="isSubmitting"
          @click="handleFullScreen"
          icon-left="fullscreen"
        >
          {{ t("common.fullscreen") }}
        </OButton>
        <OButton
          v-if="!hideTest"
          data-test="add-function-test-btn"
          variant="outline"
          size="sm-action"
          :disabled="isSubmitting"
          @click="emit('test')"
          icon-left="play-arrow"
        >
          {{ t("function.testFunction") }}
        </OButton>
        <OButton
          v-if="!embedded"
          data-test="add-function-cancel-btn"
          variant="outline"
          size="sm-action"
          :disabled="isSubmitting"
          @click="emit('cancel')"
        >
          {{ t("function.cancel") }}
        </OButton>
        <OButton
          data-test="add-function-save-btn"
          variant="primary"
          size="sm-action"
          type="submit"
          :loading="isSubmitting"
        >
          {{ t("function.save") }}
        </OButton>
      </div>
    </template>
  </OPageHeader>
</template>
<script setup lang="ts">
import { ref, computed, type PropType, inject, defineAsyncComponent } from "vue";
import { useResizeObserver } from "@vueuse/core";
import { raw, useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OFormInlineEdit from "@/lib/forms/InlineEdit/OFormInlineEdit.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import OFormToggleGroup from "@/lib/core/ToggleGroup/OFormToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OPageHeader from "@/lib/core/PageHeader/OPageHeader.vue";
import { toggleFullscreen } from "@/utils/dom";
import { FORM_CONTEXT_KEY } from "@/lib/forms/Form/OForm.types";
import { useEnterpriseUpgradeDialog } from "@/composables/useEnterpriseUpgradeDialog";
import type { DockedEditor } from "@/composables/assistant/pure";
const AiEntryButton = defineAsyncComponent(
  () => import("@/components/ai-assistant/entry/AiEntryButton.vue"),
);
const { t } = useI18nTyped();

const { open: openUpgradeDialog } = useEnterpriseUpgradeDialog();

function onLockedJsClick(event: MouseEvent) {
  event.preventDefault();
  event.stopPropagation();
  openUpgradeDialog();
}

defineProps({
  disableName: {
    type: Boolean,
    default: false,
  },
  transformTypeOptions: {
    type: Array as PropType<{ label: string; value: string | number; disabled?: boolean }[]>,
    default: () => [],
  },
  // Hides the VRL/JS language toggle entirely (used when a host forces a single
  // language — e.g. workflow function nodes are JavaScript-only).
  hideTransType: {
    type: Boolean,
    default: false,
  },
  // Hides the top "Ask AI" chat toggle (workflows keep only the inline editor AI).
  hideChat: {
    type: Boolean,
    default: false,
  },
  // Hides the "Test Function" action (workflows test via the NDV's Replay instead of
  // the embedded test panel, which is removed there).
  hideTest: {
    type: Boolean,
    default: false,
  },
  // Embedded in a host panel (workflow NDV): drop this component's own page-header
  // navigation — the back chevron, the "Add Function" subtitle, Go Full Screen and
  // Cancel — since the host frame already provides title, close and navigation.
  embedded: {
    type: Boolean,
    default: false,
  },
  /** Drives the Save spinner + disables sibling actions while the form submits. */
  isSubmitting: {
    type: Boolean,
    default: false,
  },
  /** The assistant's host; `null` hides the door. */
  assistant: {
    type: Object as PropType<DockedEditor | null>,
    default: null,
  },
  /** Docks beside the editor (a pipeline node) instead of opening the sidebar. */
  dockHost: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(["test", "back", "cancel"]);

const toggleRef = ref<HTMLElement | null>(null);
const actionsRef = ref<HTMLElement | null>(null);
const GAP = 8;
// OPageHeader has no single root element to ref, so find it from our own slot content.
const headerEl = computed(() => actionsRef.value?.closest<HTMLElement>(".app-page-header") ?? null);
const narrow = ref(false);
// Remembered from the one-row layout so the toggle can return to it without flicker.
let leftOffset = 0;
let rightPad = 0;

function measure() {
  const header = headerEl.value?.getBoundingClientRect();
  const toggle = toggleRef.value?.getBoundingClientRect();
  // The tabs box stretches across the row in the two-row layout, so take its content's right edge.
  const toggleEnd = toggleRef.value?.lastElementChild?.getBoundingClientRect().right;
  const actions = actionsRef.value?.getBoundingClientRect();
  if (!header || !toggle || !actions || toggleEnd === undefined || !header.width) return;
  const toggleWidth = toggleEnd - toggle.left;
  if (!narrow.value) {
    leftOffset = toggle.left - header.left;
    rightPad = header.right - actions.right;
  }
  narrow.value = header.width < leftOffset + toggleWidth + GAP + actions.width + rightPad;
}

useResizeObserver([headerEl, toggleRef, actionsRef], measure);

// The name + transType fields are form-owned (OForm*). We only READ transType
// here (for the forced-language info tooltip) via the injected OForm context.
const form = inject(FORM_CONTEXT_KEY, null);
const transTypeValue = form
  ? form.useStore((s: any) => String(s.values.transType ?? "0"))
  : ref("0");

const handleFullScreen = () => {
  toggleFullscreen();
};

const redirectToFunctions = () => {
  emit("back");
};
</script>
