<!-- Copyright 2026 OpenObserve Inc. -->

<!--
  The signing-key rotation lifecycle.

  Rotation is a four-step handover — mint a candidate, prove the receiver accepts
  it, activate it, then let the old key expire — and each step is refused unless
  the one before it happened. Rendering it as a numbered sequence rather than a
  row of buttons is what makes "you cannot activate an untested candidate" read
  as an order rather than an error message.
-->
<template>
  <section class="flex flex-col gap-3" data-test="ai-remote-task-signing-panel">
    <div class="flex flex-col gap-1">
      <h3 class="text-text-heading m-0 text-sm font-bold">
        {{ t("aiObservability.remoteTasks.signingPanel.title") }}
      </h3>
      <p class="text-text-secondary m-0 text-xs leading-relaxed">
        {{ t("aiObservability.remoteTasks.signingPanel.hint") }}
      </p>
    </div>

    <p
      v-if="!enabled"
      class="text-text-secondary border-border-default rounded-default bg-surface-base m-0 border px-3 py-2.5 text-xs"
      data-test="ai-remote-task-signing-disabled"
    >
      {{ t("aiObservability.remoteTasks.signingPanel.disabled") }}
    </p>

    <template v-else>
      <div class="flex flex-wrap items-stretch gap-3">
        <article
          v-for="key in orderedKeys"
          :key="`${key.state}-${key.createdAt}`"
          class="card-container rounded-default border-border-default bg-surface-base flex min-w-56 flex-1 flex-col gap-2 border p-3"
          :data-test="`ai-remote-task-signing-key-${key.state}`"
        >
          <OTag :variant="stateVariant(key.state)" dot>{{ stateLabel(key.state) }}</OTag>
          <dl
            class="text-text-secondary m-0 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs"
          >
            <dt class="font-medium">
              {{ t("aiObservability.remoteTasks.signingPanel.keyIdLabel") }}
            </dt>
            <dd class="text-text-body m-0 font-mono">
              {{ key.keyId || t("aiObservability.remoteTasks.signingPanel.noKeyId") }}
            </dd>
            <dt class="font-medium">
              {{ t("aiObservability.remoteTasks.signingPanel.lastVerifiedAt") }}
            </dt>
            <dd class="text-text-body m-0">
              <OTimeCell
                v-if="key.lastVerifiedAt"
                :value="key.lastVerifiedAt"
                unit="ms"
                mode="relative"
                :empty-label="DASH"
              />
              <span v-else>{{ t("aiObservability.remoteTasks.signingPanel.neverVerified") }}</span>
            </dd>
            <template v-if="key.graceExpiresAt">
              <dt class="font-medium">
                {{ t("aiObservability.remoteTasks.signingPanel.graceExpiresAt") }}
              </dt>
              <dd class="text-text-body m-0">
                <OTimeCell
                  :value="key.graceExpiresAt"
                  unit="ms"
                  mode="relative"
                  :empty-label="DASH"
                />
              </dd>
            </template>
          </dl>
        </article>
      </div>

      <p
        v-if="!candidate"
        class="text-text-secondary m-0 text-xs"
        data-test="ai-remote-task-signing-no-candidate"
      >
        {{ t("aiObservability.remoteTasks.signingPanel.noCandidate") }}
      </p>

      <p
        v-if="testMessage"
        class="m-0 text-xs leading-relaxed"
        :class="candidateVerified ? 'text-status-success-text' : 'text-status-error-text'"
        data-test="ai-remote-task-signing-test-message"
      >
        {{ testMessage }}
      </p>

      <div class="flex flex-wrap items-end gap-2">
        <!-- The id is asked for HERE rather than at registration: a first key
             has nothing to be distinguished from, but a candidate does — it is
             what tells the receiver which of the two live keys signed a
             request. -->
        <OInput
          v-model="newKeyId"
          width="sm"
          size="sm"
          :label="t('aiObservability.remoteTasks.signingPanel.newKeyIdLabel')"
          :placeholder="t('aiObservability.remoteTasks.signingPanel.newKeyIdPlaceholder')"
          :disabled="Boolean(busy) || Boolean(candidate)"
          data-test="ai-remote-task-signing-new-key-id"
        />
        <OButton
          variant="outline"
          size="sm-action"
          icon-left="autorenew"
          :loading="busy === 'rotate'"
          :disabled="Boolean(busy) || Boolean(candidate)"
          data-test="ai-remote-task-signing-rotate-btn"
          @click="rotate"
        >
          {{ t("aiObservability.remoteTasks.signingPanel.rotate") }}
        </OButton>
        <OButton
          variant="outline"
          size="sm-action"
          icon-left="play-arrow"
          :loading="busy === 'test'"
          :disabled="Boolean(busy) || !candidate"
          data-test="ai-remote-task-signing-test-btn"
          @click="testCandidate"
        >
          {{ t("aiObservability.remoteTasks.signingPanel.test") }}
        </OButton>
        <OSelect
          v-model="graceHours"
          width="sm"
          size="sm"
          :label="t('aiObservability.remoteTasks.signingPanel.graceLabel')"
          :help-text="t('aiObservability.remoteTasks.signingPanel.graceHelp')"
          :options="graceOptions"
          :searchable="false"
          data-test="ai-remote-task-signing-grace-select"
        />
        <OButton
          variant="primary"
          size="sm-action"
          :loading="busy === 'activate'"
          :disabled="Boolean(busy) || !candidateVerified"
          data-test="ai-remote-task-signing-activate-btn"
          @click="activate"
        >
          {{ t("aiObservability.remoteTasks.signingPanel.activate") }}
        </OButton>
        <OButton
          v-if="graceActive"
          variant="ghost-destructive"
          size="sm-action"
          :loading="busy === 'endGrace'"
          :disabled="Boolean(busy)"
          data-test="ai-remote-task-signing-end-grace-btn"
          @click="endGrace"
        >
          {{ t("aiObservability.remoteTasks.signingPanel.endGrace") }}
        </OButton>
      </div>
    </template>

    <!-- Candidate material is returned exactly once. -->
    <ODialog
      :open="candidateSecretOpen"
      size="md"
      :title="t('aiObservability.remoteTasks.generatedSigning.title')"
      data-test="ai-remote-task-signing-secret-dialog"
      @update:open="candidateSecretOpen = $event"
    >
      <div class="flex flex-col gap-3 p-3">
        <p class="text-text-body m-0 text-sm leading-relaxed">
          {{ t("aiObservability.remoteTasks.generatedSigning.body") }}
        </p>
        <dl
          class="text-text-secondary m-0 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-2 text-xs"
        >
          <dt class="font-medium">
            {{ t("aiObservability.remoteTasks.generatedSigning.keyIdLabel") }}
          </dt>
          <dd class="text-text-body m-0 font-mono">{{ candidateKeyId }}</dd>
          <dt class="font-medium">
            {{ t("aiObservability.remoteTasks.generatedSigning.keyLabel") }}
          </dt>
          <dd class="text-text-body m-0 font-mono break-all">{{ candidateKey }}</dd>
        </dl>
      </div>
      <template #footer>
        <div class="flex w-full items-center justify-between gap-2">
          <OButton
            variant="outline"
            size="sm-action"
            :icon-left="candidateCopied ? 'check' : 'content-copy'"
            data-test="ai-remote-task-signing-secret-copy"
            @click="copyCandidateKey"
          >
            {{
              candidateCopied
                ? t("aiObservability.remoteTasks.generatedSigning.copied")
                : t("aiObservability.remoteTasks.generatedSigning.copy")
            }}
          </OButton>
          <OButton
            variant="primary"
            size="sm-action"
            data-test="ai-remote-task-signing-secret-done"
            @click="candidateSecretOpen = false"
          >
            {{ t("aiObservability.remoteTasks.generatedSigning.done") }}
          </OButton>
        </div>
      </template>
    </ODialog>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useConfirmDialog } from "@/composables/useConfirmDialog";
import remoteTasksService, {
  type RemoteTaskCredentialMetadata,
} from "@/services/remote-tasks.service";

const props = defineProps<{
  orgId: string;
  entityId: string;
  /** Signing is a published-spec field, so it is turned on by publishing a
   *  version rather than from this panel. */
  enabled: boolean;
}>();

const { t } = useI18nTyped();
const { confirm } = useConfirmDialog();

const DASH = raw("—");
const HOUR_MS = 60 * 60 * 1000;

const keys = ref<RemoteTaskCredentialMetadata[]>([]);
const busy = ref<"" | "rotate" | "test" | "activate" | "endGrace">("");
const candidateVerified = ref(false);
const testMessage = ref<I18nText | null>(null);

const candidateSecretOpen = ref(false);
const candidateKeyId = ref("");
const candidateKey = ref("");
const candidateCopied = ref(false);

const graceHours = ref(1);
const newKeyId = ref("");

const graceOptions = computed(() => [
  { label: t("aiObservability.remoteTasks.signingPanel.graceNone"), value: 0 },
  ...[1, 6, 12, 24].map((count) => ({
    label: t("aiObservability.remoteTasks.signingPanel.graceHours", { count }, count),
    value: count,
  })),
]);

/** Current first, then the candidate, then anything retired. */
const orderedKeys = computed(() => {
  const rank = (state: string) => (state === "current" ? 0 : state === "candidate" ? 1 : 2);
  return [...keys.value].sort((a, b) => rank(a.state) - rank(b.state));
});

const candidate = computed(() => keys.value.find((key) => key.state === "candidate") ?? null);
const graceActive = computed(() =>
  keys.value.some((key) => typeof key.graceExpiresAt === "number" && key.graceExpiresAt > 0),
);

function stateVariant(state: string): BadgeVariant {
  if (state === "current") return "success-soft";
  if (state === "candidate") return "blue-soft";
  return "default-soft";
}

function stateLabel(state: string): I18nText {
  if (state === "current") return t("aiObservability.remoteTasks.signingPanel.stateCurrent");
  if (state === "candidate") return t("aiObservability.remoteTasks.signingPanel.stateCandidate");
  return t("aiObservability.remoteTasks.signingPanel.stateRetired");
}

function reportError(error: any, fallback: I18nText) {
  toast({ variant: "error", message: raw(error?.response?.data?.message) || fallback });
}

async function refresh() {
  if (!props.enabled || !props.orgId || !props.entityId) return;
  try {
    const status = await remoteTasksService.getSigningStatus(props.orgId, props.entityId);
    keys.value = status.keys ?? [];
  } catch (error: any) {
    keys.value = [];
    reportError(error, t("aiObservability.remoteTasks.signingPanel.loadError"));
  }
}

async function rotate() {
  busy.value = "rotate";
  try {
    const keyId = newKeyId.value.trim();
    const written = await remoteTasksService.rotateSigning(
      props.orgId,
      props.entityId,
      keyId ? { keyId } : {},
    );
    if (written.material.type === "token") {
      candidateKeyId.value = written.metadata.keyId ?? "";
      candidateKey.value = written.material.value;
      candidateCopied.value = false;
      candidateSecretOpen.value = true;
    }
    candidateVerified.value = false;
    testMessage.value = null;
    newKeyId.value = "";
    toast({
      variant: "success",
      message: t("aiObservability.remoteTasks.signingPanel.rotateSuccess"),
    });
    await refresh();
  } catch (error: any) {
    reportError(error, t("aiObservability.remoteTasks.signingPanel.rotateError"));
  } finally {
    busy.value = "";
  }
}

/** Activation is refused until this passes, so the result is stated inline
 *  rather than as a toast that scrolls away before the next step. */
async function testCandidate() {
  busy.value = "test";
  try {
    const result = await remoteTasksService.testSigningCandidate(props.orgId, props.entityId);
    candidateVerified.value = result.verified;
    testMessage.value = result.verified
      ? t("aiObservability.remoteTasks.signingPanel.testPassed")
      : raw(result.error) || t("aiObservability.remoteTasks.signingPanel.testFailed");
    await refresh();
  } catch (error: any) {
    candidateVerified.value = false;
    reportError(error, t("aiObservability.remoteTasks.signingPanel.testError"));
  } finally {
    busy.value = "";
  }
}

async function activate() {
  busy.value = "activate";
  try {
    await remoteTasksService.activateSigning(
      props.orgId,
      props.entityId,
      graceHours.value * HOUR_MS,
    );
    candidateVerified.value = false;
    testMessage.value = null;
    toast({
      variant: "success",
      message: t("aiObservability.remoteTasks.signingPanel.activateSuccess"),
    });
    await refresh();
  } catch (error: any) {
    reportError(error, t("aiObservability.remoteTasks.signingPanel.activateError"));
  } finally {
    busy.value = "";
  }
}

async function endGrace() {
  const ok = await confirm({
    title: t("aiObservability.remoteTasks.signingPanel.endGraceTitle"),
    message: t("aiObservability.remoteTasks.signingPanel.endGraceMessage"),
    confirmLabel: t("aiObservability.remoteTasks.signingPanel.endGrace"),
    cancelLabel: t("common.cancel"),
  });
  if (!ok) return;
  busy.value = "endGrace";
  try {
    await remoteTasksService.endSigningGrace(props.orgId, props.entityId);
    toast({
      variant: "success",
      message: t("aiObservability.remoteTasks.signingPanel.endGraceSuccess"),
    });
    await refresh();
  } catch (error: any) {
    reportError(error, t("aiObservability.remoteTasks.signingPanel.endGraceError"));
  } finally {
    busy.value = "";
  }
}

async function copyCandidateKey() {
  try {
    await navigator.clipboard.writeText(candidateKey.value);
    candidateCopied.value = true;
  } catch {
    candidateCopied.value = false;
  }
}

watch(() => [props.orgId, props.entityId, props.enabled], refresh);
onMounted(refresh);
</script>
