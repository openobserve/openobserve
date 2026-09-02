<!-- Copyright 2026 OpenObserve Inc.

  The role-tagged message editor for one variant. A message carried in from a
  trace is removable but not editable — you can drop it from the conversation,
  but rewriting it would misrepresent what the model actually saw.

  One ROW per message rather than one bordered card: the role sits inline as a
  chip and the field autogrows from a single line. A prompt's shape is then
  readable at a glance, and four columns of stacked cards no longer push the
  outputs they exist to produce off the screen.
-->
<template>
  <div class="flex flex-col gap-1.5">
    <div
      v-for="(message, index) in variant.messages"
      :key="message.id"
      class="border-border-default rounded-default focus-within:border-input-border-focus group relative flex items-start gap-1.5 border px-1.5 py-1"
      :class="[dragIndex === index ? 'opacity-50' : '', dropIndex === index ? 'border-accent' : '']"
      :draggable="canMove(index) && isDragArmed(message.id)"
      :data-test="`ai-playground-message-${message.role}`"
      @dragstart="onDragStart(index)"
      @dragover.prevent="onDragOver(index)"
      @drop.prevent="onDrop(index)"
      @dragend="endDrag"
    >
      <!-- Gmail-style: the gutter reads as padding at rest and the grip fades in
           on row hover. Dragging is armed by pressing the grip alone, so a grab
           anywhere else still selects text in the message. -->
      <OIcon
        name="drag-indicator"
        size="sm"
        aria-hidden="true"
        class="text-text-secondary w-3 shrink-0 self-center opacity-0 transition-opacity duration-150"
        :class="canMove(index) ? 'cursor-grab group-hover:opacity-50 hover:opacity-100' : ''"
        :title="t('aiObservability.playground.dragMessage')"
        :data-test="`ai-playground-message-drag-${message.id}`"
        @mousedown="canMove(index) && armDrag(message.id)"
      />

      <!-- Fixed width, not shrink-to-fit: "Assistant" is wider than "User", so
           a badge sized to its own text starts every field at a different x and
           the column of inputs reads as ragged. -->
      <button
        v-if="canRetype(message)"
        type="button"
        class="flex w-20 shrink-0 cursor-pointer"
        :class="message.role === 'tool' ? 'mt-0.5 self-start' : 'self-center'"
        :data-test="`ai-playground-message-role-${message.id}`"
        @click="emit('set-role', message.id, nextRoleAfter(message.role))"
      >
        <OTag
          :variant="roleVariant(message.role)"
          size="sm"
          shape="rounded"
          :label="roleLabel(message.role)"
          class="min-w-0 flex-1 justify-center"
          :data-test="`ai-playground-message-badge-${message.id}`"
        />
        <OTooltip side="top" :content="t('aiObservability.playground.changeRole')" />
      </button>
      <!-- The system frame and a message carried in from a trace keep their
           role: one is not a turn, and retyping the other would misrepresent
           what the model actually saw. -->
      <div v-else class="flex w-20 shrink-0 self-center">
        <OTag
          :variant="roleVariant(message.role)"
          size="sm"
          shape="rounded"
          :label="roleLabel(message.role)"
          class="min-w-0 flex-1 justify-center"
          :data-test="`ai-playground-message-badge-${message.id}`"
        />
        <!-- The badge looks like the ones that cycle, so the reason it does not
             has to be one hover away rather than something to discover by
             clicking and getting nothing. -->
        <OTooltip side="top" :content="fixedRoleReason(message)" />
      </div>

      <div
        v-if="message.readonly"
        class="text-text-secondary min-w-0 flex-1 py-0.5 font-mono text-xs leading-relaxed wrap-break-word whitespace-pre-wrap"
        :title="t('aiObservability.playground.readonlyMessage')"
      >
        {{ message.content }}
      </div>
      <div
        v-if="!message.readonly"
        class="min-w-0 flex-1"
        :class="
          message.role === 'tool'
            ? 'grid grid-cols-[minmax(7.5rem,12.5rem)_minmax(0,1fr)] gap-1.5'
            : ''
        "
        :data-test="
          message.role === 'tool' ? `ai-playground-message-tool-editor-${message.id}` : undefined
        "
      >
        <!-- Tool metadata shares a compact header. The result gets the full
             content width below it instead of collapsing into a third column. -->
        <div
          v-if="message.role === 'tool'"
          class="contents"
          :data-test="`ai-playground-message-tool-metadata-${message.id}`"
        >
          <OSelect
            class="min-w-0"
            :model-value="message.toolName ?? ''"
            :options="toolOptions"
            :placeholder="t('aiObservability.playground.messageToolPlaceholder')"
            size="md"
            width="full"
            searchable
            :data-test="`ai-playground-message-tool-${message.id}`"
            @update:model-value="
              (value: unknown) => emit('set-tool', message.id, String(value ?? ''))
            "
          />

          <OTextarea
            class="min-w-0"
            :model-value="message.toolArguments ?? '{}'"
            :placeholder="t('aiObservability.playground.toolArgumentsPlaceholder')"
            :rows="1"
            :max-rows="5"
            size="sm"
            width="full"
            autogrow
            :data-test="`ai-playground-message-tool-arguments-${message.id}`"
            @update:model-value="(value: string) => emit('set-tool-arguments', message.id, value)"
          />
        </div>

        <div class="relative min-w-0" :class="message.role === 'tool' ? 'col-span-2' : ''">
          <OTextarea
            :model-value="message.content"
            :placeholder="
              message.role === 'tool'
                ? t('aiObservability.playground.toolResultPlaceholder')
                : t('aiObservability.playground.messagePlaceholder', {
                    role: roleLabel(message.role),
                  })
            "
            :rows="1"
            :max-rows="5"
            size="sm"
            autogrow
            :data-test="`ai-playground-message-input-${message.id}`"
            @update:model-value="(value: string) => onInput(message.id, value)"
            @focus="onFocus(message.id, $event)"
            @blur="closeSuggest"
            @keydown="onKeydown(message.id, $event)"
          />

          <!-- Typing `{{` is the moment someone is reaching for a variable, so
               that is where the list belongs — not behind a menu they would have
               to know exists. -->
          <div
            v-if="suggest?.messageId === message.id && matches.length"
            class="bg-dropdown-bg border-dropdown-border rounded-default absolute top-full left-0 z-10 mt-1 w-56 border p-1 shadow-md"
            :data-test="`ai-playground-var-suggest-${message.id}`"
          >
            <button
              v-for="(name, index) in matches"
              :key="name"
              type="button"
              class="rounded-default text-dropdown-item-text flex w-full cursor-pointer items-center px-2 py-1 text-left font-mono text-xs"
              :class="index === activeIndex ? 'bg-dropdown-item-hover-bg' : ''"
              :data-test="`ai-playground-var-suggest-item-${name}`"
              @mousedown.prevent="accept(message.id, name)"
            >
              {{ tokenFor(name) }}
            </button>
          </div>
        </div>
      </div>

      <!-- The opening system message is structural, not a turn: it is disabled
           rather than hidden so the row stays aligned with the ones below it. -->
      <OButton
        variant="ghost-muted"
        size="icon-xs"
        icon-left="close"
        class="mt-0.5"
        :disabled="message.role === 'system'"
        :title="
          message.role === 'system'
            ? t('aiObservability.playground.systemMessageFixed')
            : t('aiObservability.playground.removeMessage')
        "
        :data-test="`ai-playground-message-remove-${message.id}`"
        @click="message.role !== 'system' && emit('remove', message.id)"
      />
    </div>

    <!-- One control, not one per role: the common case is continuing the
         conversation, and the role that continues it is derivable. The chevron
         is there for the times it is not. -->
    <div class="inline-flex items-stretch self-start">
      <OButton
        variant="outline"
        size="xs"
        icon-left="add"
        class="rounded-s-default! rounded-e-none!"
        :title="t('aiObservability.playground.addMessageAs', { role: roleLabel(nextRole) })"
        data-test="ai-playground-add-message"
        @click="emit('add', nextRole)"
      >
        {{ t("aiObservability.playground.addMessage") }}
      </OButton>
      <ODropdown align="start" side="bottom">
        <template #trigger>
          <OButton
            variant="outline"
            size="icon-xs-sq"
            class="rounded-e-default! rounded-s-none! border-s-0"
            :aria-label="t('aiObservability.playground.addMessageChoose')"
            data-test="ai-playground-add-message-menu"
          >
            <OIcon name="arrow-drop-down" size="sm" />
          </OButton>
        </template>
        <ODropdownItem
          v-for="role in MESSAGE_ROLES"
          :key="role"
          :data-test="`ai-playground-add-message-${role}`"
          @select="emit('add', role)"
        >
          {{ roleLabel(role) }}
        </ODropdownItem>
      </ODropdown>
    </div>
  </div>
</template>

<script setup lang="ts">
import { raw, useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import useDragHandle from "@/composables/useDragHandle";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTextarea from "@/lib/forms/Input/OTextarea.vue";
import { computed, ref } from "vue";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import {
  EXPECTED_OUTPUT_TOKEN,
  nextMessageRole,
  type PlaygroundMessage,
  type PlaygroundRole,
  type PlaygroundVariant,
} from "@/enterprise/views/AIObservability/playgroundDraft";

const props = defineProps<{
  variant: PlaygroundVariant;
  /** Declared variables, offered as completions after `{{`. */
  varNames: string[];
}>();

const emit = defineEmits<{
  update: [messageId: string, content: string];
  remove: [messageId: string];
  add: [role: PlaygroundRole];
  /** Which tool a `tool`-role message answers. */
  "set-tool": [messageId: string, toolName: string];
  /** JSON arguments sent to that tool. */
  "set-tool-arguments": [messageId: string, toolArguments: string];
  /** Retype a message in place, keeping whatever was written in it. */
  "set-role": [messageId: string, role: PlaygroundRole];
  move: [from: number, to: number];
  /** The caret moved into this message — the variable chips insert here. */
}>();

const { t } = useI18nTyped();

/**
 * Offered explicitly, in the order a prompt is usually built.
 *
 * `system` is absent on purpose: every variant already opens with one, it is
 * always first, and a second system message part-way through a conversation is
 * not something any provider treats as meaningful.
 */
const MESSAGE_ROLES: PlaygroundRole[] = ["user", "assistant", "tool"];

/**
 * One colour family per role, so a prompt's shape is legible before a word of
 * it is read. Soft fills rather than solid: four columns of these sit beside
 * the outputs, and solid pills at that density read as a status board.
 */
const ROLE_VARIANTS: Record<PlaygroundRole, BadgeVariant> = {
  system: "purple-soft",
  user: "blue-soft",
  assistant: "teal-soft",
  tool: "amber-soft",
};

const ROLE_LABELS = {
  system: "aiObservability.playground.roleSystem",
  user: "aiObservability.playground.roleUser",
  assistant: "aiObservability.playground.roleAssistant",
  tool: "aiObservability.playground.roleTool",
} as const;

const nextRole = computed(() => nextMessageRole(props.variant.messages));

const toolOptions = computed(() =>
  props.variant.tools
    .filter((tool) => tool.name.trim().length > 0)
    .map((tool) => ({ label: raw(tool.name), value: tool.name })),
);

function roleLabel(role: PlaygroundRole) {
  return t(ROLE_LABELS[role]);
}

function roleVariant(role: PlaygroundRole): BadgeVariant {
  return ROLE_VARIANTS[role];
}

/** Clicking the badge walks the offered roles in order and wraps. `system` is
 *  not in that list, which is also why its badge is not a button. */
function nextRoleAfter(role: PlaygroundRole): PlaygroundRole {
  const at = MESSAGE_ROLES.indexOf(role);
  return MESSAGE_ROLES[(at + 1) % MESSAGE_ROLES.length];
}

/** The first row anything may occupy. An opening system message is the frame
 *  around the conversation, not a turn in it, so it stays pinned at the top. */
const firstMovable = computed(() => (props.variant.messages[0]?.role === "system" ? 1 : 0));

function canMove(index: number): boolean {
  return props.variant.messages.length > firstMovable.value + 1 && index >= firstMovable.value;
}

/** A message carried in from a trace keeps its role: retyping one would
 *  misrepresent what the model actually saw. */
function canRetype(message: PlaygroundMessage): boolean {
  return message.role !== "system" && !message.readonly;
}

function fixedRoleReason(message: PlaygroundMessage) {
  return message.role === "system"
    ? t("aiObservability.playground.systemRoleFixed")
    : t("aiObservability.playground.readonlyRoleFixed");
}

// ── reorder ───────────────────────────────────────────────────────

/** Native drag, armed only by pressing the grip — the same gate the dashboard
 *  tab strip uses, so text inside a message stays selectable. */
const { arm: armDrag, isArmed: isDragArmed } = useDragHandle();
const dragIndex = ref<number | null>(null);
const dropIndex = ref<number | null>(null);

function onDragStart(index: number) {
  dragIndex.value = index;
}

function onDragOver(index: number) {
  if (dragIndex.value === null || !canMove(index)) return;
  dropIndex.value = index;
}

function onDrop(index: number) {
  const from = dragIndex.value;
  endDrag();
  if (from === null || !canMove(index) || from === index) return;
  emit("move", from, index);
}

function endDrag() {
  dragIndex.value = null;
  dropIndex.value = null;
}

/** An open `{{` with no closing braces yet, and whatever has been typed since.
 *  Anchored to the caret, so a second `{{` later in the line wins. */
const OPEN_TOKEN = /\{\{([A-Za-z0-9_]*)$/;

const suggest = ref<{ messageId: string; query: string; start: number } | null>(null);
const activeIndex = ref(0);
const elements = new Map<string, HTMLTextAreaElement>();

const matches = computed(() => {
  const open = suggest.value;
  if (!open) return [];
  const query = open.query.toLowerCase();
  return props.varNames.filter(
    // `expected_output` is the answer, not an input — completing it into a
    // prompt would leak the thing the prompt is supposed to arrive at.
    (name) => name !== EXPECTED_OUTPUT_TOKEN && name.toLowerCase().startsWith(query),
  );
});

function tokenFor(name: string) {
  return raw(`{{${name}}}`);
}

function closeSuggest() {
  suggest.value = null;
  activeIndex.value = 0;
}

function onInput(messageId: string, value: string) {
  emit("update", messageId, value);
  const element = elements.get(messageId);
  const caret = element?.selectionStart ?? value.length;
  const found = OPEN_TOKEN.exec(value.slice(0, caret));
  if (!found) return closeSuggest();
  suggest.value = { messageId, query: found[1], start: caret - found[0].length };
  activeIndex.value = 0;
}

function accept(messageId: string, name: string) {
  const open = suggest.value;
  const element = elements.get(messageId);
  const message = props.variant.messages.find((candidate) => candidate.id === messageId);
  if (!open || !message) return;
  // The element, not the prop: the prop only catches up once the parent has
  // flushed the keystroke that opened this list.
  const content = element?.value ?? message.content;
  const caret = element?.selectionStart ?? content.length;
  const token = `{{${name}}}`;
  emit("update", messageId, content.slice(0, open.start) + token + content.slice(caret));
  closeSuggest();
  const next = open.start + token.length;
  requestAnimationFrame(() => {
    element?.focus();
    element?.setSelectionRange(next, next);
  });
}

function onKeydown(messageId: string, event: KeyboardEvent) {
  if (suggest.value?.messageId !== messageId || !matches.value.length) return;
  if (event.key === "ArrowDown") {
    event.preventDefault();
    activeIndex.value = (activeIndex.value + 1) % matches.value.length;
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    activeIndex.value = (activeIndex.value - 1 + matches.value.length) % matches.value.length;
  } else if (event.key === "Enter" || event.key === "Tab") {
    event.preventDefault();
    accept(messageId, matches.value[activeIndex.value]);
  } else if (event.key === "Escape") {
    event.preventDefault();
    closeSuggest();
  }
}

// Registers the textarea so the `{{` completion list can insert at its caret.
function onFocus(messageId: string, event: FocusEvent) {
  const element = event.target;
  if (element instanceof HTMLTextAreaElement) elements.set(messageId, element);
}
</script>
