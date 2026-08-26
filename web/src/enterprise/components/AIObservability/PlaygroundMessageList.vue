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
      v-for="message in variant.messages"
      :key="message.id"
      class="border-border-default rounded-default focus-within:border-input-border-focus flex items-start gap-1.5 border px-1.5 py-1"
      :data-test="`ai-playground-message-${message.role}`"
    >
      <!-- Fixed width, not shrink-to-fit: "System" is wider than "User", so a
           natural-width chip starts every field at a different x and the column
           of inputs reads as ragged. -->
      <span
        class="bg-surface-secondary text-text-secondary rounded-default text-2xs mt-0.5 w-16 shrink-0 px-1.5 py-0.5 text-center font-semibold"
      >
        {{ roleLabel(message.role) }}
      </span>

      <div
        v-if="message.readonly"
        class="text-text-secondary min-w-0 flex-1 py-0.5 font-mono text-xs leading-relaxed wrap-break-word whitespace-pre-wrap"
        :title="t('aiObservability.playground.readonlyMessage')"
      >
        {{ message.content }}
      </div>
      <!-- Inline, beside the field. It shifts this row's textarea right of the
           other rows' — accepted deliberately: the pairing of tool to response
           reads better than a straight column of inputs. -->
      <OSelect
        v-if="message.role === 'tool' && !message.readonly"
        class="mt-0.5"
        :model-value="message.toolName ?? ''"
        :options="toolOptions"
        :placeholder="t('aiObservability.playground.messageToolPlaceholder')"
        size="md"
        width="sm"
        searchable
        :data-test="`ai-playground-message-tool-${message.id}`"
        @update:model-value="(value: unknown) => emit('set-tool', message.id, String(value ?? ''))"
      />

      <div v-if="!message.readonly" class="relative min-w-0 flex-1">
        <OTextarea
          :model-value="message.content"
          :placeholder="
            t('aiObservability.playground.messagePlaceholder', { role: roleLabel(message.role) })
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
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTextarea from "@/lib/forms/Input/OTextarea.vue";
import { computed, ref } from "vue";
import {
  EXPECTED_OUTPUT_TOKEN,
  nextMessageRole,
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
  /** The caret moved into this message — the variable chips insert here. */
  focus: [messageId: string, element: HTMLTextAreaElement];
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

function onFocus(messageId: string, event: FocusEvent) {
  const element = event.target;
  if (element instanceof HTMLTextAreaElement) {
    elements.set(messageId, element);
    emit("focus", messageId, element);
  }
}
</script>
