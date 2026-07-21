// Copyright 2026 OpenObserve Inc.
//
// Validation schema for the cipherkeys "Add / Update Cipher Key" form
// (AddCipherKey.vue) and its OStepper sub-forms.
//
// This is a COUPLED family: AddCipherKey orchestrates an OStepper whose children
// (AddAkeylessType, AddEncryptionMechanism, AddOpenobserveType) render their
// fields as `OForm*` controls connected to this single parent OForm by `name`.
// Every field's rules live here, so the children stay purely presentational.
//
// All store-type-conditional requireds (Akeyless URL/regex/auth/secret branches,
// the OpenObserve `local` secret, and the simple-algorithm requirement) live in
// `superRefine`, keyed off `key.store.type` / `auth.type` / `store.type` /
// `mechanism.type`.
//
// Validation TIMING is owned by OForm (submit-then-change via revalidateLogic);
// this file only describes WHAT is valid.

import { z } from "zod";
import { isValidResourceName, validateUrl } from "@/utils/zincutils";

// name: alphanumeric + underscore + hyphen.
export const cipherKeyNameRegex = /^[a-zA-Z0-9_-]+$/;
// access_id: alphanumeric + hyphen. A `*` quantifier (PASSES on ""), so it must
// be paired with the required check in superRefine, not used standalone.
export const akeylessAccessIdRegex = /^[a-zA-Z0-9-]*$/;
// ldap username: alphanumeric + dot + underscore + hyphen.
export const akeylessLdapUsernameRegex = /^[a-zA-Z0-9._-]+$/;
// Anti-HTML guard for base_url.
const HTML_TAG_REGEX = /<[^>]*>/;

// Built via a factory so every validation message is i18n-driven (pass useI18n's
// `t`), matching the other migrated form schemas. The English wording is preserved
// verbatim in the `cipherKey.*` keys (web/src/locales/languages/en-US.json): the
// `providerTypeRequired` / `algorithmRequired` / `secretRequired` keys were already
// i18n before the migration; the name/store/akeyless messages were hardcoded English
// in the pre-migration code (validateName / validateAkeylessFields) and are now keyed
// too — same text, no behavioral change.
export const makeAddCipherKeySchema = (t: (_key: string) => string) =>
  z
  .object({
    // Always-validated scalars (AddCipherKey's own fields).
    // Hand-rolled cascade rather than `.min().max().regex().refine()` so the field
    // reports only its FIRST issue in this exact order: a trailing `.refine` would
    // run after the chained ZodString checks and surface nameInvalidChars where
    // nameInvalidResource should appear (cipherKeyNameRegex is stricter than
    // isValidResourceName, making nameInvalidResource otherwise unreachable).
    name: z.string().superRefine((v, ctx) => {
      const fail = (message: string) =>
        ctx.addIssue({ code: z.ZodIssueCode.custom, message });

      if (!v) return fail(t("cipherKey.nameRequired"));
      if (!isValidResourceName(v)) return fail(t("cipherKey.nameInvalidResource"));
      if (v.length > 50) return fail(t("cipherKey.nameMaxLength"));
      if (!cipherKeyNameRegex.test(v)) return fail(t("cipherKey.nameInvalidChars"));
    }),
    key: z.object({
      store: z.object({
        // Store type select (OpenObserve `local` vs `akeyless`) — required.
        type: z.string().min(1, t("cipherKey.typeRequired")),
        // Akeyless sub-tree. Every field is form-owned but only conditionally
        // required (store.type === "akeyless") via superRefine, so the field-level
        // shape is loose (defaults to "").
        akeyless: z.object({
          base_url: z.string().default(""),
          access_id: z.string().default(""),
          auth: z.object({
            type: z.string().default(""),
            access_key: z.string().default(""),
            ldap: z.object({
              username: z.string().default(""),
              password: z.string().default(""),
            }),
          }),
          store: z.object({
            type: z.string().default(""),
            static_secret: z.string().default(""),
            dfc: z.object({
              name: z.string().default(""),
              // dfc.iv is optional, never required.
              iv: z.string().default(""),
              encrypted_data: z.string().default(""),
            }),
          }),
        }),
        // OpenObserve secret (AddOpenobserveType's only field). Required only
        // when store.type === "local" (superRefine).
        local: z.string().default(""),
      }),
      mechanism: z.object({
        // Encryption mechanism (AddEncryptionMechanism) — type always required.
        type: z.string().min(1, t("cipherKey.providerTypeRequired")),
        // Algorithm required only when type === "simple" (superRefine).
        simple_algorithm: z.string().default(""),
      }),
    }),
  })
  .superRefine((val, ctx) => {
    const storeType = val.key.store.type;

    // ── OpenObserve (local) store → secret required ────────────────────────
    if (storeType === "local") {
      if (!val.key.store.local) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["key", "store", "local"],
          message: t("cipherKey.secretRequired"),
        });
      }
    }

    // ── Akeyless store → URL/regex + conditional requireds ─────────────────
    if (storeType === "akeyless") {
      const ak = val.key.store.akeyless;

      // base_url: required → valid http(s) URL → no HTML tags (in that order).
      if (!ak.base_url) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["key", "store", "akeyless", "base_url"],
          message: t("cipherKey.baseURLRequired"),
        });
      } else if (validateUrl(ak.base_url) !== true) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["key", "store", "akeyless", "base_url"],
          message: t("cipherKey.baseURLInvalid"),
        });
      } else if (HTML_TAG_REGEX.test(ak.base_url)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["key", "store", "akeyless", "base_url"],
          message: t("cipherKey.baseURLHtmlNotAllowed"),
        });
      }

      // access_id: required + alphanumeric/hyphen.
      if (!ak.access_id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["key", "store", "akeyless", "access_id"],
          message: t("cipherKey.accessIdRequired"),
        });
      } else if (!akeylessAccessIdRegex.test(ak.access_id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["key", "store", "akeyless", "access_id"],
          message: t("cipherKey.accessIdInvalid"),
        });
      }

      // auth.type + secret store.type are required for akeyless.
      if (!ak.auth.type) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["key", "store", "akeyless", "auth", "type"],
          message: t("cipherKey.authenticationTypeRequired"),
        });
      }
      if (!ak.store.type) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["key", "store", "akeyless", "store", "type"],
          message: t("cipherKey.secretTypeRequired"),
        });
      }

      // auth.type === "access_key" → access_key required.
      if (ak.auth.type === "access_key" && !ak.auth.access_key) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["key", "store", "akeyless", "auth", "access_key"],
          message: t("cipherKey.accessKeyRequired"),
        });
      }

      // auth.type === "ldap" → username (required + regex) + password required.
      if (ak.auth.type === "ldap") {
        if (!ak.auth.ldap.username) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["key", "store", "akeyless", "auth", "ldap", "username"],
            message: t("cipherKey.ldapUsernameRequired"),
          });
        } else if (!akeylessLdapUsernameRegex.test(ak.auth.ldap.username)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["key", "store", "akeyless", "auth", "ldap", "username"],
            message: t("cipherKey.ldapUsernameInvalid"),
          });
        }
        if (!ak.auth.ldap.password) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["key", "store", "akeyless", "auth", "ldap", "password"],
            message: t("cipherKey.ldapPasswordRequired"),
          });
        }
      }

      // store.type === "static_secret" → static_secret required.
      if (ak.store.type === "static_secret" && !ak.store.static_secret) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["key", "store", "akeyless", "store", "static_secret"],
          message: t("cipherKey.staticSecretNameRequired"),
        });
      }

      // store.type === "dfc" → dfc.name + dfc.encrypted_data required (iv is not).
      if (ak.store.type === "dfc") {
        if (!ak.store.dfc.name) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["key", "store", "akeyless", "store", "dfc", "name"],
            message: t("cipherKey.dfcNameRequired"),
          });
        }
        if (!ak.store.dfc.encrypted_data) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["key", "store", "akeyless", "store", "dfc", "encrypted_data"],
            message: t("cipherKey.dfcEncryptedDataRequired"),
          });
        }
      }
    }

    // ── Encryption mechanism → algorithm required when type === "simple" ───
    if (
      val.key.mechanism.type === "simple" &&
      !val.key.mechanism.simple_algorithm
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["key", "mechanism", "simple_algorithm"],
        message: t("cipherKey.algorithmRequired"),
      });
    }
  });

export type AddCipherKeyForm = z.infer<
  ReturnType<typeof makeAddCipherKeySchema>
>;

// STATIC create defaults (typed factory — bound `:default-values` at mount).
// Edit-mode prefill arrives async, so the component re-seeds via
// `formRef.form.reset(record)` once the record loads.
export const addCipherKeyDefaults = (): AddCipherKeyForm => ({
  name: "",
  key: {
    store: {
      type: "local",
      akeyless: {
        base_url: "",
        access_id: "",
        auth: {
          type: "access_key",
          access_key: "",
          ldap: { username: "", password: "" },
        },
        store: {
          type: "static_secret",
          static_secret: "",
          dfc: { name: "", iv: "", encrypted_data: "" },
        },
      },
      local: "",
    },
    mechanism: { type: "simple", simple_algorithm: "aes-256-siv" },
  },
});
