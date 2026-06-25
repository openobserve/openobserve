// Copyright 2026 OpenObserve Inc.
//
// Validation schemas for the two add-rows in DomainManagement.vue (Settings >
// Domain Management). This is an add-to-list / dynamic-array shape (partial
// fit): only the two add-rows are OForm-validated; the rendered domain/email
// lists + radios are display, and the save-time "domain needs emails" check
// stays a submit-level guard in saveChanges().
//
// Restores the Quasar BEFORE rules (truthy→Zod inversion):
//   • newDomain: `isValidDomain(v) || invalidDomain` → required + domain regex
//     (the audit adds ≤253 + reject-malicious, already enforced by isValidDomain).
//   • domain.newEmail: `!v || isValidEmail(v, domain) || invalidEmail` → kept
//     CONDITIONAL (empty passes; only format-checked when present).
//
// The pure validators live here so they are shared by the schema AND re-exposed
// from the component (the spec exercises them directly). Validation TIMING is
// owned by OForm (submit-then-change); these schemas only describe what is valid.

import { z } from "zod";

export const isValidDomain = (domain: any): boolean => {
  // Handle null, undefined, and non-string inputs
  if (domain === null || domain === undefined) return true; // Empty is valid
  if (typeof domain !== "string") return false; // Non-strings are invalid

  // Handle empty strings - empty is valid, but whitespace-only is not
  const trimmed = domain.trim();
  if (!trimmed) return domain.length === 0; // Empty string is valid, whitespace-only is not

  // Security: Check for potentially malicious content (more targeted patterns)
  const maliciousPatterns = [
    "<script", "</script", "javascript:", "DROP TABLE", "SELECT FROM",
    "INSERT INTO", "UPDATE SET", "DELETE FROM", "UNION SELECT", "--", "/*",
    "*/", "\0", "\n", "\r",
  ];

  const upperDomain = trimmed.toUpperCase();
  if (
    maliciousPatterns.some((pattern) =>
      upperDomain.includes(pattern.toUpperCase()),
    )
  ) {
    return false;
  }

  // Length validation (DNS limit is 253 characters)
  if (trimmed.length > 253) return false;

  // Remove trailing dot if present (valid in DNS)
  const cleanDomain = trimmed.endsWith(".") ? trimmed.slice(0, -1) : trimmed;

  // Each label can be 1-63 characters, the domain must have at least one dot.
  const domainRegex =
    /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;

  try {
    return domainRegex.test(cleanDomain);
  } catch (error) {
    return false; // Any regex error means invalid
  }
};

export const isValidEmail = (email: any, domain: any): boolean => {
  // Handle null, undefined, and non-string inputs
  if (email === null || email === undefined || typeof email !== "string")
    return false;
  if (domain === null || domain === undefined || typeof domain !== "string")
    return false;

  // Handle empty strings
  if (!email.trim() || !domain.trim()) return false;

  // Security: Check for potentially malicious content
  const maliciousPatterns = [
    "<", ">", "script", "javascript:", "DROP", "SELECT", "INSERT", "UPDATE",
    "DELETE", "UNION", "CREATE", "ALTER", "TABLE", "FROM", "--", "/*", "*/",
    "'", '"', "\0", "\n", "\r", "\t",
  ];

  const upperEmail = email.toUpperCase();
  if (
    maliciousPatterns.some((pattern) =>
      upperEmail.includes(pattern.toUpperCase()),
    )
  ) {
    return false;
  }

  // Length validation (practical email limit)
  if (email.length > 254 || domain.length > 253) return false;

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  try {
    if (!emailRegex.test(email)) return false;
    // Check if email belongs to the domain
    return email.toLowerCase().endsWith(`@${domain.toLowerCase()}`);
  } catch (error) {
    return false; // Any error means invalid
  }
};

// ── Add-domain row: required + valid domain ──────────────────────────────────
export const makeAddDomainSchema = (t: (_key: string) => string) =>
  z.object({
    newDomain: z
      .string()
      .min(1, t("settings.domainRequired") || "Domain is required")
      .refine((v) => isValidDomain(v), {
        message:
          t("settings.invalidDomain") ||
          "Please enter a valid domain (e.g. example.com)",
      }),
  });

export type AddDomainForm = z.infer<ReturnType<typeof makeAddDomainSchema>>;

// ── Add-email row (per-domain): CONDITIONAL — empty passes, format-checked when
//    present and must belong to the domain. ──────────────────────────────────
export const makeAddEmailSchema = (
  domainName: string,
  t: (_key: string) => string,
) =>
  z.object({
    newEmail: z
      .string()
      .optional()
      .refine((v) => !v || isValidEmail(v, domainName), {
        message: t("settings.invalidEmail") || "Please enter a valid email",
      }),
  });

export type AddEmailForm = z.infer<ReturnType<typeof makeAddEmailSchema>>;
