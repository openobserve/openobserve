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
  AIRichSetupCard — generic, content-driven rich setup card for AI integrations.

  Purely presentational: everything (hero, ordered steps, context chips, code
  chrome, supplementary accordions, footer) is rendered from a RichCardContent
  object (see ./types.ts, ./registry.ts). Detection ("listening for the first
  span") is delegated to useSpanDetect — live polling in production, or a
  simulated Succeeds/Stalls flow when `demo` is set.

  Add a provider by authoring a RichCardContent — no edits here.
-->
<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useStore } from "vuex";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";
import CodeBlock from "../CodeBlock.vue";
import type { CardSubstitutions } from "../renderMarkdown";
import type { RichCardContent, RichCardStep, StepChipKind } from "./types";
import { useSpanDetect, prefersReducedMotion } from "./useSpanDetect";

const props = defineProps<{
  /** The integration's rich content (already token-substituted). */
  content: RichCardContent;
  /** Per-org url/org/token — used for the .env download + detection org. */
  subs: CardSubstitutions;
  /** Optional logo URL (e.g. from the manifest) — overrides the content logo. */
  logoUrl?: string;
}>();

const store = useStore();
const isDark = computed(() => store.state?.theme === "dark");

// Logo precedence: manifest override → content (frontmatter/bundled) → none.
// `logoFailed` falls back to the monogram if the remote image can't load.
const logoFailed = ref(false);
const logoSrc = computed(() =>
  logoFailed.value ? "" : props.logoUrl || props.content.provider.logo,
);

const confettiCanvas = ref<HTMLCanvasElement | null>(null);

const detect = useSpanDetect({
  config: () => ({
    orgId: props.subs.org,
    streamType: props.content.detect.streamType,
    streamName: props.content.detect.streamName,
    filter: props.content.detect.filter,
    pollMs: props.content.detect.pollMs,
    timeoutMs: props.content.detect.timeoutMs,
  }),
  onConnect: () => fireConfetti(),
});
const detected = computed(() => detect.connected.value);

// ── step completion / active-step model ─────────────────────────────────────
const copied = ref<Record<string, boolean>>({});
const isStepDone = (step: RichCardStep) =>
  step.completeOn === "copy" ? !!copied.value[step.id] : detected.value;

// First not-done step is "active"; -1 once everything is done.
const activeIndex = computed(() =>
  props.content.steps.findIndex((s) => !isStepDone(s)),
);
const stepState = (i: number) => {
  if (isStepDone(props.content.steps[i])) return "done";
  return activeIndex.value === i ? "active" : "pending";
};

const copyStepIds = computed(() =>
  props.content.steps.filter((s) => s.completeOn === "copy").map((s) => s.id),
);
const allCopyDone = computed(() =>
  copyStepIds.value.every((id) => copied.value[id]),
);

// Begin listening automatically once the app is instrumented (all copy-steps
// done). The status-bar Start button is the manual fallback.
watch(allCopyDone, (done) => {
  if (done && detect.idle.value) detect.start();
});

// ── next-step auto-advance scroll ────────────────────────────────────────────
const stepEls = ref<(HTMLElement | null)[]>([]);
const setStepRef = (el: unknown, i: number) => {
  stepEls.value[i] = (el as HTMLElement) ?? null;
};
const scrollToStep = (i: number) => {
  const el = stepEls.value[i];
  if (el)
    el.scrollIntoView({
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

const chipIcon = (kind: StepChipKind) =>
  ({ terminal: "", editor: "code", run: "play-arrow", traces: "timeline" })[
    kind
  ];
const codeChrome = (step: RichCardStep): "terminal" | "editor" =>
  step.chip?.kind === "terminal" ? "terminal" : "editor";

const extras = computed(() => props.content.extras ?? {});
const hasInstallerAccordion = computed(
  () => !!(extras.value.installs?.length || extras.value.envVars?.length),
);

// ── confetti (canvas burst on connect) ───────────────────────────────────────
const CONFETTI_COLORS = ["#d97757", "#16a34a", "#2b7de9", "#f5b53d", "#7c3aed"];
function fireConfetti() {
  const cv = confettiCanvas.value;
  if (!cv || prefersReducedMotion()) return;
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
    if (alive && t < 260) requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  };
  requestAnimationFrame(frame);
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
        </div>
        <p class="c-sub">{{ content.provider.tagline }}</p>
        <div class="pv-meta">
            <span v-if="content.provider.runtime" class="pv-chip"
              ><OIcon name="code" size="xs" /> {{ content.provider.runtime }}</span
            >
            <span v-if="content.provider.setupTime" class="pv-chip time"
              ><OIcon name="schedule" size="xs" />
              {{ content.provider.setupTime }} setup</span
            >
            <span class="pv-chip"
              ><OIcon name="attach-money" size="xs" /> Cost &amp; Tokens
              Captured</span
            >
        </div>
      </div>

      <!-- Steps -->
      <div class="steps">
        <div
          v-for="(step, i) in content.steps"
          :key="step.id"
          :ref="(el) => setStepRef(el, i)"
          class="step"
          :class="stepState(i)"
          :data-test="`ai-step-${step.id}`"
        >
          <div class="step-rail">
            <div class="step-num">
              <OIcon v-if="isStepDone(step)" name="check" size="sm" /><template
                v-else
                >{{ i + 1 }}</template
              >
            </div>
            <div v-if="i < content.steps.length - 1" class="step-line" />
          </div>

          <div class="step-body" :class="{ 'tw:pb-0': i === content.steps.length - 1 }">
            <div class="step-head">
              <div class="step-title">{{ step.title }}</div>
              <span
                v-if="step.chip"
                class="step-tag"
                :class="{ req: step.required }"
              >
                <span v-if="step.chip.kind === 'terminal'" class="step-tag-glyph"
                  >$_</span
                >
                <OIcon v-else :name="chipIcon(step.chip.kind)" size="xs" />
                {{ step.chip.label }}
              </span>
            </div>

            <p class="step-desc" v-html="inlineMd(step.description)"></p>

            <CodeBlock
              v-if="step.code"
              :lang="step.code.lang"
              :chrome="codeChrome(step)"
              :filename="step.code.filename"
              :code="step.code.raw"
              :code-masked="step.code.masked"
              :download-env="step.code.downloadEnv"
              @copy="onStepCopy(step, i)"
              @download-env="downloadEnv"
            />

            <p v-if="step.note" class="step-note">
              <OIcon name="info-outline" size="sm" /> {{ step.note }}
            </p>

            <div v-if="step.pills?.length" class="pill-list tw:mt-2">
              <span v-for="p in step.pills" :key="p" class="pkg-pill">{{ p }}</span>
            </div>

            <!-- Live status bar + fix box on the detection-anchor step -->
            <template v-if="step.detectionAnchor">
              <div
                class="statusbar tw:mt-3"
                :class="detect.state.value"
                data-test="ai-c-statusbar"
              >
                <span class="sb-dot" />
                <span v-if="detect.idle.value" class="sb-txt"
                  >Not Listening Yet<span class="sb-sub"
                    >run your app to start streaming spans</span
                  ></span
                >
                <span v-else-if="detect.listening.value" class="sb-txt"
                  >Listening for your first span…<span class="sb-sub"
                    >stream {{ subs.org }}</span
                  ></span
                >
                <span v-else-if="detect.connected.value" class="sb-txt"
                  >Connected — Traces Are Flowing<span class="sb-sub"
                    >{{ detect.count.value }} span{{
                      detect.count.value === 1 ? "" : "s"
                    }}<template v-if="content.detect.modelLabel">
                      · {{ content.detect.modelLabel }}</template
                    ></span
                  ></span
                >
                <span v-else class="sb-txt sb-warn"
                  >No Spans Yet After ~60s<span class="sb-sub"
                    >nothing detected on {{ subs.org }}</span
                  ></span
                >

                <OButton
                  v-if="detect.idle.value"
                  variant="primary"
                  size="sm"
                  icon-left="radio-button-checked"
                  data-test="ai-c-start"
                  @click="detect.start()"
                >
                  Start
                </OButton>
                <OButton
                  v-else-if="detect.listening.value"
                  variant="destructive"
                  size="sm"
                  icon-left="stop"
                  data-test="ai-c-stop"
                  @click="detect.stop()"
                >
                  Stop
                </OButton>
                <OButton
                  v-else-if="detect.connected.value"
                  variant="primary"
                  size="sm"
                  icon-left="timeline"
                  data-test="ai-c-traces"
                >
                  View Traces
                </OButton>
                <OButton
                  v-else-if="detect.stalled.value"
                  variant="secondary"
                  size="sm"
                  icon-left="refresh"
                  data-test="ai-c-recheck"
                  @click="detect.recheck()"
                >
                  Recheck
                </OButton>
              </div>

              <div
                v-if="detect.stalled.value && extras.fixSnippet"
                class="fixbox tw:mt-3"
              >
                <div class="fixbox-h">
                  <OIcon name="warning" size="sm" /> Most Likely Fix — Instrument
                  Before Importing The Client
                </div>
                <p class="fixbox-p">
                  If your app runs but no spans arrive, instrumentation likely
                  loaded <b>after</b> the client was imported. Re-order so the init
                  runs first:
                </p>
                <CodeBlock lang="python" :code="extras.fixSnippet" />
                <div class="fixbox-actions">
                  <OButton
                    variant="primary"
                    size="sm"
                    icon-left="refresh"
                    data-test="ai-c-fix-recheck"
                    @click="detect.recheck()"
                  >
                    I Fixed It — Recheck
                  </OButton>
                  <OButton variant="ghost-primary" size="sm">
                    See All Troubleshooting
                  </OButton>
                </div>
              </div>
            </template>
          </div>
        </div>
      </div>

      <!-- Supplementary accordions (shared OCollapsible) -->
      <div
        v-if="hasInstallerAccordion || extras.troubleshooting?.length"
        class="c-more"
      >
        <OCollapsible
          v-if="hasInstallerAccordion"
          label="What The Installer Does"
          icon="layers"
          class="acc-item"
        >
          <div class="acc-body">
            <template v-if="extras.installs?.length">
              Installs via pip and verifies imports:
              <div class="pill-list tw:mt-2">
                <span v-for="p in extras.installs" :key="p" class="pkg-pill">{{
                  p
                }}</span>
              </div>
            </template>
            <template v-if="extras.envVars?.length">
              <div class="tw:mt-3">
                Writes these keys to <code>./.env</code> (idempotent):
              </div>
              <div class="pill-list tw:mt-2">
                <span v-for="p in extras.envVars" :key="p" class="pkg-pill">{{
                  p
                }}</span>
              </div>
            </template>
          </div>
        </OCollapsible>

        <OCollapsible
          v-if="extras.troubleshooting?.length"
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
          :href="content.docUrl || '#'"
          target="_blank"
          rel="noopener noreferrer"
          >{{ content.provider.name }} →</a
        >
        <span v-if="content.slackUrl" class="tw:ml-auto"
          >Stuck?
          <a :href="content.slackUrl" target="_blank" rel="noopener noreferrer"
            >Ask on Slack</a
          ></span
        >
      </div>
    </div>

    <canvas ref="confettiCanvas" class="dirC-confetti" />
  </div>
</template>

<style scoped lang="scss">
/* Design tokens scoped to this card (light + dark), ported from the prototype. */
.dirC-demo {
  /* Accent follows the app theme color (--q-primary), not a fixed brand hue.
     Soft tints are translucent so they read on both light + dark panels. */
  --clay: var(--q-primary, #3f7994);
  --clay-bright: var(--q-primary, #3f7994);
  --clay-soft: color-mix(in srgb, var(--q-primary, #3f7994) 16%, transparent);
  --clay-soft-2: color-mix(in srgb, var(--q-primary, #3f7994) 8%, transparent);
  --ok: #16a34a;
  --ok-soft: #e6f4ec;
  --warn: #f59e0b;
  --warn-soft: #fdf3e2;
  --warn-ink: #b8740c;

  --panel: #ffffff;
  --panel-2: #fafbfc;
  --border: #e6e9ef;
  --border-2: #eef1f5;
  --text-1: #1f2a37;
  --text-2: #586575;
  --text-3: #8b95a4;
  --primary: #2b7de9;
  --primary-ink: #1a6fe0;
  --track: #eef1f5;
  --shadow: 0 1px 2px rgba(16, 24, 40, 0.04), 0 1px 3px rgba(16, 24, 40, 0.06);

  color: var(--text-1);
  font-size: 14px;

  &.dark {
    /* clay* inherit the theme-derived values from the base block above */
    --ok: #3ec574;
    --ok-soft: #14271c;
    --warn: #f5b53d;
    --warn-soft: #2a2113;
    --warn-ink: #f5b53d;

    --panel: #161b22;
    --panel-2: #1a2029;
    --border: #242b35;
    --border-2: #1f262f;
    --text-1: #e7ecf2;
    --text-2: #9aa6b3;
    --text-3: #67727f;
    --primary: #3b8ef0;
    --primary-ink: #59a2f5;
    --track: #232b35;
    --shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
  }
}

/* ---- layout ---- */
.dirC {
  max-width: 980px;
  margin: 0 auto;
  padding: 4px 4px 0;
}

/* ---- logo tile ---- */
.ds-mono {
  width: 26px;
  height: 26px;
  flex: none;
  border-radius: 7px;
  display: grid;
  place-items: center;
  font-weight: 800;
  font-size: 12px;
  color: #fff;
  letter-spacing: -0.3px;
  background: var(--clay-bright);
}
.ds-mono.xl {
  width: 46px;
  height: 46px;
  border-radius: 12px;
  font-size: 21px;
}
.ds-mono.logo {
  background: var(--panel);
  border: 1px solid var(--border);
  padding: 8px;
}
.ds-mono.logo img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: contain;
}

/* ---- hero — its own header band: [logo + name] row, then tagline + chips ---- */
.c-hero {
  padding: 6px 0 18px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 22px;
}
.c-hero-head {
  display: flex;
  align-items: center;
  gap: 14px;
}
.c-h1 {
  font-weight: 800;
  font-size: 24px;
  letter-spacing: -0.5px;
  margin: 0;
  line-height: 1.1;
}
.c-sub {
  color: var(--text-2);
  font-size: 14px;
  margin: 10px 0 0;
}
.pv-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 11px;
}
.pv-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 11px;
  border-radius: 20px;
  font-weight: 700;
  font-size: 12px;
  border: 1px solid var(--border);
  background: var(--panel);
  color: var(--text-2);
}
.pv-chip :deep(svg) {
  color: var(--text-3);
}
.pv-chip.time {
  border-color: var(--clay-soft);
  background: var(--clay-soft-2);
  color: var(--clay);
}
.pv-chip.time :deep(svg) {
  color: var(--clay-bright);
}
.dark .pv-chip.time {
  background: var(--clay-soft);
}

/* ---- numbered steps ---- */
.steps {
  margin-top: 0;
}
.step {
  display: flex;
  gap: 16px;
}
.step-rail {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex: none;
}
.step-num {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  flex: none;
  font-weight: 800;
  font-size: 15px;
  transition: background 0.25s, color 0.25s, border-color 0.25s;
}
.step.pending .step-num {
  background: var(--track);
  color: var(--text-3);
  border: 1.5px solid var(--border);
}
.step.active .step-num {
  background: var(--clay-bright);
  color: #fff;
  border: 1.5px solid var(--clay-bright);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--clay-bright) 22%, transparent);
}
.step.done .step-num {
  background: var(--ok);
  color: #fff;
  border: 1.5px solid var(--ok);
}
.step-line {
  flex: 1;
  width: 2px;
  background: var(--border);
  margin: 6px 0;
  border-radius: 2px;
  min-height: 16px;
  transition: background 0.25s;
}
.step.done .step-line {
  background: var(--ok);
}
.step.pending .step-title {
  color: var(--text-2);
}
.step.pending .step-desc,
.step.pending .step-note {
  opacity: 0.7;
}
.step.active .step-title {
  color: var(--clay);
}
.dark .step.active .step-title {
  color: var(--clay-bright);
}

.step-head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.step-tag {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 22px;
  padding: 0 9px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--panel-2);
  color: var(--text-3);
  font-weight: 700;
  font-size: 11px;
  letter-spacing: 0.02em;
}
.step-tag :deep(svg) {
  color: var(--text-3);
}
.step-tag-glyph {
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-weight: 800;
  font-size: 11px;
  color: var(--clay);
}
.step-tag.req {
  border-color: var(--clay-soft);
  background: var(--clay-soft-2);
  color: var(--clay);
}
.dark .step-tag.req {
  background: var(--clay-soft);
}
.step-tag.req :deep(svg) {
  color: var(--clay);
}
.step-body {
  flex: 1;
  min-width: 0;
  padding-bottom: 18px;
}
.step-title {
  font-weight: 800;
  font-size: 15.5px;
  margin: 4px 0 3px;
}
.step-desc {
  color: var(--text-2);
  font-size: 13px;
  margin: 0 0 10px;
  line-height: 1.45;
}
.step-note {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  color: var(--text-3);
  font-size: 12.5px;
  line-height: 1.5;
  margin: 10px 0 0;
}
.step-note :deep(svg) {
  flex: none;
  margin-top: 1px;
}
.step-desc :deep(code),
.step-body :deep(code) {
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 12px;
  background: var(--track);
  color: var(--text-1);
  padding: 1px 6px;
  border-radius: 5px;
}

/* ---- status bar ---- */
.statusbar {
  display: flex;
  align-items: center;
  gap: 13px;
  margin-top: 14px;
  padding: 13px 18px;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: var(--panel);
  transition: all 0.3s;
}
.statusbar.listening {
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
  width: 11px;
  height: 11px;
  border-radius: 50%;
  flex: none;
  position: relative;
}
.statusbar.idle .sb-dot {
  background: var(--text-3);
}
.statusbar.listening .sb-dot {
  background: var(--clay-bright);
}
.statusbar.listening .sb-dot::after {
  content: "";
  position: absolute;
  inset: -5px;
  border-radius: 50%;
  border: 2px solid var(--clay-bright);
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
  font-size: 13.5px;
  flex: 1;
}
.statusbar.listening .sb-txt {
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
  font-size: 12px;
  margin-left: 8px;
}
/* Status-bar actions use the shared <OButton variant="secondary"> component. */

/* ---- fix box ---- */
.fixbox {
  border: 1px solid color-mix(in srgb, var(--warn) 38%, var(--border));
  border-radius: 12px;
  background: var(--warn-soft);
  padding: 15px 16px;
  animation: dirc-rise 0.35s ease;
}
.fixbox-h {
  display: flex;
  align-items: center;
  gap: 9px;
  font-weight: 800;
  font-size: 14px;
  color: var(--warn-ink);
}
.fixbox-h :deep(svg) {
  color: var(--warn);
  flex: none;
}
.fixbox-p {
  color: var(--text-2);
  font-size: 13px;
  line-height: 1.55;
  margin: 9px 0 12px;
}
.fixbox-actions {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-top: 13px;
}
/* ---- accordions (OCollapsible) ---- */
.c-more {
  margin-top: 14px;
}
.acc-item + .acc-item {
  margin-top: 8px;
}
.acc-body {
  color: var(--text-2);
  font-size: 13px;
  line-height: 1.6;
}
.acc-body :deep(code) {
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 11.5px;
  background: var(--track);
  color: var(--text-1);
  padding: 1px 5px;
  border-radius: 4px;
}

/* ---- pills ---- */
.pill-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.pkg-pill {
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 11px;
  background: var(--track);
  color: var(--text-2);
  padding: 3px 8px;
  border-radius: 6px;
}

/* ---- troubleshooting ---- */
.ts-row {
  padding: 11px 0;
  border-bottom: 1px dashed var(--border);
}
.ts-row:last-child {
  border-bottom: none;
}
.ts-q {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  font-weight: 700;
  font-size: 13.5px;
  color: var(--text-1);
}
.ts-q :deep(svg) {
  color: var(--warn);
  flex: none;
  margin-top: 1px;
}
.ts-a {
  color: var(--text-2);
  font-size: 13px;
  line-height: 1.55;
  margin: 6px 0 0 23px;
}

/* ---- footer ---- */
.pv-foot {
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--border);
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
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
    transform: translateY(8px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .statusbar .sb-dot::after,
  .fixbox {
    animation: none !important;
  }
}
</style>
