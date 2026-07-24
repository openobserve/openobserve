<script lang="ts">
// Copyright 2026 OpenObserve Inc.
//
// Visual "Fires when" builder for a composite alert. Owns the expression AST
// (parsed from / serialised to the persisted string), renders it as pills +
// AND/OR joiners + bracketed groups via the recursive ExprNode, and offers a
// Builder ⇄ Expression toggle so power users can still edit the raw string.
import { defineComponent, ref, computed, watch, provide, onMounted, onBeforeUnmount } from "vue";
import { useI18n } from "vue-i18n";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ExprNode from "./ExprNode.vue";
import { COMPOSITE_EXPR_API, type CompositeExprApi } from "./compositeExprApi";
import {
  parseToAst,
  serializeAst,
  toggleOpAtPath,
  removeAtPath,
  addTermAtPath,
  addGroupAtPath,
  usedAliases,
  type ExprNode as ExprNodeType,
} from "@/utils/alerts/compositeExpressionAst";

const labelOf = (alias: string): string =>
  (alias || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export default defineComponent({
  name: "CompositeExpressionBuilder",
  components: { OToggleGroup, OToggleGroupItem, OInput, OIcon, ExprNode },
  props: {
    /** The persisted expression string (e.g. "(a && b) || c"). */
    expression: { type: String, default: "" },
    /** Defined terms, for the add-popover. */
    terms: {
      type: Array as () => Array<{ name: string }>,
      default: () => [],
    },
    /** A validation error from the parent (unknown/unreferenced term). */
    error: { type: String, default: "" },
  },
  emits: ["update:expression"],
  setup(props, { emit }) {
    const { t } = useI18n();

    const ast = ref<ExprNodeType | null>(null);
    const parseError = ref<string | null>(null);
    const mode = ref<"builder" | "text">("builder");

    const rebuildFromExpr = () => {
      const raw = (props.expression || "").trim();
      if (!raw) {
        ast.value = { type: "group", op: "AND", children: [] };
        parseError.value = null;
        return;
      }
      try {
        ast.value = parseToAst(raw);
        parseError.value = null;
      } catch (e: any) {
        ast.value = null;
        parseError.value = e?.message || "Invalid expression";
      }
    };
    rebuildFromExpr();

    watch(
      () => props.expression,
      (val) => {
        // Ignore the echo of our own commit; re-parse only external changes.
        if (ast.value && serializeAst(ast.value) === val) return;
        rebuildFromExpr();
      },
    );

    const commit = () => {
      if (ast.value) emit("update:expression", serializeAst(ast.value));
    };

    // ── add popover ──────────────────────────────────────────────────────
    const addPopPath = ref<number[] | null>(null);
    const addPopPos = ref<{ top: number; left: number }>({ top: 0, left: 0 });
    const used = computed(() =>
      ast.value ? usedAliases(ast.value) : new Set<string>(),
    );

    const closeAdd = () => {
      addPopPath.value = null;
    };
    const requestAdd = (path: number[], ev: MouseEvent) => {
      const el = ev.currentTarget as HTMLElement;
      const r = el.getBoundingClientRect();
      addPopPos.value = { top: r.bottom + 6, left: r.left };
      addPopPath.value = path;
    };
    const pickTerm = (alias: string) => {
      if (!ast.value || !addPopPath.value) return;
      addTermAtPath(ast.value, addPopPath.value, alias);
      closeAdd();
      commit();
    };
    const pickNewGroup = () => {
      if (!ast.value || !addPopPath.value) return;
      // Seed the group with up to two not-yet-used terms (else the first term).
      const free = props.terms
        .map((tm) => tm.name)
        .filter((n) => !used.value.has(n));
      const seeds = free.slice(0, 2);
      if (!seeds.length && props.terms.length) seeds.push(props.terms[0].name);
      addGroupAtPath(ast.value, addPopPath.value, seeds);
      closeAdd();
      commit();
    };

    const api: CompositeExprApi = {
      toggleOp: (path) => {
        if (!ast.value) return;
        toggleOpAtPath(ast.value, path);
        commit();
      },
      removeAt: (path) => {
        if (!ast.value) return;
        removeAtPath(ast.value, path);
        commit();
      },
      requestAdd,
      labelOf,
    };
    provide(COMPOSITE_EXPR_API, api);

    // ── mode toggle ──────────────────────────────────────────────────────
    const setMode = (m: string) => {
      if (m === "builder") {
        rebuildFromExpr();
        if (parseError.value) return; // can't visualise an invalid expression
      }
      mode.value = m as "builder" | "text";
    };
    const onTextInput = (val: string | number) => {
      emit("update:expression", String(val ?? ""));
    };

    // Show the (static) restate line once the expression has at least one query.
    const hasExpression = computed(
      () =>
        !!(
          ast.value &&
          ast.value.type === "group" &&
          ast.value.children.length
        ),
    );

    // close popover on outside click / escape
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (addPopPath.value && !target.closest("[data-test='composite-expr-pop']") &&
          !target.closest("[data-test='composite-expr-add']")) {
        closeAdd();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeAdd();
    };
    onMounted(() => {
      document.addEventListener("click", onDocClick);
      document.addEventListener("keydown", onKey);
    });
    onBeforeUnmount(() => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKey);
    });

    return {
      t,
      ast,
      parseError,
      mode,
      setMode,
      onTextInput,
      hasExpression,
      addPopPath,
      addPopPos,
      used,
      pickTerm,
      pickNewGroup,
      labelOf,
    };
  },
});
</script>

<template>
  <div class="flex flex-col gap-2" data-test="composite-expression-builder">
    <!-- Builder ⇄ Expression toggle -->
    <div class="flex items-center justify-end">
      <OToggleGroup :model-value="mode" @update:model-value="(v) => setMode(v as string)">
        <OToggleGroupItem value="builder" size="sm" data-test="composite-expr-mode-builder">
          {{ t("alerts.composite.builder") }}
        </OToggleGroupItem>
        <OToggleGroupItem value="text" size="sm" data-test="composite-expr-mode-text">
          {{ t("alerts.composite.expression") }}
        </OToggleGroupItem>
      </OToggleGroup>
    </div>

    <!-- Builder canvas -->
    <template v-if="mode === 'builder'">
      <div
        v-if="ast"
        class="flex items-center gap-1.5 flex-wrap rounded-default border border-border-default bg-surface-base px-2 py-2 min-h-11"
        data-test="composite-expr-canvas"
      >
        <ExprNode :node="ast" :path="[]" :depth="0" />
      </div>
    </template>

    <!-- Raw text -->
    <template v-else>
      <OInput
        :model-value="expression"
        data-test="composite-expression-input"
        :placeholder="t('alerts.composite.expressionPlaceholder')"
        class="text-sm"
        :class="error || parseError ? 'field-error' : ''"
        @update:model-value="onTextInput"
      />
    </template>

    <!-- Restate line -->
    <div v-if="hasExpression" class="flex items-center gap-1.5 text-xs text-text-secondary" data-test="composite-expr-restate">
      <OIcon name="info" size="xs" class="shrink-0" />
      <span>{{ t("alerts.composite.firesWhenRestate") }}</span>
    </div>

    <!-- Errors -->
    <div
      v-if="error || parseError"
      class="flex items-center gap-1 text-compact font-medium text-negative"
      data-test="composite-expression-error"
    >
      <OIcon name="error-outline" size="xs" />
      {{ error || parseError }}
    </div>

    <!-- Add-a-query popover -->
    <Teleport to="body">
      <div
        v-if="addPopPath"
        data-test="composite-expr-pop"
        class="fixed z-50 min-w-52 rounded-default border border-border-default bg-surface-overlay shadow-md p-1"
        :style="{ top: `${addPopPos.top}px`, left: `${addPopPos.left}px` }"
      >
        <div class="px-2 py-1 text-xs font-semibold text-text-secondary">
          {{ t("alerts.composite.pickQuery") }}
        </div>
        <button
          v-for="term in terms"
          :key="term.name"
          type="button"
          class="flex w-full items-center gap-2 rounded-default px-2 py-1.5 text-xs text-left hover:bg-hover-gray cursor-pointer"
          :data-test="`composite-expr-pop-${term.name}`"
          @click="pickTerm(term.name)"
        >
          <span class="inline-flex items-center rounded-default px-1.5 text-2xs font-medium bg-badge-primary-soft-bg text-badge-primary-soft-text">{{ labelOf(term.name) }}</span>
          <span v-if="used.has(term.name)" class="ml-auto text-2xs text-text-secondary">{{ t("alerts.composite.inUse") }}</span>
        </button>
        <div class="my-1 h-px bg-border-default" />
        <button
          type="button"
          class="flex w-full items-center rounded-default px-2 py-1.5 text-xs text-left hover:bg-hover-gray cursor-pointer"
          data-test="composite-expr-pop-group"
          @click="pickNewGroup"
        >
          {{ t("alerts.composite.newGroup") }}
        </button>
      </div>
    </Teleport>
  </div>
</template>
