// Copyright 2026 OpenObserve Inc.
//
// Headless form factory — the exact `useForm` configuration that <OForm> uses
// internally, extracted so a component that OWNS <OForm> can create the form in
// its own setup() and read it reactively (form.useStore) to drive parent-side
// conditional rendering (v-if / v-for / OStepper), then hand it to
// <OForm :form="form">.
//
// Use this ONLY when the OWNER of <OForm> needs reactive form state at setup
// (e.g. a discriminated form whose visible sections depend on a `kind` field).
// A component rendered INSIDE <OForm> (a descendant) does NOT need this — it can
// `inject(FORM_CONTEXT_KEY)` and call `form.useStore(...)` directly. And simple
// forms with no parent-side conditional rendering keep the plain
// <OForm :schema :default-values @submit> form (OForm creates the form itself
// via this same helper).
//
// The config here MUST stay identical to OForm.vue's fallback so an internal and
// an externally-supplied form behave the same: submit-then-change timing
// (revalidateLogic) + a single `onDynamic` schema source + an awaited onSubmit
// (which drives the auto Save spinner and guards double-submit).

import { getCurrentScope, onScopeDispose, shallowRef } from "vue";
import { useForm, revalidateLogic } from "@tanstack/vue-form";
import type { DeepKeys } from "@tanstack/form-core";

import type { I18nText } from "@/types/i18n";
import { firstFieldError, leaveDisplay, type LeaveDisplay } from "./fieldError";
import type { FormValidateOn } from "./OForm.types";

/**
 * The set of valid field-path strings for a form of shape `T` (what
 * setFieldValue/validateField/getFieldMeta accept as their first argument).
 * Components that access fields by a dynamically-built string cast the string
 * to this so it satisfies TanStack's DeepKeys union without widening the form.
 */
export type FormFieldPath<T> = DeepKeys<T>;

export interface UseOFormOptions<T extends Record<string, unknown>> {
  /** Initial values for all fields (same shape as OForm's :default-values). */
  defaultValues: T;
  /** Zod (Standard Schema) validating the whole form; mapped to fields by `name`. */
  schema?: unknown;
  /**
   * Awaited submit handler — runs once the schema passes. Awaiting it keeps
   * TanStack's `isSubmitting` true for the whole save (drives the Save spinner).
   */
  onSubmit?: (_values: T) => unknown | Promise<unknown>;
  /** `"leave"` shows a changed field's error when the user leaves it; `"submit"` (default) waits for the first submit. */
  validateOn?: FormValidateOn;
  /** Groups of fields checked together (leave mode); a shared message prints once, on each group's last member. */
  coupled?: FormFieldPath<T>[][];
}

interface LeaveFieldMeta {
  isDirty: boolean;
  isBlurred: boolean;
  errors: readonly unknown[];
}

interface LeaveTrackedForm {
  state: { submissionAttempts: number; fieldMeta: Record<string, LeaveFieldMeta | undefined> };
  validateAsync: (..._args: any[]) => Promise<any>;
  store: { subscribe: (_listener: () => void) => (() => void) | { unsubscribe: () => void } };
  setFieldMeta: (_name: any, _updater: (_meta: any) => any) => void;
}

/**
 * Create a TanStack form pre-wired exactly like <OForm> does internally:
 * submit-then-change timing (revalidateLogic) + single onDynamic schema source +
 * awaited onSubmit. Pass the result to <OForm :form="form">; the owner can then
 * read it with `form.useStore(selector)` and write it with
 * `form.setFieldValue(...)` — a single source of truth, no mirror.
 */
export function useOForm<T extends Record<string, unknown>>(options: UseOFormOptions<T>) {
  const onLeave = options.validateOn === "leave";
  const form = useForm({
    // Pass defaultValues unwidened so the form generic `T` flows into useForm and
    // the array-field helpers (pushFieldValue/removeFieldValue) resolve real
    // array paths instead of `never`. Components doing dynamic string field access
    // cast the path to `FormFieldPath<T>` (see useOForm exports below).
    defaultValues: options.defaultValues,
    // When a schema is supplied, validation TIMING is submit-then-change: nothing
    // runs until the first submit, then it re-validates on every change. The
    // schema lives in the single `onDynamic` source TanStack runs.
    ...(options.schema
      ? {
          validationLogic: revalidateLogic({
            // Leave mode computes errors from the first change; fieldError.ts decides when they show.
            mode: onLeave ? "change" : "submit",
            modeAfterSubmission: "change",
          }),
          validators: {
            onDynamic: options.schema as any,
            onDynamicAsync: options.schema as any,
          },
        }
      : {}),
    // AWAIT the consumer handler so `isSubmitting` spans the whole save.
    onSubmit: async ({ value }) => {
      await options.onSubmit?.(value as T);
    },
  });
  if (onLeave) {
    trackLeaveDisplay(form as unknown as LeaveTrackedForm, (options.coupled ?? []) as string[][]);
  }
  return form;
}

/** The form instance returned by useOForm — accepted by <OForm :form>. */
export type OFormInstance = ReturnType<typeof useOForm<any>>;

/** Pin server-reported errors onto fields, or clear them with `{}`; TanStack never re-validates `onServer` on change. */
export function setServerFieldErrors<T extends Record<string, unknown>>(
  form: ReturnType<typeof useOForm<T>>,
  fields: Partial<Record<FormFieldPath<T>, I18nText>>,
) {
  // useOForm declares no server validator, which narrows the slot's type to `undefined`.
  form.setErrorMap({
    onServer: { form: undefined, fields } as unknown as Parameters<
      typeof form.setErrorMap
    >[0]["onServer"],
  });
}

// Per validate-on-leave form: reveals the fields a caller validated itself.
const explicitReveal = new WeakMap<object, (_names: string[]) => void>();

/** Shows the errors of fields the caller has just validated; a validate-on-leave form otherwise waits for a leave or a Save. */
export function revealFieldErrors(form: object, names: string[]) {
  explicitReveal.get(form)?.(names);
}

function trackLeaveDisplay(form: LeaveTrackedForm, coupled: string[][]) {
  const display = shallowRef<LeaveDisplay>({ revealed: new Set(), silenced: new Set() });
  leaveDisplay.set(form, display);
  const validated = new Set<string>();
  let signature = "";
  let syncing = false;
  let passes = 0;

  const sync = () => {
    // setFieldMeta below re-enters this listener; the outer pass reads the settled state.
    if (syncing) return;
    syncing = true;
    try {
      if (passes === 0) {
        rearmFixedFields(form);
        // Like a left field, a validated one that is fixed waits for the next leave or validate.
        for (const name of validated) {
          if (!form.state.fieldMeta[name]?.errors.length) validated.delete(name);
        }
      }
      const next = computeLeaveDisplay(form, coupled, validated);
      const nextSignature = `${[...next.revealed].sort()}#${[...next.silenced].sort()}`;
      if (nextSignature !== signature) {
        signature = nextSignature;
        display.value = next;
      }
    } finally {
      syncing = false;
    }
  };

  // An older pass still in flight writes its stale "no error" before the newest one lands, so wait for all of them.
  const runPass = form.validateAsync;
  form.validateAsync = async (...args) => {
    passes += 1;
    try {
      return await runPass(...args);
    } finally {
      passes -= 1;
      if (passes === 0) sync();
    }
  };

  explicitReveal.set(form, (names) => {
    for (const name of names) validated.add(name);
    sync();
  });

  const subscription = form.store.subscribe(sync);
  if (getCurrentScope()) {
    onScopeDispose(() =>
      typeof subscription === "function" ? subscription() : subscription.unsubscribe(),
    );
  }
}

// A left field with no error forgets the leave, so its next error waits for the next leave.
function rearmFixedFields(form: LeaveTrackedForm) {
  if (form.state.submissionAttempts > 0) return;
  for (const [name, meta] of Object.entries(form.state.fieldMeta)) {
    if (meta?.isBlurred && meta.errors.length === 0) {
      form.setFieldMeta(name, (m) => ({ ...m, isBlurred: false }));
    }
  }
}

function computeLeaveDisplay(
  form: LeaveTrackedForm,
  coupled: string[][],
  validated: ReadonlySet<string>,
): LeaveDisplay {
  const { fieldMeta, submissionAttempts } = form.state;
  const revealed = new Set<string>(validated);
  for (const [name, meta] of Object.entries(fieldMeta)) {
    if (submissionAttempts > 0 || (meta?.isDirty && meta.isBlurred)) revealed.add(name);
  }
  const silenced = new Set<string>();
  for (const group of coupled) {
    if (!group.some((name) => revealed.has(name))) continue;
    const anchor = group[group.length - 1];
    const anchorMessage = firstFieldError(fieldMeta[anchor]?.errors);
    for (const name of group) {
      revealed.add(name);
      const shared = anchorMessage !== undefined && name !== anchor;
      if (shared && firstFieldError(fieldMeta[name]?.errors) === anchorMessage) silenced.add(name);
    }
  }
  return { revealed, silenced };
}
