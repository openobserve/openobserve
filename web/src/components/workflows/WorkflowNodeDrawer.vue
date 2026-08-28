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
  Node config panel (NDV). A single centered ODialog popup for EVERY node — the
  read-only trigger and nodes that haven't run included (empty panes) — showing
  Input · Config · Output, so prev/next navigation stays in the same format the whole
  way.

  There is NO Save button: a newly-added node is already on the canvas
  (insert-immediately), and CLOSING the panel commits the body's config onto it
  (applyNodeConfig — change-gated, so an open+close with no edits doesn't dirty the
  graph). Delete removes the node; the read-only trigger just closes.

  Config is the shared middle region — the per-node-type body (switched on node_type),
  each exposing submit(). The dialog stays mounted while open, so the body never
  remounts. (Filename kept as *Drawer for now; rename is a follow-up.)
-->
<template>
  <ODialog
    :open="true"
    @update:open="onOpenChange"
    :title="raw(title)"
    :size="containerSize"
    :width="containerWidth"
    :show-close="!isFunctionNode"
    :persistent="isFunctionNode"
    data-test="workflow-node-drawer"
  >
    <!-- Footer — Previous / Next step navigation on the left (walks the same tree
         order as the Steps rail), Delete + Execute on the right. Shown even while the
         destination "Create New" form is open (the node just saves as a dummy if the
         form isn't completed); hidden only for the function's full-width editor
         (dialog.expand), which owns its own controls. -->
    <template v-if="!hideFooter" #footer>
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-2">
          <OButton
            variant="outline-destructive"
            size="sm-action"
            data-test="workflow-node-delete"
            :disabled="readonlyBody || canvasReadOnly"
            @click="onDelete"
          >
            {{ t("workflow.deleteNode") }}
          </OButton>
        </div>
        <div class="flex items-center gap-2">
          <OButton
            variant="outline"
            size="sm-action"
            data-test="workflow-ndv-prev-step"
            :disabled="!prevStepId"
            @click="navigateTo(prevStepId)"
          >
            <span class="inline-flex items-center gap-1.5">
              <OIcon name="chevron-left" size="xs" />
              <OIcon v-if="prevStep" :name="prevStep.icon" size="xs" />
              <span>{{ t("workflow.ndv.prevStepBtn") }}</span>
            </span>
          </OButton>
          <OButton
            variant="outline"
            size="sm-action"
            data-test="workflow-ndv-next-step"
            :disabled="!nextStepId"
            @click="navigateTo(nextStepId)"
          >
            <span class="inline-flex items-center gap-1.5">
              <span>{{ t("workflow.ndv.nextStepBtn") }}</span>
              <OIcon v-if="nextStep" :name="nextStep.icon" size="xs" />
              <OIcon name="chevron-right" size="xs" />
            </span>
          </OButton>
          <!-- Read-only run view: the one verb that IS safe here — leave with the
               run and the node in hand. Offered on PASSED steps too: a green step
               can still be wrong, and a failure downstream is often caused by an
               upstream step that passed while emitting the wrong records. -->
          <OButton
            v-if="canvasReadOnly && historyRunId"
            variant="outline"
            size="sm-action"
            data-test="workflow-node-edit-step"
            @click="editThisStep"
          >
            {{ t("workflow.ndv.editStep") }}
          </OButton>
          <!-- Hidden (not disabled) on a historical run: canvasReadOnly means it
               could never be enabled there, and a permanently dead control just
               advertises an action the surface refuses. -->
          <OButton
            v-if="showIo && !canvasReadOnly"
            variant="outline"
            size="sm-action"
            data-test="workflow-node-execute"
            :loading="executing"
            :disabled="inputInvalid || readonlyBody || canvasReadOnly"
            :title="inputInvalid ? t('workflow.test.invalidJson') : undefined"
            @click="executeStep"
          >
            {{ t("workflow.ndv.executeStep") }}
          </OButton>
        </div>
      </div>
    </template>
    <!-- The header TITLE is the editable step name (T2), with the node type as the
         subtitle so the kind stays clear. -->
    <template #header>
      <div class="flex min-w-0 items-start gap-2">
        <!-- Function nodes hide reka's close X + block outside/escape (persistent) so
             a dirty editor can't be dismissed without the guard — this custom X routes
             the close through requestClose(). Other node types keep the built-in X. -->
        <OButton
          v-if="isFunctionNode"
          variant="ghost"
          size="icon-sm"
          class="order-last shrink-0"
          data-test="workflow-ndv-close"
          :aria-label="t('common.close')"
          @click="requestClose"
        >
          <OIcon name="close" size="sm" />
        </OButton>
        <div class="min-w-0 flex-1">
          <OInlineEdit
            :model-value="nodeName"
            data-test="workflows-node-rename-input"
            :placeholder="t('workflow.node.namePlaceholder')"
            :aria-label="t('workflow.node.namePlaceholder')"
            :readonly="canvasReadOnly"
            @update:model-value="onNameLive"
            @commit="onNameCommit"
          />
          <div class="mt-0.5 flex items-center gap-2">
            <span class="text-text-secondary truncate text-xs">{{ typeBreadcrumb }}</span>

            <!-- Run label + switcher — read-only history only. The chip shows the run id
               (already on the result — no fetch); the history button opens a menu of
               runs to load onto THIS node. -->
            <template v-if="historyRunId">
              <span
                data-test="workflow-ndv-run-label"
                class="border-border-default text-text-secondary rounded-default inline-flex max-w-[20rem] shrink-0 items-center border px-1.5 py-0.5 text-xs"
                :title="raw(historyRunId)"
              >
                <span class="truncate">{{ t("workflow.ndv.runLabel") }} · {{ historyRunId }}</span>
              </span>

              <WorkflowRunSwitcher
                :current-run-id="historyRunId"
                :org-id="store.state.selectedOrganization.identifier"
                :workflow-id="workflowObj.currentSelectedWorkflow?.id || ''"
                @select="switchRun"
              >
                <template #trigger>
                  <OButton
                    variant="outline"
                    size="icon-xs-sq"
                    class="shrink-0"
                    data-test="workflow-ndv-run-switcher"
                  >
                    <OIcon name="history" size="xs" />
                    <OTooltip :content="t('workflow.ndv.switchRun')" side="bottom" />
                  </OButton>
                </template>
              </WorkflowRunSwitcher>
            </template>
          </div>
        </div>
      </div>
    </template>

    <!-- Node Detail View body: Steps · Input · Config · Output. Collapses to Config
         only while the function's full-width inline editor is open (dialog.expand). -->
    <div
      data-test="workflow-ndv-body"
      class="relative flex h-[calc(90vh-10rem)] min-h-0 gap-4"
      :class="workflowObj.dialog.expand || isIoNode ? '' : 'p-4'"
    >
      <!-- STEPS — the workflow's nodes as a top-down TREE (traces-waterfall guides),
           the same navigator the results dock had. Click a step to walk the panel to
           it; the active step is highlighted, the count-badge/leaf-dot mirrors its run
           status. Shown with the I/O panes only (showIo). -->
      <!-- `-mr-2` tightens ONLY the Steps→Input gap (the row's gap-4 is kept elsewhere
           because the Input/Output resize handles live in those gaps). -->
      <section
        v-if="showIo"
        data-test="workflow-ndv-steps"
        class="-mr-2 flex shrink-0 flex-col gap-2"
        :class="stepsCollapsed ? 'w-11' : 'w-48'"
      >
        <!-- h-8 matches the Input/Output/Config header height (their dense tabs are
             h-8) so all four pane titles sit on the same line. Collapsed: the title
             drops and the chevron centers (it's the only affordance that fits). -->
        <div
          class="flex h-8 items-center"
          :class="stepsCollapsed ? 'justify-center' : 'justify-between pl-2'"
        >
          <span v-if="!stepsCollapsed" class="text-text-body text-sm font-bold">
            {{ t("workflow.results.nodesTitle") }}
          </span>
          <!-- Same toggle style as the Logs field-panel collapse button
               (SearchResult.vue): outline icon button + double-arrow + tooltip. -->
          <OButton
            variant="outline"
            size="icon-xs-sq"
            class="shrink-0"
            data-test="workflow-ndv-steps-collapse"
            @click="toggleStepsCollapsed"
          >
            <OIcon
              :name="stepsCollapsed ? 'keyboard-double-arrow-right' : 'keyboard-double-arrow-left'"
              size="sm"
            />
            <OTooltip
              :content="
                stepsCollapsed ? t('workflow.ndv.expandSteps') : t('workflow.ndv.collapseSteps')
              "
              side="bottom"
            />
          </OButton>
        </div>
        <div
          class="border-border-default rounded-default flex min-h-0 flex-1 flex-col overflow-auto border py-1"
        >
          <!-- Expanded: one fixed-width guide column per depth level (border-left │ /
               border-top elbow └/├), a circled child-count badge (leaf steps show a
               status dot), then icon + label — the dock's Steps tree.
               Collapsed: a flat icon-only launcher (no guides/indent). The step's
               identity moves to a hover tooltip (name + ancestor path); run status
               folds into a corner dot on the icon. -->
          <button
            v-for="row in stepTree"
            :key="row.id"
            type="button"
            :data-test="`workflow-ndv-step-${row.id}`"
            class="relative flex h-9 shrink-0 items-center text-sm"
            :class="[
              stepsCollapsed ? 'w-full justify-center' : 'w-max min-w-full pr-2 pl-2 text-left',
              row.id === nodeId
                ? 'bg-select-item-hover-bg text-text-body'
                : 'text-text-secondary hover:bg-surface-subtle',
            ]"
            @click="navigateTo(row.id)"
          >
            <!-- COLLAPSED — icon-only, status as a corner dot, name/path on hover. -->
            <template v-if="stepsCollapsed">
              <span class="relative flex h-5 w-5 items-center justify-center">
                <OIcon :name="row.icon" size="xs" class="shrink-0" />
                <span
                  class="absolute -right-0.5 -bottom-0.5 h-1.5 w-1.5 rounded-full"
                  :class="stepDotClass(row.status)"
                  aria-hidden="true"
                />
              </span>
              <OTooltip side="right" align="center" :side-offset="8" max-width="18rem">
                <template #content>
                  <div class="flex flex-col gap-0.5 p-1 text-left">
                    <div class="text-xs font-semibold">{{ row.label }}</div>
                    <div v-if="row.breadcrumb" class="text-text-secondary text-xs">
                      {{ row.breadcrumb }}
                    </div>
                  </div>
                </template>
              </OTooltip>
            </template>
            <!-- EXPANDED — the full tree row. -->
            <template v-else>
              <span
                v-for="i in row.depth"
                :key="i"
                class="relative h-full w-5 shrink-0"
                aria-hidden="true"
              >
                <span
                  v-if="i < row.depth ? row.guides[i - 1] : true"
                  class="border-border-default absolute top-0 left-1/2 border-l"
                  :class="i < row.depth ? 'bottom-0' : row.guides[i - 1] ? 'h-full' : 'h-1/2'"
                />
                <span
                  v-if="i === row.depth"
                  class="border-border-default absolute top-1/2 right-0 left-1/2 border-t"
                />
              </span>
              <span class="flex h-full w-5 shrink-0 items-center justify-center">
                <span
                  v-if="row.hasChildren"
                  class="bg-surface-base flex h-5 w-5 items-center justify-center rounded-full border text-xs leading-none font-semibold"
                  :class="stepRingClass(row.status)"
                >
                  {{ row.childCount }}
                </span>
                <span
                  v-else
                  class="h-2 w-2 rounded-full"
                  :class="stepDotClass(row.status)"
                  aria-hidden="true"
                />
              </span>
              <span class="flex items-center gap-1.5 pl-1.5">
                <OIcon :name="row.icon" size="xs" class="shrink-0" />
                <span class="whitespace-nowrap">{{ row.label }}</span>
              </span>
            </template>
          </button>
        </div>
      </section>

      <!-- This node wasn't part of the loaded run (added later / never reached): a plain
           notice in place of the panes — no misleading sample data. The Steps rail stays
           so the user can jump to a step that IS in this run. -->
      <div
        v-if="nodeMissingFromRun"
        data-test="workflow-ndv-not-in-run"
        class="text-text-secondary flex min-w-0 flex-1 flex-col items-center justify-center gap-2 text-center"
      >
        <OIcon name="info" size="lg" class="text-text-placeholder" />
        <span class="text-sm">{{ t("workflow.ndv.notInRun") }}</span>
      </div>

      <!-- INPUT — the upstream SOURCES list (immediate parent = this node's real input,
           expanded by default; earlier ancestors collapsed below, inspect-only). Hidden
           for the trigger: it has no input (its output IS the event), so Config expands
           into the space and only Config · Output show. -->
      <section
        v-if="showIo && !readonlyBody && !nodeMissingFromRun"
        data-test="workflow-ndv-input"
        class="relative flex w-[var(--io-w,21.25rem)] min-w-0 shrink-0 flex-col gap-2"
        :style="{ '--io-w': inputWidth + 'px' }"
      >
        <!-- Drag handle on Input's RIGHT edge (sits in the gap toward Config).
             `-my-dialog-content-py` cancels ODialog's vertical body padding so the line
             extends through it to the dialog header/footer — no gap at top/bottom. -->
        <div
          class="-my-dialog-content-py absolute inset-y-0 -right-2.5 z-10 flex w-2.5 cursor-col-resize items-center justify-center"
          data-test="workflow-ndv-input-resize"
          @mousedown.prevent="startResize('input', $event)"
        >
          <div
            class="bg-border-default hover:bg-accent h-full w-0.5 rounded-full transition-colors"
          />
        </div>
        <div class="flex h-8 items-center pl-2">
          <div class="text-text-body text-sm font-bold">{{ t("workflow.ndv.input") }}</div>
        </div>
        <!-- Just the IMMEDIATE input — no source-chain accordion, node name, or nav
             arrow. In editor mode this is ALWAYS an editable JSON test input (Run Step
             runs against it), seeded with the recorded input or the trigger sample.
             Read-only history shows the recorded input, or an empty state when the step
             received nothing. Earlier ancestors are inspected via the Steps tree. -->
        <div
          class="border-border-default bg-code-bg rounded-default flex min-h-0 flex-1 flex-col overflow-auto border"
        >
          <div
            v-if="!canvasReadOnly || (immediateSrc && immediateRecords.length)"
            class="flex h-full flex-col pl-2"
          >
            <CodeQueryEditor
              editor-id="workflow-ndv-input-editor"
              language="json"
              :query="editableInput"
              :read-only="canvasReadOnly"
              :show-auto-complete="false"
              class="min-h-0 flex-1"
              @update:query="editableInput = $event"
            />
            <div
              v-if="inputInvalid"
              data-test="workflow-ndv-input-invalid"
              class="text-input-error-text border-border-default shrink-0 border-t px-2 py-1 text-xs"
            >
              {{ t("workflow.test.invalidJson") }}
            </div>
            <!-- Reads as intentional test input (not a stray editable "[]"): says what
                 the field is and what to do with it. Editor mode only. -->
            <div
              v-else-if="!canvasReadOnly"
              data-test="workflow-ndv-input-hint"
              class="text-text-secondary border-border-default shrink-0 border-t px-2 py-1 text-xs"
            >
              {{ t("workflow.ndv.testInputHint") }}
            </div>
          </div>
          <div
            v-else
            data-test="workflow-ndv-input-empty"
            class="text-text-secondary flex h-full items-center justify-center p-4 text-center text-sm italic"
          >
            {{ inputEmptyMessage }}
          </div>
        </div>
      </section>

      <!-- CONFIG — ONE body instance so it never remounts when the I/O panes toggle
           (e.g. entering the inline function editor). Each body exposes submit(). -->
      <!-- Config — hidden for the read-only trigger (nothing to configure; its event
           fills the Output pane instead of leaving this pane empty). -->
      <section
        v-if="!nodeMissingFromRun && !isReadonlyTrigger"
        data-test="workflow-ndv-config"
        class="flex min-h-0 min-w-0 flex-1 flex-col gap-4"
      >
        <!-- Body + Comment share ONE scroll column, so the Comment sits directly
             AFTER the body content: right under a short body (Condition — no gap),
             and at the bottom under a filling body (Function, which is flex-1).
             The left inset lives on the config HEADER, not this column — matching
             the I/O panes, where only the title row is inset and the bordered box
             runs flush. Insetting the column pushed the body's box off the line the
             Input/Output boxes sit on. -->
        <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-auto">
          <!-- Read-only (Runs history): a per-type config READOUT, not the editable
               form — so it doesn't read as "what do I change here?". Editing lives in
               the editor surface (a historical run is immutable). -->
          <WorkflowConfigSummary v-if="canvasReadOnly" :key="nodeId" />
          <component v-else-if="bodyComponent" :is="bodyComponent" :key="nodeId" ref="bodyRef" />
          <div
            v-else
            data-test="workflow-ndv-config-placeholder"
            class="text-text-secondary flex flex-1 flex-col items-center justify-center gap-2 py-10 text-center"
          >
            <OIcon :name="meta?.icon || 'help'" size="lg" />
            <div class="text-sm">
              {{ t("workflow.node.configComingSoon", { node: title }) }}
            </div>
          </div>

          <!-- Comment (T3) — an optional authoring note, directly under the body.
               Hidden in the inline "Create New …" editor and in the read-only Runs
               history (it's an editing aid, not run data). -->
          <div
            v-if="!workflowObj.dialog.expand && !canvasReadOnly"
            class="flex shrink-0 flex-col gap-1"
          >
            <label class="text-text-secondary text-xs font-medium">
              {{ t("workflow.node.commentLabel") }}
            </label>
            <OTextarea
              :model-value="nodeComment"
              data-test="workflows-node-comment-input"
              :placeholder="t('workflow.node.commentPlaceholder')"
              :rows="2"
              size="sm"
              @update:model-value="onCommentLive"
              @blur="onCommentBlur"
            />
          </div>
        </div>
      </section>

      <!-- OUTPUT (only with run data). For the TRIGGER there's no config to sit beside,
           so the event (its output) fills the width instead of a narrow pane. -->
      <section
        v-if="showIo && !nodeMissingFromRun"
        data-test="workflow-ndv-output"
        class="relative flex min-w-0 flex-col gap-2"
        :class="isReadonlyTrigger ? 'flex-1' : 'w-[var(--io-w,21.25rem)] shrink-0'"
        :style="isReadonlyTrigger ? undefined : { '--io-w': outputWidth + 'px' }"
      >
        <!-- Drag handle on Output's LEFT edge (sits in the gap toward Config). Extends
             through the dialog's vertical body padding like the Input handle. Hidden for
             the trigger — the event pane is full-width, nothing to resize against. -->
        <div
          v-if="!isReadonlyTrigger"
          class="-my-dialog-content-py absolute inset-y-0 -left-2.5 z-10 flex w-2.5 cursor-col-resize items-center justify-center"
          data-test="workflow-ndv-output-resize"
          @mousedown.prevent="startResize('output', $event)"
        >
          <div
            class="bg-border-default hover:bg-accent h-full w-0.5 rounded-full transition-colors"
          />
        </div>
        <div class="flex h-8 items-center gap-2 pl-2">
          <div class="text-text-body text-sm font-bold">{{ t("workflow.ndv.output") }}</div>
          <!-- Run status (Passed / Errored / No Records) — same source as the canvas
               badge and the results dock. -->
          <OBadge
            v-if="hasResult"
            :variant="outputStatusVariant"
            size="sm"
            data-test="workflow-ndv-output-status"
          >
            {{ t(`workflow.test.stepResult.status.${outputStatus}`) }}
          </OBadge>
        </div>
        <div
          class="border-border-default bg-code-bg rounded-default flex min-h-0 flex-1 flex-col overflow-hidden border"
        >
          <!-- The node errored: show the error message(s), then the records it still
               passed downstream (mirrors the Step Results dock). -->
          <div
            v-if="outputHasError"
            data-test="workflow-ndv-output-error"
            class="flex shrink-0 flex-col gap-1.5 overflow-auto p-2.5"
            :class="{ 'flex-1': !outputRecords }"
          >
            <div class="text-status-error-text text-xs font-semibold">
              {{ t("workflow.test.stepResult.errorHeading") }}
            </div>
            <div
              v-for="(m, i) in outputErrorMessages"
              :key="i"
              data-test="workflow-ndv-output-error-line"
              class="text-status-error-text text-xs leading-snug whitespace-pre-wrap"
            >
              {{ m }}
            </div>
          </div>

          <template v-if="outputRecords">
            <div
              v-if="outputHasError"
              class="text-text-secondary shrink-0 px-2.5 pt-2 text-xs font-semibold"
            >
              {{ t("workflow.test.stepResult.forwardedHeading") }}
            </div>
            <div class="min-h-0 flex-1 pl-2">
              <CodeQueryEditor
                editor-id="workflow-ndv-output-editor"
                language="json"
                :query="prettyRecords(outputRecords)"
                :read-only="true"
                :show-auto-complete="false"
              />
            </div>
          </template>

          <div
            v-else-if="!outputHasError"
            class="text-text-secondary flex h-full items-center justify-center p-4 text-center text-sm italic"
          >
            {{ hasResult ? t("workflow.ndv.noOutput") : t("workflow.ndv.noRunYet") }}
          </div>
        </div>
      </section>
    </div>

    <!-- Delete confirmation — rendered INSIDE the NDV so it stacks above it (nested
         ODialog → higher z-index layer), the same way FunctionPicker's dialogs do. -->
    <ConfirmDialog
      v-model="confirmDeleteOpen"
      :title="t('workflow.deleteNodeTitle')"
      :message="t('workflow.deleteNodeConfirm')"
      :ok-label="t('common.delete')"
      @update:ok="onConfirmDelete"
    />

    <!-- Unsaved-function prompt (Function nodes only) — nested so it stacks above the
         NDV. Forces a choice (persistent, no dismiss): never auto-save the library
         function, never silently drop edits. Save opens the picker's save dialog and
         keeps you here; Discard leaves without committing; Keep editing stays. -->
    <ODialog
      :open="exitPromptOpen"
      persistent
      :show-close="false"
      size="sm"
      data-test="workflow-ndv-unsaved-fn"
      :title="t('workflow.node.unsavedFnTitle')"
      :neutral-button-label="t('workflow.node.unsavedFnKeep')"
      :secondary-button-label="t('workflow.node.unsavedFnDiscard')"
      :primary-button-label="t('workflow.node.unsavedFnSave')"
      neutral-button-variant="outline"
      secondary-button-variant="outline-destructive"
      @click:neutral="onExitKeepEditing"
      @click:secondary="onExitDiscard"
      @click:primary="onExitSave"
    >
      <p class="text-text-secondary text-sm">{{ t("workflow.node.unsavedFnMessage") }}</p>
    </ODialog>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { toast } from "@/lib/feedback/Toast/useToast";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OInlineEdit from "@/lib/forms/InlineEdit/OInlineEdit.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTextarea from "@/lib/forms/Input/OTextarea.vue";
import CodeQueryEditor from "@/components/CodeQueryEditor.vue";
import WorkflowRunSwitcher from "./WorkflowRunSwitcher.vue";
import WorkflowTrigger from "@/plugins/workflows/nodes/WorkflowTrigger.vue";
import WorkflowCondition from "@/plugins/workflows/nodes/WorkflowCondition.vue";
import WorkflowFunction from "@/plugins/workflows/nodes/WorkflowFunction.vue";
import WorkflowDestination from "@/plugins/workflows/nodes/WorkflowDestination.vue";
import WorkflowConfigSummary from "@/plugins/workflows/nodes/WorkflowConfigSummary.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import useWorkflowCanvas, {
  workflowObj,
  nodeMeta,
  triggerDef,
  nodeCustomName,
  nodeComment as readNodeComment,
  setNodeName,
  setNodeComment,
  markWorkflowDirty,
  nodeTestInput,
  nodeTestOutput,
  executeTestRun,
  currentTriggerKind,
  buildStepTree,
  loadWorkflowRun,
} from "@/plugins/workflows/useWorkflowCanvas";

const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();
const { applyNodeConfig, mergeNodeConfig, closeNodeDrawer, deleteNode, editNode } =
  useWorkflowCanvas(t);

const meta = computed(() => nodeMeta(workflowObj.dialog.name));

// Rename (T2) + comment (T3) bind to the staged/edited node (currentSelectedNodeData
// is the node ref in both add and edit). Live writes keep the canvas card in sync
// as the user types; commit/blur trims and drops empties (via the meta helpers).
const nodeComment = computed(() => readNodeComment(workflowObj.currentSelectedNodeData));
const typeBreadcrumb = computed(() =>
  meta.value ? `${t(meta.value.kindKey)} · ${t(meta.value.titleKey)}` : "",
);
const writeMetaLive = (key: string, value: string) => {
  const n = workflowObj.currentSelectedNodeData;
  if (!n) return;
  n.meta = { ...(n.meta || {}), [key]: value };
  markWorkflowDirty();
};
const onNameLive = (val: string) => writeMetaLive("label", val);
const onNameCommit = (val: string) => setNodeName(workflowObj.currentSelectedNodeData, val);
const onCommentLive = (val: string) => writeMetaLive("comment", val);
const onCommentBlur = () => setNodeComment(workflowObj.currentSelectedNodeData, nodeComment.value);
const title = computed(() => {
  // Trigger drawers title by KIND (registry), matching the canvas card; other
  // nodes use their node-type title.
  if (meta.value?.category === "trigger")
    return t(triggerDef(workflowObj.currentSelectedNodeData?.data?.trigger_kind).nodeTitleKey);
  return meta.value ? t(meta.value.titleKey) : workflowObj.dialog.name;
});

// The header shows the node's ACTUAL name: the user's custom label if set, else the
// node type's default title (e.g. "Alert Trigger", "Function") — never an empty
// "Name This Step" prompt. This keeps a Function node from looking like it wants two
// names (step name vs function name). Editing still overrides it, and an untouched
// default is never persisted (OInlineEdit only commits on an actual edit).
const nodeName = computed(() => nodeCustomName(workflowObj.currentSelectedNodeData) || title.value);

// Node types that have a real config form. The rest still show the placeholder.
const BODY_COMPONENTS: Record<string, any> = {
  workflow_trigger: WorkflowTrigger,
  condition: WorkflowCondition,
  function: WorkflowFunction,
  destination: WorkflowDestination,
};
const bodyComponent = computed(() => BODY_COMPONENTS[workflowObj.dialog.name]);

// Ref to the active body so close can pull its payload / let it veto.
const bodyRef = ref<any>(null);

// The full-width inline function editor supplies its own controls, so the
// drawer footer is hidden there.
const hideFooter = computed(() => workflowObj.dialog.expand);

// The trigger is a read-only payload reference — nothing to save/cancel, so the
// footer is hidden and the header's close (X) is the only control.
const readonlyBody = computed(() => meta.value?.category === "trigger");

// Whole-panel read-only: the NDV opened from the read-only Runs history view. Same
// UI as the editor (Input · Config · Output), but a historical run must NOT be
// mutated — so rename, comment, config edits, Delete, Run, and commit-on-close are
// all inert. `readonlyBody` (trigger) and `canvasReadOnly` (Runs) are distinct:
// the trigger still hides its Input pane; a read-only condition/function keeps it.
const canvasReadOnly = computed(() => workflowObj.readOnly);

// The node's last-run data. Input = the records it received; Output = what it
// forwarded (per outgoing branch), or — for a terminal node — the records it
// received. Reuses the shared derivation the results dock uses; the richer controls
// (replay / fullscreen / use-as-test-input) stay in that dock for now.
const nodeId = computed(() => workflowObj.currentSelectedNodeData?.id || "");

// ── "Edit This Step" (Runs history → editor) ────────────────────────────────
// The read-only run view can see exactly what broke but can do nothing about it,
// so the user closes the panel, switches route, re-finds the node from memory and
// hand-copies its input. This carries both of those for them: the editor re-loads
// the same run onto its canvas and opens this node. The run itself is only ever
// read — the fix lands on the definition, and re-testing makes a NEW test run.
const historyRunId = computed<string>(() =>
  workflowObj.testRun.result?.mode === "history" ? workflowObj.testRun.result.runId || "" : "",
);
const editThisStep = () => {
  const workflowId = workflowObj.currentSelectedWorkflow?.id;
  if (!workflowId || !nodeId.value) return;
  router.push({
    name: "workflowEditor",
    query: {
      org_identifier: store.state.selectedOrganization.identifier,
      id: workflowId,
      run_id: historyRunId.value,
      node_id: nodeId.value,
    },
  });
};

// ── Run switcher (read-only history) ─────────────────────────────────────────
// The chip shows the loaded run id (already on `testRun.result`, no api call). The
// switcher dropdown (shared WorkflowRunSwitcher) reuses the runs list the Runs page
// already fetched and loads whichever run the user picks onto THIS node.
const switchRun = async (runId: string) => {
  const id = workflowObj.currentSelectedWorkflow?.id;
  if (!runId || !id || runId === historyRunId.value) return;
  await loadWorkflowRun({
    orgId: store.state.selectedOrganization.identifier,
    workflowId: id,
    runId,
  });
};

// Did THIS node take part in the selected run? A node keyed in the run's per-node
// input or error map ran; the trigger always runs. Absent from both => it was added
// after this run (or never reached) — warn instead of showing blank panes.
const nodeRanInHistory = (id: string): boolean => {
  const r: any = workflowObj.testRun.result;
  return !!(
    r &&
    ((r.inputs && Object.prototype.hasOwnProperty.call(r.inputs, id)) ||
      (r.errors && Object.prototype.hasOwnProperty.call(r.errors, id)))
  );
};
const nodeInRun = computed(() => {
  if (!historyRunId.value) return true;
  if (readonlyBody.value) return true; // trigger — always part of the run
  return nodeRanInHistory(nodeId.value);
});
// This node wasn't part of the loaded run — show a plain notice in place of the panes
// (which would otherwise fall back to the trigger SAMPLE and look like real data).
const nodeMissingFromRun = computed(() => !!historyRunId.value && !nodeInRun.value);
// Read-only TRIGGER: its Config summary is just the kind (nothing to configure), which
// leaves a big empty pane. Drop Config and let the event (Output) fill the width. Only
// in read-only — the editor's trigger body IS a useful payload reference.
const isReadonlyTrigger = computed(() => canvasReadOnly.value && readonlyBody.value);
// A test run exists to inspect. Once it does, opening OR navigating to any node keeps
// the NDV — even a node that didn't run shows empty Input/Output (not a config-only
// drawer), so the prev/next walk stays in NDV format the whole way.
const hasResult = computed(() => !!workflowObj.testRun.result);
const prettyRecords = (recs: any) => (recs == null ? "" : JSON.stringify(recs, null, 2));

// Input = the UPSTREAM SOURCES list. The graph is a single-incoming tree, so a node's
// ancestry is a linear back-walk: immediate parent first (its output IS this node's
// input), then its parent, … up to the trigger. Each entry carries the records that
// flowed parent→child (== the child's recorded input), so expanding a row shows the
// data AS IT WAS at that stage — the payload is reshaped at every hop. Reactive to both
// the graph (edges) and the run (nodeTestInput reads testRun.result).
interface SourceRow {
  node: any;
  records: any[] | null;
}
const sourceChain = computed<SourceRow[]>(() => {
  const wf = workflowObj.currentSelectedWorkflow;
  const edges = wf.edges || [];
  const nodes = wf.nodes || [];
  const byId = (id: string) => nodes.find((n: any) => n.id === id) || null;
  const chain: SourceRow[] = [];
  const seen = new Set<string>(); // cycle guard
  let childId = nodeId.value;
  while (childId && !seen.has(childId)) {
    seen.add(childId);
    const edge = edges.find((e: any) => e.target === childId);
    if (!edge) break;
    const parent = byId(edge.source);
    if (!parent) break;
    // The child's recorded input (a full run) OR — when the child never ran but its
    // parent did (e.g. a single-node Run Step) — the parent's recorded output, so a
    // step's result flows straight into the next node's Input. `??` keeps a real empty
    // input (child ran, 0 records reached it) from falling back to the parent's output.
    chain.push({ node: parent, records: nodeTestInput(childId) ?? nodeTestOutput(parent.id) });
    childId = parent.id;
  }
  // No upstream: the trigger's own input IS the event payload, so show it as a single
  // source row. A dangling NON-trigger node genuinely has no input → empty list.
  if (!chain.length) {
    const self = workflowObj.currentSelectedNodeData;
    if (self?.data?.node_type === "workflow_trigger") {
      chain.push({ node: self, records: nodeTestInput(self.id) });
    }
  }
  return chain;
});

// Before any run, the trigger's OWN output is its default SAMPLE event — so a
// downstream node's Input pane is useful immediately (shows the real payload shape,
// no run required). Deeper ancestors have no known pre-run output → they still say
// "run to view". The sample stands in only until a real run fills in actual records.
const isTriggerNode = (node: any) => node?.data?.node_type === "workflow_trigger";
const defaultTriggerSample = computed<any[]>(() => {
  const kind = currentTriggerKind();
  if (!kind) return [];
  try {
    return triggerDef(kind).buildSample() || [];
  } catch {
    return [];
  }
});
const rowIsSample = (src: SourceRow) =>
  !(src.records && src.records.length) &&
  isTriggerNode(src.node) &&
  defaultTriggerSample.value.length > 0;
const rowRecords = (src: SourceRow): any[] =>
  src.records && src.records.length
    ? src.records
    : rowIsSample(src)
      ? defaultTriggerSample.value
      : [];

// The node's INPUT is JUST the immediate parent's records — the source chain is
// collapsed to this one row (earlier ancestors aren't shown; the Steps tree is the
// place to inspect those). `immediateRecords` handles the pre-run trigger sample.
const immediateSrc = computed<SourceRow | null>(() => sourceChain.value[0] ?? null);
const immediateRecords = computed<any[]>(() =>
  immediateSrc.value ? rowRecords(immediateSrc.value) : [],
);
// Empty-input copy (shown in place of an editable "[]"): no parent → nothing feeds
// this step; ran but empty → nothing reached it; otherwise it just hasn't run yet.
const inputEmptyMessage = computed<I18nText>(() =>
  !immediateSrc.value
    ? t("workflow.ndv.noUpstream")
    : hasResult.value
      ? t("workflow.ndv.noBranchItems")
      : t("workflow.ndv.noRunYet"),
);

// ── Editable input (test input for Run Step) ─────────────────────────────────
// Run Step executes THIS node in isolation, so its input is a test payload the
// user provides — always editable in editor mode. EPHEMERAL: re-seeded whenever
// the node changes or a fresh run lands, so it never holds a stale "phantom"
// input. Run Step runs with it (see executeStep); an invalid edit disables it.
//
// Seed order: the real records this step received (a run's recorded input, or the
// trigger sample when the parent IS the trigger) → else the trigger's sample event
// (the same base test input for EVERY node, which the user edits to fit this step)
// → else an empty array. Read-only history shows the recorded input / empty state,
// so its seed is never displayed.
const editableInput = ref("");
const seedEditableInput = () => {
  if (immediateRecords.value.length) {
    editableInput.value = prettyRecords(immediateRecords.value);
    return;
  }
  editableInput.value =
    !canvasReadOnly.value && defaultTriggerSample.value.length
      ? prettyRecords(defaultTriggerSample.value)
      : "[]";
};
watch([nodeId, () => workflowObj.testRun.result], seedEditableInput, { immediate: true });
// Parsed edited input: an array of records, or null when the JSON is invalid (blank
// counts as an empty array — a valid "no input" run).
const parsedInput = computed<any[] | null>(() => {
  const text = editableInput.value.trim();
  if (!text) return [];
  try {
    const v = JSON.parse(text);
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
});
const inputInvalid = computed(() => parsedInput.value === null);

const outputRecords = computed<any[] | null>(() => {
  // The node's OUTPUT is reported directly by the backend `outputs` map.
  const recs = nodeTestOutput(nodeId.value);
  if (recs && recs.length) return recs;
  // The trigger has no input — its output IS the event. Show its sample even before a
  // run, so the trigger's Output is always populated (it has no Input pane).
  if (isTriggerNode(workflowObj.currentSelectedNodeData) && defaultTriggerSample.value.length)
    return defaultTriggerSample.value;
  return null;
});

// Run error for THIS node (e.g. a Function that threw). The node can still pass its
// input downstream, so Output shows the error AND the forwarded records — same source
// and framing as the results dock / canvas badge.
const outputErrorMessages = computed<string[]>(() => {
  const raw = workflowObj.testRun.result?.errors?.[nodeId.value];
  const entries = Array.isArray(raw?.errors) ? raw.errors : [];
  return entries.map((e: any) => (Array.isArray(e) ? String(e[0]) : String(e)));
});
const outputHasError = computed(() => outputErrorMessages.value.length > 0);
const outputStatus = computed<"ok" | "error" | "skipped">(() => {
  const r = workflowObj.testRun.result;
  if (!r) return "ok";
  if (r.errors?.[nodeId.value]) return "error";
  if (r.inputs) return r.inputs[nodeId.value]?.length ? "ok" : "skipped";
  if (r.blockedNodeIds?.includes(nodeId.value)) return "skipped";
  return "ok";
});
const outputStatusVariant = computed<"error-soft" | "success-soft" | "default-soft">(() =>
  outputStatus.value === "error"
    ? "error-soft"
    : outputStatus.value === "ok"
      ? "success-soft"
      : "default-soft",
);

// The node types that open the NDV, each showing the full Input · Config · Output
// panes. Used only to skip the fallback body padding — an unknown/coming-soon node
// type falls back to the placeholder body and keeps its p-4.
const IO_NODE_TYPES = ["workflow_trigger", "condition", "function", "destination"];
const isIoNode = computed(() => IO_NODE_TYPES.includes(workflowObj.dialog.name));

// The I/O panes show except while the function's full-width inline editor owns the
// panel (dialog.expand). The destination's "Create New Destination" form stays IN
// the Config pane (in the dropdown's place) with Input/Output/Steps/comment and the
// footer (Prev/Next/Delete/Execute) intact — an unfinished form just saves a dummy node.
const showIo = computed(() => !workflowObj.dialog.expand);

// Sizing: a centered popup at NDV_WIDTH vw. `size` stays non-`full` so `width`
// applies and the dialog centers (ODialog caps height at max-h-90vh) with margin
// around it, like the reference popup. Tune NDV_WIDTH to taste.
const NDV_WIDTH = 95; // vw
const containerSize = computed(() => "xl" as const);
const containerWidth = computed(() => NDV_WIDTH);

// prev/next navigation — the connected nodes, shown as floating edge buttons in the
// NDV. Prev is the single upstream node (source of the incoming edge); next is one
// button per outgoing branch (fan-out → multiple). Clicking COMMITS the current node's
// config first (there's no Save button — navigating is a commit point, same as closing)
// then opens the neighbor's Input · Config · Output; the body remounts on the id change
// (`:key`), loading the neighbor's config.
const nodeDisplay = (node: any): { label: string; icon: string } => {
  const type = node?.data?.node_type;
  const m = nodeMeta(type);
  const label =
    nodeCustomName(node) ||
    (type === "workflow_trigger"
      ? t(triggerDef(node?.data?.trigger_kind).nodeTitleKey)
      : m
        ? t(m.titleKey)
        : type || "");
  return { label, icon: m?.image ? `img:${m.image}` : m?.icon || "help" };
};
// Steps TREE (left rail of the panel) — the workflow's nodes as a top-down tree
// (traces-waterfall guides), the same navigator the results dock had. Built with
// buildStepTree over ALL nodes (pass every id as "ran" so the whole graph is the
// tree, not just the executed steps). Clicking one walks the panel to that node
// (navigateTo → editNode); the dot/ring mirrors the canvas ✓/✗ for the last run
// (null = didn't run / no run).
const stepStatusFor = (id: string): "ok" | "error" | "skipped" | null => {
  const r = workflowObj.testRun.result;
  if (!r || !r.ranNodeIds?.includes(id)) return null;
  if (r.errors?.[id]) return "error";
  if (r.inputs) return r.inputs[id]?.length ? "ok" : "skipped";
  if (r.blockedNodeIds?.includes(id)) return "skipped";
  return "ok";
};
const stepDotClass = (status: string | null): string =>
  status === "error"
    ? "bg-status-negative"
    : status === "ok"
      ? "bg-status-positive"
      : status === "skipped"
        ? "bg-badge-default-solid-bg"
        : "bg-border-strong";
// Circle badge (child count) ring + text colour, keyed to the step's run status.
const stepRingClass = (status: string | null): string =>
  status === "error"
    ? "border-status-negative text-status-negative"
    : status === "ok"
      ? "border-status-positive text-status-positive"
      : "border-border-strong text-text-secondary";
const stepTree = computed(() => {
  const wf = workflowObj.currentSelectedWorkflow;
  const nodes = wf.nodes || [];
  const allIds = nodes.map((n: any) => n.id);
  const rows = buildStepTree(nodes, wf.edges || [], allIds).map((s) => {
    const node = nodes.find((n: any) => n.id === s.id);
    const d = nodeDisplay(node);
    return {
      id: s.id,
      label: d.label,
      icon: d.icon,
      status: stepStatusFor(s.id),
      depth: s.depth,
      childCount: s.childCount,
      hasChildren: s.childCount > 0,
      guides: s.guides,
      breadcrumb: "",
    };
  });
  // Ancestor path per row (pre-order, so ancestors[0..depth-1] are already set).
  // Feeds the collapsed rail's tooltip, where repeated icons need disambiguating.
  const ancestors: string[] = [];
  for (const r of rows) {
    ancestors.length = r.depth;
    r.breadcrumb = ancestors.join(" › ");
    ancestors[r.depth] = r.label;
  }
  return rows;
});

// Collapsed Steps rail — icon-only launcher; persisted per user (default expanded).
const STEPS_COLLAPSED_KEY = "workflows:ndvStepsCollapsed";
const stepsCollapsed = ref(false);
try {
  stepsCollapsed.value = localStorage.getItem(STEPS_COLLAPSED_KEY) === "1";
} catch {
  /* localStorage unavailable (private mode) — default expanded */
}
const toggleStepsCollapsed = () => {
  stepsCollapsed.value = !stepsCollapsed.value;
  try {
    localStorage.setItem(STEPS_COLLAPSED_KEY, stepsCollapsed.value ? "1" : "0");
  } catch {
    /* non-fatal — state just won't persist */
  }
};
// Commit the mounted body's current config into the node WITHOUT closing the panel —
// asks the body for its payload (async: the schema-validated pickers resolve on submit)
// and merges it. mergeNodeConfig no-ops when nothing changed, so a plain look-around
// navigation adds no history/dirty noise.
const commitCurrentConfig = async () => {
  if (bodyComponent.value && !readonlyBody.value && !canvasReadOnly.value) {
    const payload = await bodyRef.value?.submit?.();
    if (payload != null) mergeNodeConfig(payload);
  }
};
const navigateTo = async (targetId: string) => {
  if (!targetId || targetId === nodeId.value) return;
  // Dirty function node → prompt first; its Discard path proceeds without committing.
  if (guardFnExit(() => editNode(targetId))) return;
  // Otherwise persist the current node's edits/selection before switching — Prev/Next
  // is a commit point (no Save button), so leaving without this drops the selection.
  await commitCurrentConfig();
  editNode(targetId);
};

// Footer prev/next — step through the same tree order the Steps rail shows. Empty
// at the ends (Previous disabled on the first step, Next on the last).
const stepIndex = computed(() => stepTree.value.findIndex((s) => s.id === nodeId.value));
// The prev/next step rows (from the tree order) — carry the id + type icon so the
// footer buttons can show WHAT the neighbour step is (function / condition / …).
const prevStep = computed(() => (stepIndex.value > 0 ? stepTree.value[stepIndex.value - 1] : null));
const nextStep = computed(() =>
  stepIndex.value >= 0 && stepIndex.value < stepTree.value.length - 1
    ? stepTree.value[stepIndex.value + 1]
    : null,
);
const prevStepId = computed(() => prevStep.value?.id || "");
const nextStepId = computed(() => nextStep.value?.id || "");

// Resizable Input / Output panes — drag the handle on Input's right edge or
// Output's left edge; Config (flex-1) absorbs the change. Widths are px, clamped;
// applied via a CSS var so no literal px lands in a class.
const IO_MIN = 160;
const IO_MAX = 720;
const inputWidth = ref(340);
const outputWidth = ref(340);
const clampIo = (w: number) => Math.min(IO_MAX, Math.max(IO_MIN, w));
let resizing: "input" | "output" | null = null;
let resizeStartX = 0;
let resizeStartW = 0;
const onResizeMove = (e: MouseEvent) => {
  if (!resizing) return;
  const dx = e.clientX - resizeStartX;
  // Input handle is on its RIGHT (drag right → wider); Output handle is on its LEFT
  // (drag left → wider), so the delta is inverted for Output.
  if (resizing === "input") inputWidth.value = clampIo(resizeStartW + dx);
  else outputWidth.value = clampIo(resizeStartW - dx);
};
const onResizeEnd = () => {
  resizing = null;
  window.removeEventListener("mousemove", onResizeMove);
  window.removeEventListener("mouseup", onResizeEnd);
  document.body.style.userSelect = "";
};
const startResize = (which: "input" | "output", e: MouseEvent) => {
  resizing = which;
  resizeStartX = e.clientX;
  resizeStartW = which === "input" ? inputWidth.value : outputWidth.value;
  document.body.style.userSelect = "none"; // no text-selection while dragging
  window.addEventListener("mousemove", onResizeMove);
  window.addEventListener("mouseup", onResizeEnd);
};
onBeforeUnmount(onResizeEnd);

// "Run Step" — executes THIS node in isolation: only this node is sent as the
// workflow (from_node = its id), so nothing upstream/downstream runs — just this
// step against the input in the Input pane, and its output comes back on its own.
// Commits the current config edits FIRST (without closing) so the run tests the
// node's current settings; the panel stays open and its Input/Output panes update
// from the new result.
const executing = ref(false);
const executeStep = async () => {
  const id = nodeId.value;
  if (!id || executing.value || inputInvalid.value || canvasReadOnly.value) return;
  if (bodyComponent.value && !readonlyBody.value) {
    const payload = await bodyRef.value?.submit?.();
    if (payload != null) mergeNodeConfig(payload);
  }
  // Run with the (possibly edited) input from the Input pane — it's seeded from the
  // real input/sample, so this is the last-run input unless the user tweaked it.
  const input = parsedInput.value ?? [];
  executing.value = true;
  const r = await executeTestRun({
    orgId: store.state.selectedOrganization.identifier,
    inputs: Array.isArray(input) ? input : [],
    fromNode: id,
    singleNode: true,
  });
  executing.value = false;
  if (!r.ok) toast({ message: raw(r.error || t("workflow.test.runError")), variant: "error" });
};

// No Save button: CLOSING the panel commits the config. Ask the mounted body for
// its payload and apply it to the (already-committed) node. Awaited because
// schema-validated bodies (the pickers) resolve asynchronously. A read-only trigger
// or a form-less placeholder type has nothing to submit — just close. A body that
// returns null (its inline "Create New …" editor is still open) is left untouched
// but the panel still closes.
const commitAndClose = async () => {
  // Read-only Runs view: never commit — just close (no historical-run mutation).
  if (bodyComponent.value && !readonlyBody.value && !canvasReadOnly.value) {
    const payload = await bodyRef.value?.submit?.();
    if (payload != null) {
      applyNodeConfig(payload);
      return;
    }
  }
  closeNodeDrawer();
};

// Function nodes get special close handling: their editor can hold unsaved inline
// code, and reka closes optimistically (can't be cleanly reopened → visible flicker).
// So for a function node the dialog is `persistent` (outside-click / Escape can't
// dismiss it) and reka's close X is hidden; a custom header X routes through
// requestClose() instead, which shows the guard prompt WITHOUT any reka close.
const isFunctionNode = computed(() => workflowObj.dialog.name === "function");
const requestClose = () => {
  // Dirty → prompt (Save/Discard/Keep); otherwise commit + close.
  if (guardFnExit(() => closeNodeDrawer())) return;
  commitAndClose();
};

// ── Unsaved-function exit guard ───────────────────────────────────────────────
// A Function node's editor can hold inline/edited JS not yet saved to the library
// (serialized as `raw_fn`). Leaving the node — Prev/Next or closing — must not
// silently auto-save (a library update is irreversible) nor silently drop edits, so
// prompt first. Save opens the picker's save dialog and KEEPS the user on the node;
// Discard proceeds without committing; Keep editing stays put.
const exitPromptOpen = ref(false);
let pendingProceed: (() => void) | null = null;
const functionDirty = () =>
  workflowObj.dialog.name === "function" && !canvasReadOnly.value && !!bodyRef.value?.isDirty?.();
const guardFnExit = (proceed: () => void): boolean => {
  if (!functionDirty()) return false;
  pendingProceed = proceed;
  exitPromptOpen.value = true;
  return true;
};
const onExitKeepEditing = () => {
  exitPromptOpen.value = false;
  pendingProceed = null;
};
const onExitDiscard = () => {
  const proceed = pendingProceed;
  exitPromptOpen.value = false;
  pendingProceed = null;
  bodyRef.value?.discardChanges?.();
  proceed?.();
};
const onExitSave = () => {
  exitPromptOpen.value = false;
  pendingProceed = null; // stay on the node; the user completes the save dialog
  bodyRef.value?.saveChanges?.();
};
// Delete confirmation lives INSIDE this dialog (not the shared one in WorkflowEditor)
// so it stacks ON TOP of the NDV: nested in the ODialog it inherits a higher z-index
// layer (o2DialogDepth) — same pattern as FunctionPicker's dialogs, which also render
// inside this NDV. A sibling confirm (WorkflowEditor's) ties the NDV's z-index and
// renders behind it. On confirm, deleteNode() removes the node AND closes this dialog.
const confirmDeleteOpen = ref(false);
const onDelete = () => {
  if (workflowObj.currentSelectedNodeData?.id) confirmDeleteOpen.value = true;
};
const onConfirmDelete = () => {
  const id = workflowObj.currentSelectedNodeData?.id;
  if (id) deleteNode(id);
};
// reka's close (X / outside / Escape) — only reachable for NON-function nodes now
// (function nodes are persistent with no reka X, closing via requestClose instead),
// so no dirty guard is needed here.
const onOpenChange = async (open: boolean) => {
  if (!open) await commitAndClose();
};
</script>
