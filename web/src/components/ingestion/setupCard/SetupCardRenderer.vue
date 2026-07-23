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

<!--
  SetupCardRenderer — generic, content-driven rich setup card shared by AI
  integrations and in-repo data sources.

  Purely presentational: everything (hero, ordered steps, context chips, code
  chrome, supplementary accordions, footer) is rendered from a RichCardContent
  object (see ./types.ts). Detection ("has my data arrived?") is delegated to
  useStreamDetect — a single user-triggered check per "Test" click, no
  background polling.

  Drive it by building a RichCardContent (AI: markdown frontmatter; data sources:
  setupCard/content/*) — no edits here.
-->
<script setup lang="ts">
import { computed, ref, watch, nextTick } from "vue";
import { useStore } from "vuex";
import { useTheme } from "@/composables/useTheme";
import { useRouter } from "vue-router";
import { b64EncodeUnicode } from "@/utils/zincutils";
import useStreams from "@/composables/useStreams";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OStepper from "@/lib/navigation/Stepper/OStepper.vue";
import OStep from "@/lib/navigation/Stepper/OStep.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OCodeBlock from "@/lib/core/Code/OCodeBlock.vue";
import { safeHttpUrl } from "./subs";
import type {
  CardSubstitutions,
  RichCardContent,
  RichCardStep,
  StepChipKind,
} from "./types";
import { useStreamDetect, prefersReducedMotion } from "./useStreamDetect";

const props = defineProps<{
  /** The integration's rich content (already token-substituted). */
  content: RichCardContent;
  /** Per-org url/org/token — used for the .env download + detection org. */
  subs: CardSubstitutions;
  /** Optional logo URL (e.g. from the manifest) — overrides the content logo. */
  logoUrl?: string;
  /** Optional dark-mode logo URL (manifest) — overrides the content dark logo. */
  logoUrlDark?: string;
}>();

const emit = defineEmits<{
  /** A step's action button was clicked; carries RichCardStepAction.id. */
  (e: "step-action", actionId: string): void;
}>();

const store = useStore();
const router = useRouter();
const { getStreams } = useStreams();
const { isDark } = useTheme();

// The detected stream type drives the status copy + the "View …" destination.
// traces / logs land in their explorers; metrics (which fan out into many
// per-metric streams) link to the Streams page where those streams appear.
const streamKind = computed(() => props.content.detect.streamType);
const isLogsStream = computed(() => streamKind.value === "logs");
const isMetricsStream = computed(() => streamKind.value === "metrics");
// Plural noun for the "Checking for …" / "No … found" copy.
const dataNoun = computed(() =>
  isMetricsStream.value ? "metrics" : isLogsStream.value ? "logs" : "spans",
);
// Singular unit for the connected count ("3 metric streams" / "5 spans").
const countUnit = computed(() =>
  isMetricsStream.value ? "metric stream" : isLogsStream.value ? "log" : "span",
);
const connectedHeadline = computed(() =>
  isMetricsStream.value
    ? "Connected — Metrics Are Flowing"
    : isLogsStream.value
      ? "Connected — Logs Are Flowing"
      : "Connected — Traces Are Flowing",
);
const viewDataLabel = computed(() =>
  isMetricsStream.value
    ? "View Streams"
    : isLogsStream.value
      ? "View Logs"
      : "View Traces",
);
const viewDataIcon = computed(() =>
  isMetricsStream.value ? "list" : isLogsStream.value ? "article" : "timeline",
);

// Open the Logs/Traces view for the detected stream, pre-filtered to this
// integration's data over a 15m window (covers detection's 10m lookback). The
// detection filter is a SQL WHERE fragment — passed base64-encoded as the
// search-bar query, matching how the rest of the app deep-links into search.
const viewData = async () => {
  // The destination Logs/Traces view reads its stream list from the cached
  // streams store. A stream this integration just created won't be in that
  // cache yet, so the deep-link can't select it. Force-refresh this stream type
  // first so the new stream is present before we navigate. Best-effort — if the
  // refetch fails we still navigate (the view runs its own fetch on load).
  try {
    await getStreams(props.content.detect.streamType, false, false, true);
  } catch {
    // ignore — navigate anyway
  }

  // Metrics fan out into many per-metric streams with no single SQL filter, so
  // we send the user to the Streams page (where the new sqlserver_* streams
  // appear) rather than a pre-filtered explorer.
  if (isMetricsStream.value) {
    router
      .push({ name: "logstreams", query: { org_identifier: props.subs.org } })
      .catch(() => {});
    return;
  }

  const query: Record<string, string> = {
    org_identifier: props.subs.org,
    stream: watchedStream.value,
    period: "15m",
    refresh: "0",
    query: b64EncodeUnicode(props.content.detect.filter) ?? "",
  };
  if (isLogsStream.value) {
    query.stream_type = "logs";
  } else {
    query.tab = "spans";
  }
  router
    .push({ name: isLogsStream.value ? "logs" : "traces", query })
    .catch(() => {});
};

// Logo precedence per theme: manifest override → content (frontmatter) → none.
// In dark mode the dark variant is preferred, falling back to the light logo.
// `logoFailed` falls back to the monogram if the image can't load.
const logoFailed = ref(false);
const logoLight = computed(
  () => props.logoUrl || props.content.provider.logo || "",
);
const logoDark = computed(
  () => props.logoUrlDark || props.content.provider.logoDark || "",
);
const logoSrc = computed(() => {
  if (logoFailed.value) return "";
  return (isDark.value && logoDark.value) || logoLight.value;
});

const confettiCanvas = ref<HTMLCanvasElement | null>(null);

// ── stream-name input (optional) ─────────────────────────────────────────────
// Rendered only when the content declares `streamInput`. Its value flows
// reactively into the install command (the `{stream}` placeholder) AND the live
// detection below, so the stream the installer writes to and the stream the card
// listens on always match.
const streamName = ref(props.content.streamInput?.default ?? "");
// Stream names accept letters, digits and underscore only — a '-' or other
// punctuation produces an invalid stream the installer can't write to. Warn the
// user inline (matches the platform's AddStream rule, minus the colon).
const STREAM_NAME_RE = /^[a-zA-Z0-9_]+$/;
const streamNameError = computed(() =>
  streamName.value.trim() && !STREAM_NAME_RE.test(streamName.value.trim())
    ? "Use letters, numbers and _ only."
    : "",
);
const watchedStream = computed(() =>
  props.content.streamInput
    ? streamName.value.trim() || props.content.streamInput.default || "default"
    : props.content.detect.streamName || "default",
);
// ── free-form inputs (optional) ──────────────────────────────────────────────
// Steps can declare `inputs` (e.g. SQL Server host/port on the configure step).
// Each field's value substitutes its `{id}` placeholder in any code block
// reactively, like `{stream}` above. We aggregate every step's inputs so a value
// can fill code anywhere, and seed from defaults so all keys exist (keeps
// mutations reactive) and code shows sensible values before the user edits.
const allInputs = computed(() =>
  props.content.steps.flatMap((s) => s.inputs ?? []),
);
const inputValues = ref<Record<string, string>>(
  Object.fromEntries(allInputs.value.map((i) => [i.id, i.default])),
);

// Substitute live values (stream + free-form inputs) into authored code at
// display/copy time (kept out of build-time subs because they change as the user
// types). Build-time {url}/{org}/{token} are already resolved.
const subStream = (text?: string): string | undefined => {
  if (text == null) return text;
  let out = text.replaceAll("{stream}", watchedStream.value);
  for (const inp of allInputs.value) {
    out = out.replaceAll(`{${inp.id}}`, inputValues.value[inp.id] ?? inp.default);
  }
  return out;
};

const detect = useStreamDetect({
  config: () => ({
    orgId: props.subs.org,
    streamType: props.content.detect.streamType,
    streamName: watchedStream.value,
    // Forward the match mode — without it, keyword detection (metrics, which fan
    // out into sqlserver_* streams) falls back to exact match and never connects.
    match: props.content.detect.match,
    filter: props.content.detect.filter,
  }),
  onConnect: () => fireConfetti(),
});
const detected = computed(() => detect.connected.value);

// Don't surface the "most likely fix" hint on the first miss — the user may
// simply not have run their app yet. Only after a few failed Tests does an
// instrumentation-ordering problem become the likely cause.
const FIX_HINT_AFTER_FAILURES = 3;
const failedChecks = ref(0);
watch(
  () => detect.state.value,
  (s) => {
    if (s === "stalled") failedChecks.value++;
    else if (s === "connected" || s === "idle") failedChecks.value = 0;
  },
);
const showFixHint = computed(
  () =>
    detect.stalled.value &&
    !!extras.value.fixSnippet &&
    failedChecks.value >= FIX_HINT_AFTER_FAILURES,
);

// ── per-step variant selection (e.g. OS/arch for an install command) ─────────
// Each step with `variants` renders a small toggle; the chosen variant's code is
// shown/copied. Defaults to the first variant until the user picks another.
const variantSel = ref<Record<string, string>>({});
// Selection is keyed by `variantGroup` when set, so grouped steps (e.g. install +
// configure sharing "os") move together; otherwise by the step's own id.
const variantKey = (step: RichCardStep): string => step.variantGroup ?? step.id;
const currentVariantId = (step: RichCardStep): string | undefined =>
  step.variants?.length
    ? variantSel.value[variantKey(step)] ?? step.variants[0].id
    : undefined;
const activeVariant = (step: RichCardStep) =>
  step.variants?.find((v) => v.id === currentVariantId(step));
const selectVariant = (key: string, variantId: unknown) => {
  variantSel.value = { ...variantSel.value, [key]: String(variantId) };
};
const displayCode = (step: RichCardStep) =>
  step.variants?.length ? activeVariant(step)?.code : step.code;
const currentVariantNote = (step: RichCardStep) =>
  step.variants?.length ? activeVariant(step)?.note : undefined;

// ── step completion / active-step model ─────────────────────────────────────
const copied = ref<Record<string, boolean>>({});
// Steps whose action button has been triggered (completeOn: "action") — the
// cloud-console flows have nothing to copy and nothing to detect, so the click
// itself is the completion signal.
const actioned = ref<Record<string, boolean>>({});
const isStepDone = (step: RichCardStep) => {
  if (step.completeOn === "copy") return !!copied.value[step.id];
  if (step.completeOn === "action") return !!actioned.value[step.id];
  return detected.value;
};

const onStepAction = (step: RichCardStep, index: number) => {
  if (step.completeOn === "action")
    actioned.value = { ...actioned.value, [step.id]: true };
  emit("step-action", step.action!.id);
  scrollToStep(index + 1);
};

// First not-done step is "active"; -1 once everything is done. OStepper's
// model is 1-based step numbers (0 = none active, i.e. all done).
const activeIndex = computed(() =>
  props.content.steps.findIndex((s) => !isStepDone(s)),
);
const activeStepNumber = computed(() =>
  activeIndex.value >= 0 ? activeIndex.value + 1 : 0,
);

// Detection runs only when the user clicks Test in the status bar
// (detect.check()) — one check per click, never automatically.

// ── next-step auto-advance scroll ────────────────────────────────────────────
// Refs are OStep component instances; we scroll to their root element ($el).
const stepEls = ref<any[]>([]);
const setStepRef = (el: unknown, i: number) => {
  stepEls.value[i] = el ?? null;
};
const scrollToStep = (i: number) => {
  const node = stepEls.value[i]?.$el ?? stepEls.value[i];
  if (node?.scrollIntoView)
    node.scrollIntoView({
      behavior: prefersReducedMotion() ? "auto" : "smooth",
      block: "center",
    });
};
const onStepCopy = (step: RichCardStep, index: number) => {
  if (step.completeOn === "copy")
    copied.value = { ...copied.value, [step.id]: true };
  scrollToStep(index + 1);
};

// ── .env download (from the per-org subs) ────────────────────────────────────
const downloadEnv = () => {
  const body =
    `OPENOBSERVE_URL=${props.subs.url}\n` +
    `OPENOBSERVE_ORG=${props.subs.org}\n` +
    `OPENOBSERVE_AUTH_TOKEN=Basic ${props.subs.token}\n`;
  const blob = new Blob([body], { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = ".env";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

// ── presentation helpers ─────────────────────────────────────────────────────
const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// Inline markdown: **bold** + `code` only (escaped first → safe for v-html).
const inlineMd = (s: string) =>
  escapeHtml(s)
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");

// Step notes additionally support in-card jump links: `[label](#advanced)` and
// `[label](#troubleshooting)` render as anchors that OPEN the target accordion
// and scroll to it — the sections sit below the detection status bar, so a
// plain "see X below" leaves the user hunting. The href is a literal "#" and
// the target comes from a fixed alternation, so authored content can't inject a
// URL here (inlineMd has already escaped everything else).
const JUMP_LINK_RE = /\[([^\]]+)\]\(#(advanced|troubleshooting)\)/g;
const noteMd = (s: string) =>
  inlineMd(s).replace(
    JUMP_LINK_RE,
    (_m, label, target) =>
      `<a href="#" class="note-jump" data-jump="${target}">${label}</a>`,
  );

// Delegated so the anchors rendered by v-html above stay clickable.
const onNoteClick = (e: MouseEvent) => {
  const el = (e.target as HTMLElement)?.closest?.("[data-jump]") as
    | HTMLElement
    | null;
  if (!el) return;
  e.preventDefault();
  if (el.dataset.jump === "advanced") openAdvanced();
  else if (el.dataset.jump === "troubleshooting") openTroubleshooting();
};

const chipIcon = (kind: StepChipKind) =>
  ({ terminal: "", editor: "code", run: "play-arrow", traces: "timeline" })[
    kind
  ];
// A code block with a filename is a file, not a shell command — render it with
// editor chrome even under a terminal-chip step. Needed when one step mixes
// command and file variants (e.g. RUM's npm install vs CDN HTML snippet).
const codeChrome = (step: RichCardStep): "terminal" | "editor" =>
  !displayCode(step)?.filename && step.chip?.kind === "terminal"
    ? "terminal"
    : "editor";

const extras = computed(() => props.content.extras ?? {});
const hasInstallerAccordion = computed(
  () => !!(extras.value.installs?.length || extras.value.envVars?.length),
);

// Open a bottom accordion (controlled via v-model) and scroll it into view —
// used by the fix box's "See All Troubleshooting" and by step-note jump links.
const scrollIntoViewSoon = (target: { $el?: HTMLElement } | null) =>
  nextTick(() =>
    target?.$el?.scrollIntoView({
      behavior: prefersReducedMotion() ? "auto" : "smooth",
      block: "start",
    }),
  );

const troubleshootingOpen = ref(false);
const troubleshootingRef = ref<any>(null);
const openTroubleshooting = () => {
  troubleshootingOpen.value = true;
  scrollIntoViewSoon(troubleshootingRef.value);
};

const advancedOpen = ref(false);
const advancedRef = ref<any>(null);
const openAdvanced = () => {
  advancedOpen.value = true;
  scrollIntoViewSoon(advancedRef.value);
};

// ── confetti (canvas burst on connect) ───────────────────────────────────────
const CONFETTI_COLORS = ["#d97757", "#16a34a", "#2b7de9", "#f5b53d", "#7c3aed"];
// Track the active animation frame so rapid re-triggers can't stack overlapping
// rAF loops (which would drop frames and leak canvas work).
let confettiRaf = 0;
function fireConfetti() {
  const cv = confettiCanvas.value;
  if (!cv || prefersReducedMotion()) return;
  cancelAnimationFrame(confettiRaf); // cancel any in-flight burst
  const ctx = cv.getContext("2d");
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  cv.width = window.innerWidth * dpr;
  cv.height = window.innerHeight * dpr;
  ctx.scale(dpr, dpr);
  const cx = window.innerWidth * 0.62;
  const cy = window.innerHeight * 0.42;
  const parts = Array.from({ length: 130 }, () => {
    const ang = Math.random() * Math.PI * 2;
    const sp = 4 + Math.random() * 9;
    return {
      x: cx,
      y: cy,
      vx: Math.cos(ang) * sp,
      vy: Math.sin(ang) * sp - 4,
      r: 3 + Math.random() * 5,
      c: CONFETTI_COLORS[(Math.random() * CONFETTI_COLORS.length) | 0],
      rot: Math.random() * 6,
      vr: (Math.random() - 0.5) * 0.4,
      life: 1,
    };
  });
  let t = 0;
  const frame = () => {
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    t++;
    let alive = false;
    parts.forEach((p) => {
      p.vy += 0.22;
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.99;
      p.rot += p.vr;
      p.life -= 0.011;
      if (p.life > 0 && p.y < window.innerHeight + 40) {
        alive = true;
        ctx.save();
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.c;
        ctx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * 1.6);
        ctx.restore();
      }
    });
    if (alive && t < 260) confettiRaf = requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  };
  confettiRaf = requestAnimationFrame(frame);
}
</script>

<template>
  <div class="dirC-demo" :class="{ dark: isDark }" data-test="ai-rich-setup-card">
    <div class="dirC">
      <!-- Hero -->
      <div class="c-hero">
        <div class="c-hero-head">
          <span class="ds-mono xl" :class="{ logo: logoSrc }">
            <img
              v-if="logoSrc"
              :src="logoSrc"
              :alt="`${content.provider.name} logo`"
              loading="lazy"
              referrerpolicy="no-referrer"
              @error="logoFailed = true"
            />
            <template v-else>{{ content.provider.name.charAt(0) }}</template>
          </span>
          <h1 class="c-h1">{{ content.provider.name }}</h1>
          <!-- Optional control sitting just after the title, spaced off it
               (e.g. RUM's Browser / React Native platform switch). Renders only
               when a host page fills it, so other cards are untouched. -->
          <div
            v-if="$slots['hero-actions']"
            class="ms-2 shrink-0"
            data-test="ai-hero-actions"
          >
            <slot name="hero-actions" />
          </div>
        </div>
        <p class="c-sub">{{ content.provider.tagline }}</p>
        <div class="pv-meta">
          <OTag
            v-if="content.provider.runtime"
            type="setupCardMeta"
            value="runtime"
            >{{ content.provider.runtime }}</OTag
          >
          <OTag
            v-if="content.provider.setupTime"
            type="setupCardMeta"
            value="setuptime"
            >{{ content.provider.setupTime }} setup</OTag
          >
          <template v-if="content.provider.metaBadges">
            <OTag
              v-for="b in content.provider.metaBadges"
              :key="b"
              type="setupCardMeta"
              value="meta"
              >{{ b }}</OTag
            >
          </template>
          <OTag v-else type="setupCardMeta" value="cost" />
        </div>
      </div>

      <!-- Optional stream-name input — flows into the install command + detection -->
      <div v-if="content.streamInput" class="c-config" data-test="ai-stream-config">
        <OInput
          v-model="streamName"
          :label="content.streamInput.label"
          :placeholder="content.streamInput.placeholder || content.streamInput.default"
          :help-text="!streamNameError ? content.streamInput.help : undefined"
          :error="!!streamNameError"
          :error-message="streamNameError"
          size="sm"
          width="md"
          data-test="ai-stream-name-input"
        />
      </div>

      <!-- Steps — lib OStepper in expanded (checklist) mode: all panels visible,
           each step independently `done`, the first not-done step highlighted. -->
      <OStepper
        :model-value="activeStepNumber"
        orientation="vertical"
        expanded
        :animated="false"
        class="steps"
      >
        <OStep
          v-for="(step, i) in content.steps"
          :key="step.id"
          :name="i + 1"
          :title="step.title"
          :done="isStepDone(step)"
          :data-test="`ai-step-${step.id}`"
        >
          <template v-if="step.chip" #title-suffix>
            <OTag
              type="stepChip"
              :value="step.required ? 'required' : 'optional'"
              :icon="step.chip.kind === 'terminal' ? undefined : chipIcon(step.chip.kind)"
            >
              <template v-if="step.chip.kind === 'terminal'" #icon>
                <span class="step-tag-glyph">$_</span>
              </template>
              {{ step.chip.label }}
            </OTag>
          </template>

          <div class="step-content-pad" :ref="(el) => setStepRef(el, i)">
            <p class="step-desc" v-html="inlineMd(step.description)"></p>

            <!-- Per-step inputs (e.g. host/port) — fill {id} in this step's code -->
            <div
              v-if="step.inputs?.length"
              class="step-inputs"
              :data-test="`ai-step-inputs-${step.id}`"
            >
              <OInput
                v-for="inp in step.inputs"
                :key="inp.id"
                v-model="inputValues[inp.id]"
                :label="inp.label"
                :placeholder="inp.placeholder || inp.default"
                :help-text="inp.help"
                size="sm"
                :width="inp.width || 'md'"
                :data-test="`ai-input-${inp.id}`"
              />
            </div>

            <!-- Variant selector (e.g. OS/arch) — shared OToggleGroup; swaps the
                 code block below. Hidden on follower steps (variantToggle:false),
                 which instead follow their group's selection. -->
            <div
              v-if="step.variants?.length && step.variantToggle !== false"
              class="variant-tabs"
              data-test="ai-variant-tabs"
            >
              <OToggleGroup
                :model-value="currentVariantId(step)"
                @update:model-value="(v) => selectVariant(variantKey(step), v)"
              >
                <OToggleGroupItem
                  v-for="v in step.variants"
                  :key="v.id"
                  :value="v.id"
                  size="sm"
                  :data-test="`ai-variant-${v.id}`"
                >
                  <template v-if="v.icon" #icon-left>
                    <img
                      :src="v.icon"
                      alt=""
                      aria-hidden="true"
                      class="variant-icon"
                      :class="{ 'variant-icon-invert': v.iconInvertDark }"
                    />
                  </template>
                  {{ v.label }}
                </OToggleGroupItem>
              </OToggleGroup>
            </div>

            <OCodeBlock
              v-if="displayCode(step)"
              :lang="displayCode(step)?.lang"
              :chrome="codeChrome(step)"
              :filename="displayCode(step)?.filename"
              :code="subStream(displayCode(step)?.raw) || ''"
              :code-masked="subStream(displayCode(step)?.masked)"
              data-test="ai-code"
              reveal-tooltip="Reveal Token"
              hide-tooltip="Hide Token"
              @copy="onStepCopy(step, i)"
            >
              <template v-if="displayCode(step)?.downloadEnv" #actions>
                <OButton
                  data-test="ai-code-env-btn"
                  variant="ghost"
                  size="icon-xs-sq"
                  @click="downloadEnv"
                >
                  <OIcon name="download" size="sm" />
                  <OTooltip content="Download .env" side="top" />
                </OButton>
              </template>
            </OCodeBlock>

            <p
              v-if="currentVariantNote(step)"
              class="step-note"
              @click="onNoteClick"
            >
              <OIcon name="info-outline" size="sm" />
              <span v-html="noteMd(currentVariantNote(step) || '')"></span>
            </p>
            <p v-if="step.note" class="step-note" @click="onNoteClick">
              <OIcon name="info-outline" size="sm" />
              <span v-html="noteMd(step.note)"></span>
            </p>

            <!-- Page-supplied controls for this step (region pickers, service
                 checkboxes …). Lets a page own the interaction while inheriting
                 the card's hero, stepper and chrome instead of rebuilding them. -->
            <div
              v-if="$slots[`step-${step.id}`]"
              class="step-slot"
              :data-test="`ai-step-slot-${step.id}`"
            >
              <slot :name="`step-${step.id}`" :step="step" />
            </div>

            <!-- Action button — for steps performed in a cloud console rather
                 than by copying a command. -->
            <div v-if="step.action" class="step-action">
              <OButton
                :variant="step.action.variant || 'primary'"
                size="sm-action"
                :icon-left="step.action.icon"
                :disabled="step.action.disabled"
                :data-test="`ai-step-action-${step.action.id}`"
                @click="onStepAction(step, i)"
              >
                {{ step.action.label }}
              </OButton>
            </div>

            <div v-if="step.pills?.length" class="pill-list mt-2">
              <OTag
                v-for="p in step.pills"
                :key="p"
                type="fieldTag"
                value="softsm"
                >{{ p }}</OTag
              >
            </div>

            <!-- Live status bar + fix box on the detection-anchor step -->
            <template v-if="step.detectionAnchor">
              <div
                class="statusbar mt-3"
                :class="detect.state.value"
                data-test="ai-c-statusbar"
              >
                <span class="sb-dot" />
                <span v-if="detect.idle.value" class="sb-txt"
                  >Not Tested Yet<span class="sb-sub"
                    >start ingesting, then test for {{ dataNoun }}</span
                  ></span
                >
                <span v-else-if="detect.checking.value" class="sb-txt"
                  >Checking for {{ dataNoun }}…<span class="sb-sub"
                    >on {{ watchedStream }}</span
                  ></span
                >
                <span v-else-if="detect.connected.value" class="sb-txt"
                  >{{ connectedHeadline }}<span class="sb-sub"
                    >{{ detect.count.value }} {{ countUnit
                    }}{{ detect.count.value === 1 ? "" : "s"
                    }}<template v-if="content.detect.modelLabel">
                      · {{ content.detect.modelLabel }}</template
                    ></span
                  ></span
                >
                <span v-else class="sb-txt sb-warn"
                  >No {{ dataNoun }} Found Yet<span class="sb-sub"
                    >nothing on {{ watchedStream }} — run your app and test
                    again</span
                  ></span
                >

                <OButton
                  v-if="detect.idle.value"
                  variant="primary"
                  size="sm"
                  icon-left="radio-button-checked"
                  data-test="ai-c-test"
                  @click="detect.check()"
                >
                  Test
                </OButton>
                <OButton
                  v-else-if="detect.checking.value"
                  variant="secondary"
                  size="sm"
                  :loading="true"
                  data-test="ai-c-checking"
                >
                  Checking…
                </OButton>
                <OButton
                  v-else-if="detect.connected.value"
                  variant="primary"
                  size="sm"
                  :icon-left="viewDataIcon"
                  data-test="ai-c-traces"
                  @click="viewData()"
                >
                  {{ viewDataLabel }}
                </OButton>
                <OButton
                  v-else-if="detect.stalled.value"
                  variant="secondary"
                  size="sm"
                  icon-left="refresh"
                  data-test="ai-c-recheck"
                  @click="detect.check()"
                >
                  Test Again
                </OButton>
              </div>

              <div v-if="showFixHint" class="fixbox mt-3">
                <div class="fixbox-h">
                  <OIcon name="warning" size="sm" /> Most Likely Fix —
                  {{ extras.fixTitle || "Instrument Before Importing The Client" }}
                </div>
                <p class="fixbox-p">
                  {{
                    extras.fixBody ||
                    "If your app runs but no spans arrive, instrumentation likely loaded after the client was imported. Re-order so the init runs first:"
                  }}
                </p>
                <OCodeBlock
                  :lang="extras.fixLang || 'python'"
                  :code="extras.fixSnippet || ''"
                  data-test="ai-fix-code"
                />
                <div class="fixbox-actions">
                  <OButton
                    variant="primary"
                    size="sm"
                    icon-left="refresh"
                    data-test="ai-c-fix-recheck"
                    @click="detect.check()"
                  >
                    I Fixed It — Test Again
                  </OButton>
                  <OButton
                    v-if="extras.troubleshooting?.length"
                    variant="ghost-primary"
                    size="sm"
                    data-test="ai-c-see-troubleshooting"
                    @click="openTroubleshooting()"
                  >
                    See All Troubleshooting
                  </OButton>
                </div>
              </div>
            </template>
          </div>
        </OStep>
      </OStepper>

      <!-- Supplementary accordions (shared OCollapsible) -->
      <div
        v-if="hasInstallerAccordion || extras.advanced || extras.troubleshooting?.length"
        class="c-more"
      >
        <!-- Alternative manual path (e.g. the raw Helm sequence) — collapsed, so
             the stepped primary path above stays the obvious default. -->
        <OCollapsible
          v-if="extras.advanced"
          ref="advancedRef"
          v-model="advancedOpen"
          :label="extras.advanced.label"
          icon="settings"
          class="acc-item"
          data-test="ai-advanced-accordion"
        >
          <div class="acc-body">
            <p
              v-if="extras.advanced.description"
              class="step-desc"
              v-html="inlineMd(extras.advanced.description)"
            ></p>
            <OCodeBlock
              :lang="extras.advanced.code.lang"
              :chrome="extras.advanced.code.filename ? 'editor' : 'terminal'"
              :filename="extras.advanced.code.filename"
              :code="subStream(extras.advanced.code.raw) || ''"
              :code-masked="subStream(extras.advanced.code.masked)"
              data-test="ai-advanced-code"
              reveal-tooltip="Reveal Token"
              hide-tooltip="Hide Token"
            />
          </div>
        </OCollapsible>

        <OCollapsible
          v-if="hasInstallerAccordion"
          label="What The Installer Does"
          icon="layers"
          class="acc-item"
        >
          <div class="acc-body">
            <template v-if="extras.installs?.length">
              Installs via pip and verifies imports:
              <div class="pill-list mt-2">
                <OTag
                  v-for="p in extras.installs"
                  :key="p"
                  type="fieldTag"
                  value="softsm"
                  >{{ p }}</OTag
                >
              </div>
            </template>
            <template v-if="extras.envVars?.length">
              <div class="mt-3">
                Writes these keys to <code>./.env</code> (idempotent):
              </div>
              <div class="pill-list mt-2">
                <OTag
                  v-for="p in extras.envVars"
                  :key="p"
                  type="fieldTag"
                  value="softsm"
                  >{{ p }}</OTag
                >
              </div>
            </template>
          </div>
        </OCollapsible>

        <OCollapsible
          v-if="extras.troubleshooting?.length"
          ref="troubleshootingRef"
          v-model="troubleshootingOpen"
          label="Troubleshooting"
          icon="help-outline"
          class="acc-item"
        >
          <div class="acc-body">
            <div
              v-for="(r, i) in extras.troubleshooting"
              :key="i"
              class="ts-row"
            >
              <div class="ts-q"><OIcon name="warning" size="sm" /> {{ r.q }}</div>
              <div class="ts-a" v-html="inlineMd(r.a)"></div>
            </div>
          </div>
        </OCollapsible>
      </div>

      <!-- Footer -->
      <div class="pv-foot">
        <OIcon name="open-in-new" size="sm" /> Full integration docs:&nbsp;
        <a
          :href="safeHttpUrl(content.docUrl)"
          target="_blank"
          rel="noopener noreferrer"
          >{{ content.provider.name }} →</a
        >
        <!-- Secondary guides (e.g. GCP's Google Workspace page) — real anchors,
             beside the primary doc link rather than buried in an accordion. -->
        <template v-for="l in content.docLinks" :key="l.url">
          <span class="pv-foot-sep" aria-hidden="true">·</span>
          <a
            :href="safeHttpUrl(l.url)"
            target="_blank"
            rel="noopener noreferrer"
            :data-test="`ai-doc-link-${l.label.toLowerCase().replace(/\s+/g, '-')}`"
            >{{ l.label }} →</a
          >
        </template>
        <span v-if="content.slackUrl" class="ml-auto"
          >Stuck?
          <a
            :href="safeHttpUrl(content.slackUrl)"
            target="_blank"
            rel="noopener noreferrer"
            >Ask on Slack</a
          ></span
        >
      </div>
    </div>

    <canvas ref="confettiCanvas" class="dirC-confetti" />
  </div>
</template>

<style scoped lang="scss">
/* keep(complex-state): the statusbar/fixbox state machine (idle→checking→
   connected/stalled) plus its radar keyframes and OStepper/OCollapsible :deep()
   content styling — not expressible as template utilities. */

/* The card's local aliases are thin names over the GLOBAL semantic tokens, so a
   change to a semantic value propagates here too. They resolve per-theme on their
   own — no local .dark overrides. (.dark stays on the root only for the
   monochrome-glyph invert rule below.) */
.dirC-demo {
  /* Accent follows the app theme color (--color-theme-accent), not a fixed brand hue.
     Soft tints are translucent so they read on both light + dark panels. */
  --clay: var(--color-theme-accent);
  --clay-bright: var(--color-theme-accent);
  --clay-soft: color-mix(in srgb, var(--color-theme-accent) 16%, transparent);
  --clay-soft-2: color-mix(in srgb, var(--color-theme-accent) 8%, transparent);

  --ok: var(--color-status-positive);
  --ok-soft: var(--color-status-success-bg);
  /* --color-warning is amber in both themes; --color-warning-surface is an
     alpha tint, so it reads over the light panel and the dark one alike. */
  --warn: var(--color-warning);
  --warn-soft: var(--color-warning-surface);
  --warn-ink: var(--color-warning);

  --panel: var(--color-surface-base);
  --border: var(--color-border-default);
  --text-1: var(--color-text-heading);
  --text-2: var(--color-text-secondary);
  --text-3: var(--color-text-label);
  --primary-ink: var(--color-text-link);
  --track: var(--color-surface-subtle);

  color: var(--text-1);
  font-size: var(--text-sm);
}

/* ---- layout ---- */
.dirC {
  max-width: 61.25rem;
  /* Left-align the reading column (not centered) so it sits against the panel's
     left edge, consistent across AI integrations and data-source cards. */
  margin: 0;
  padding: 0.25rem 0.25rem 0;
}

/* ---- logo tile ---- */
.ds-mono {
  width: 1.625rem;
  height: 1.625rem;
  flex: none;
  border-radius: var(--radius-default);
  display: grid;
  place-items: center;
  font-weight: 800;
  font-size: var(--text-xs);
  /* The tile is filled with the theme accent, so the monogram is always knocked out. */
  color: var(--color-white);
  letter-spacing: -0.02em;
  background: var(--clay-bright);
}
.ds-mono.xl {
  width: 2.875rem;
  height: 2.875rem;
  border-radius: var(--radius-surface);
  font-size: var(--text-xl);
}
.ds-mono.logo {
  background: var(--panel);
  border: 1px solid var(--border);
  padding: 0.5rem;
}
.ds-mono.logo img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: contain;
}

/* ---- hero — its own header band: [logo + name] row, then tagline + chips ---- */
.c-hero {
  padding: 0.375rem 0 1.125rem;
  border-bottom: 1px solid var(--border);
  margin-bottom: 1.375rem;
}
.c-hero-head {
  display: flex;
  align-items: center;
  gap: 0.875rem;
}
.c-h1 {
  font-weight: 800;
  font-size: var(--text-2xl);
  letter-spacing: -0.02em;
  margin: 0;
  line-height: 1.1;
}
.c-sub {
  color: var(--text-2);
  font-size: var(--text-sm);
  margin: 0.625rem 0 0;
}
/* Hero meta chips are now <OTag> (lib) — just lay them out. */
.pv-meta {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-top: 0.6875rem;
}

/* ---- stream-name config input ---- */
/* Left-aligned field with breathing room before the steps (no divider). */
.c-config {
  margin-bottom: 1.75rem;
}
.c-config :deep(label) {
  margin-bottom: 0.125rem;
}
/* Keep the hint on one line — it overflows the field into the empty space to its
   right rather than wrapping (the input box itself stays md width). */
.c-config :deep(.text-input-hint) {
  white-space: nowrap;
}

/* ---- per-step free-form inputs (host/port …) — wrapping row above the code ---- */
.step-inputs {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  align-items: flex-start;
  margin: 0.25rem 0 0.875rem;
}
.step-inputs :deep(label) {
  margin-bottom: 0.125rem;
}

/* ---- steps (lib OStepper in expanded mode) — only the per-step body content
   is styled here; the rail (indicator/connector/title) comes from OStepper. ---- */
.steps {
  margin-top: 0;
}
/* Step context chip is now <OTag> (lib). Only the terminal "$_" glyph (used
   in the badge's #icon slot) keeps a monospace style. */
.step-tag-glyph {
  font-weight: 800;
  font-size: var(--text-2xs);
}
.step-desc {
  color: var(--text-2);
  font-size: var(--text-compact);
  margin: 0 0 0.625rem;
  line-height: 1.45;
}
.step-note {
  display: flex;
  align-items: flex-start;
  gap: 0.4375rem;
  color: var(--text-3);
  font-size: var(--text-xs);
  line-height: 1.5;
  margin: 0.625rem 0 0;
}

/* ---- page-supplied step content + action button ---- */
.step-slot {
  margin: 0.25rem 0 0.875rem;
}
.step-action {
  margin-top: 0.875rem;
}

/* ---- variant toggle (shared OToggleGroup) — only spacing + icon sizing here;
   the toggle's own visuals come from the design system. ---- */
.variant-tabs {
  margin: 0 0 0.875rem;
}
.variant-icon {
  width: 0.875rem;
  height: 0.875rem;
  object-fit: contain;
  flex: none;
}
/* Monochrome black glyphs (e.g. the Apple logo) would vanish on the dark panel —
   invert them to white in dark mode. */
.dirC-demo.dark .variant-icon-invert {
  filter: invert(1);
}
.step-note :deep(svg) {
  flex: none;
  margin-top: 1px;
}
/* In-card jump link (see noteMd) — same treatment as the footer's doc link. */
.step-note :deep(a.note-jump) {
  color: var(--primary-ink);
  font-weight: 700;
  text-decoration: none;
  cursor: pointer;
}
.step-note :deep(a.note-jump:hover) {
  text-decoration: underline;
}
.step-content-pad :deep(code),
.step-desc :deep(code) {
  font-size: var(--text-xs);
  background: var(--track);
  color: var(--text-1);
  padding: 1px 0.375rem;
  border-radius: var(--radius-default);
}

/* ---- status bar ---- */
.statusbar {
  display: flex;
  align-items: center;
  gap: 0.8125rem;
  margin-top: 0.875rem;
  padding: 0.8125rem 1.125rem;
  border-radius: var(--radius-surface);
  border: 1px solid var(--border);
  background: var(--panel);
  transition: all 0.3s;
}
.statusbar.checking {
  border-color: var(--clay-soft);
  background: var(--clay-soft-2);
}
.statusbar.connected {
  border-color: color-mix(in srgb, var(--ok) 45%, var(--border));
  background: var(--ok-soft);
}
.statusbar.stalled {
  border-color: color-mix(in srgb, var(--warn) 45%, var(--border));
  background: var(--warn-soft);
}
.sb-dot {
  width: 0.6875rem;
  height: 0.6875rem;
  border-radius: var(--radius-full);
  flex: none;
  position: relative;
}
.statusbar.idle .sb-dot {
  background: var(--text-3);
}
.statusbar.checking .sb-dot {
  background: var(--clay-bright);
}
.statusbar.checking .sb-dot::after {
  content: "";
  position: absolute;
  inset: -0.3125rem;
  border-radius: var(--radius-full);
  border: 0.125rem solid var(--clay-bright);
  animation: dirc-radar 1.6s ease-out infinite;
}
.statusbar.connected .sb-dot {
  background: var(--ok);
}
.statusbar.stalled .sb-dot {
  background: var(--warn);
}
.sb-txt {
  font-weight: 700;
  font-size: var(--text-compact);
  flex: 1;
}
.statusbar.checking .sb-txt {
  color: var(--clay);
}
.statusbar.connected .sb-txt {
  color: var(--ok);
}
.sb-txt.sb-warn {
  color: var(--warn-ink);
}
.sb-txt .sb-sub {
  font-weight: 600;
  color: var(--text-3);
  font-size: var(--text-xs);
  margin-left: 0.5rem;
}
/* Status-bar actions use the shared <OButton variant="secondary"> component. */

/* ---- fix box ---- */
.fixbox {
  border: 1px solid color-mix(in srgb, var(--warn) 38%, var(--border));
  border-radius: var(--radius-surface);
  background: var(--warn-soft);
  padding: 0.9375rem 1rem;
  animation: dirc-rise 0.35s ease;
}
.fixbox-h {
  display: flex;
  align-items: center;
  gap: 0.5625rem;
  font-weight: 800;
  font-size: var(--text-sm);
  color: var(--warn-ink);
}
.fixbox-h :deep(svg) {
  color: var(--warn);
  flex: none;
}
.fixbox-p {
  color: var(--text-2);
  font-size: var(--text-compact);
  line-height: 1.55;
  margin: 0.5625rem 0 0.75rem;
}
.fixbox-actions {
  display: flex;
  align-items: center;
  gap: 0.875rem;
  margin-top: 0.8125rem;
}
/* ---- accordions (OCollapsible) ---- */
/* These sit at the very bottom of a long card, after the detection status bar.
   OCollapsible's default trigger is borderless and background-less, which reads
   as stray body text down there — give each one the same bordered panel as
   .statusbar / .fixbox so it registers as a real, clickable section. */
.c-more {
  margin-top: 0.875rem;
}
.acc-item {
  border: 1px solid var(--border);
  border-radius: 0.75rem;
  background: var(--panel);
  overflow: hidden;
}
.acc-item + .acc-item {
  margin-top: 0.5rem;
}
/* Roomier hit area than the component's default px-2 py-2 inside a panel. */
.acc-item :deep(button) {
  padding: 0.8125rem 1rem;
  border-radius: 0;
}
.acc-body {
  color: var(--text-2);
  font-size: var(--text-compact);
  line-height: 1.6;
  padding: 0 1rem 1rem;
}
.acc-body :deep(code) {
  font-size: var(--text-2xs);
  background: var(--track);
  color: var(--text-1);
  padding: 1px 0.3125rem;
  border-radius: var(--radius-default);
}

/* ---- pills (now <OTag>) — just lay them out ---- */
.pill-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
}

/* ---- troubleshooting ---- */
.ts-row {
  padding: 0.6875rem 0;
  border-bottom: 1px dashed var(--border);
}
.ts-row:last-child {
  border-bottom: none;
}
.ts-q {
  display: flex;
  align-items: flex-start;
  gap: 0.5625rem;
  font-weight: 700;
  font-size: var(--text-compact);
  color: var(--text-1);
}
.ts-q :deep(svg) {
  color: var(--warn);
  flex: none;
  margin-top: 1px;
}
.ts-a {
  color: var(--text-2);
  font-size: var(--text-compact);
  line-height: 1.55;
  margin: 0.375rem 0 0 1.4375rem;
}

/* ---- footer ---- */
.pv-foot {
  margin-top: 1rem;
  padding-top: 0.875rem;
  border-top: 1px solid var(--border);
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: var(--text-compact);
  color: var(--text-2);
}
.pv-foot a {
  color: var(--primary-ink);
  font-weight: 700;
  text-decoration: none;
}
.pv-foot a:hover {
  text-decoration: underline;
}
.pv-foot-sep {
  color: var(--text-3);
  margin: 0 0.125rem;
}

/* ---- confetti overlay ---- */
.dirC-confetti {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 60;
}

@keyframes dirc-radar {
  0% {
    transform: scale(0.35);
    opacity: 0.65;
  }
  100% {
    transform: scale(1);
    opacity: 0;
  }
}
@keyframes dirc-rise {
  from {
    opacity: 0;
    transform: translateY(0.5rem);
  }
}

@media (prefers-reduced-motion: reduce) {
  .statusbar .sb-dot::after,
  .fixbox {
    animation: none !important;
  }
}
</style>
