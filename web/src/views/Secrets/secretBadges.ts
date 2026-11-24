// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import { raw, type I18nText, type TranslateFn } from "@/types/i18n";
import {
  ORG_ENV_ID,
  type ConsumerType,
  type PinMode,
  type PrivateLocations,
  type SecretEnvSummary,
  type SecretState,
} from "@/services/secrets";

export interface SecretBadge {
  id: string;
  label: I18nText;
  variant: BadgeVariant;
  icon?: string;
  /** Set when the badge carries a reason the reader should be able to see. */
  title?: I18nText;
}

interface BadgeInput {
  kind: "secret" | "variable";
  state: SecretState;
  pin_mode: PinMode;
  pin_override_reason?: string;
  private_locations: PrivateLocations;
  private_locations_reason?: string;
}

const TYPE_KEYS = {
  alert_destination: "secrets.consumerTypes.alertDestination",
  pipeline_destination: "secrets.consumerTypes.pipelineDestination",
  synthetics_check: "secrets.consumerTypes.syntheticsCheck",
  ai_toolset: "secrets.consumerTypes.aiToolset",
} as const;

const ALL_TYPE_KEYS = {
  alert_destination: "secrets.allowedAll.alertDestination",
  pipeline_destination: "secrets.allowedAll.pipelineDestination",
  synthetics_check: "secrets.allowedAll.syntheticsCheck",
  ai_toolset: "secrets.allowedAll.aiToolset",
} as const;

export const consumerTypeLabel = (t: TranslateFn, type: ConsumerType): I18nText =>
  t(TYPE_KEYS[type]);

/** One line per allowed type: "All alert destinations", or a count when ids are picked. */
export const allowedForLabels = (
  t: TranslateFn,
  types: ConsumerType[],
  selectedCount: number,
): I18nText[] => {
  if (types.length === 1 && selectedCount > 0) {
    return [t("secrets.allowedSelected", { count: selectedCount, type: t(TYPE_KEYS[types[0]]) })];
  }
  return types.map((type) => t(ALL_TYPE_KEYS[type]));
};

/** Pin badges (V38): only a missing, legacy or overridden pin is worth a colour. */
export const pinBadges = (t: TranslateFn, row: BadgeInput): SecretBadge[] => {
  if (row.kind !== "secret") return [];
  switch (row.pin_mode) {
    case "none":
      return [
        {
          id: "not-pinned",
          label: t("secrets.badges.notPinned"),
          variant: "warning-soft",
          icon: "warning",
        },
      ];
    case "legacy":
      return [
        {
          id: "legacy",
          label: t("secrets.badges.legacyNoPin"),
          variant: "warning-soft",
          icon: "warning",
        },
      ];
    case "any":
      return [
        {
          id: "any-host",
          label: t("secrets.badges.anyHost"),
          variant: "error-soft",
          icon: "public",
          title: row.pin_override_reason
            ? t("secrets.badges.reason", { reason: row.pin_override_reason })
            : undefined,
        },
      ];
    default:
      return [];
  }
};

/** Private-location badges (V41): `off` is the default and stays quiet. */
export const privateLocationBadges = (t: TranslateFn, row: BadgeInput): SecretBadge[] => {
  if (row.private_locations === "on") {
    return [
      {
        id: "private-locations",
        label: t("secrets.badges.privateLocations"),
        variant: "amber-soft",
        icon: "location-on",
        title: row.private_locations_reason
          ? t("secrets.badges.reason", { reason: row.private_locations_reason })
          : undefined,
      },
    ];
  }
  if (row.private_locations === "legacy") {
    return [
      {
        id: "private-locations-legacy",
        label: t("secrets.badges.privateLocationsLegacy"),
        variant: "amber-soft",
        icon: "location-on",
      },
    ];
  }
  return [];
};

export const stateBadges = (t: TranslateFn, row: BadgeInput): SecretBadge[] => {
  if (row.state === "deleted") {
    return [{ id: "deleted", label: t("secrets.badges.deleted"), variant: "error-soft" }];
  }
  if (row.state === "conflict") {
    return [{ id: "conflict", label: t("secrets.badges.conflict"), variant: "warning-soft" }];
  }
  return [];
};

export const envLabel = (t: TranslateFn, env: string): I18nText =>
  env === ORG_ENV_ID ? t("secrets.orgEnv") : raw(env);

/** Environment chips; an inherited override adds nothing the org chip does not say. */
export const envChips = (t: TranslateFn, envs: SecretEnvSummary[]): SecretBadge[] =>
  [...envs]
    .filter((e) => e.state !== "inherit" && e.state !== "deleted")
    .sort((a, b) =>
      a.env === ORG_ENV_ID ? -1 : b.env === ORG_ENV_ID ? 1 : a.env.localeCompare(b.env),
    )
    .map((e) =>
      e.state === "unset"
        ? {
            id: e.env,
            label: t("secrets.envUnset", { env: envLabel(t, e.env) }),
            variant: "warning-soft" as BadgeVariant,
            icon: "warning",
          }
        : {
            id: e.env,
            label: envLabel(t, e.env),
            variant: (e.env === ORG_ENV_ID ? "default-soft" : "teal-soft") as BadgeVariant,
          },
    );
