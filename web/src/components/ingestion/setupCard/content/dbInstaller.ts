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

// The o2-datasource databases/install.sh one-command installer, offered by the database cards as their "auto" setup mode.

import { raw, type I18nKey, type TranslateFn } from "@/types/i18n";

import type {
  CardSubstitutions,
  RichCardExtras,
  RichCardInput,
  RichCardSetupMode,
  RichCardStep,
  RichCardStepVariant,
} from "../types";
import { applySubs, applySubsMasked } from "../subs";
import { DBM_CONTRIB_VERSION } from "./dbmShared";

const SCRIPT_BASE =
  "https://raw.githubusercontent.com/openobserve/o2-datasource/d23d6b7cfb34b6c09f2583318063da82c84eafa3/databases";

/** The installer's `--db` values. */
export type InstallerDb = "postgres" | "mysql" | "mariadb" | "sqlserver" | "mongodb" | "redis";

/** Automatic first: it is the path the cards recommend. */
export const DB_SETUP_MODES: RichCardSetupMode[] = [
  { id: "auto", labelKey: "ingestion.setupCard.setupModeAuto" },
  { id: "manual", labelKey: "ingestion.setupCard.setupModeManual" },
];

/** Tags an existing manual step so it renders only in the Manual setup mode. */
export const manualOnly = (step: RichCardStep): RichCardStep => ({ ...step, mode: "manual" });

export interface DbQuickInstallOptions {
  db: InstallerDb;
  /** Host input id; shared with the manual configure step so one value fills both. */
  hostInputId?: string;
  hostLabelKey: I18nKey;
  defaultPort: string;
  /** Omitted for Redis, which has no monitoring user. */
  defaultUser?: string;
  /** Postgres / MySQL / MariaDB only; must equal the card's DBM `database` default (shared id). */
  defaultDatabase?: string;
  /** Adds the "Metrics + Database Monitoring" variant (`--dbm`). */
  dbm?: boolean;
  /** The log file the DBM config tails for deadlocks (`--log-path`); its id is shared with the manual DBM step. */
  dbmLogPath?: { default: string; labelKey: I18nKey; helpKey: I18nKey };
}

const SERVICE_INPUT = "serviceName";

// `{flag:<id>}` becomes a quoted `--x='v'` line or nothing when cleared; the key travels as an env var so it stays out of `ps`.
const installCommand = (opts: DbQuickInstallOptions, withDbm: boolean) => {
  const userFlags = stepInputs(opts)
    .map((i) => `{flag:${i.id}}`)
    .join("");
  const dbmFlags = withDbm
    ? ` \\\n  --dbm${opts.dbmLogPath !== undefined ? "{flag:logpath}" : ""}`
    : "";
  return `curl -fsSLo o2-db-install.sh ${SCRIPT_BASE}/install.sh && \\
O2_ACCESS_KEY={token} sudo --preserve-env=O2_ACCESS_KEY bash o2-db-install.sh \\
  --db=${opts.db}${userFlags} \\
  --o2-url={url} \\
  --org-id={org}${dbmFlags}`;
};

const codeFor = (template: string, subs: CardSubstitutions) => ({
  lang: "bash",
  raw: applySubs(template, subs),
  masked: applySubsMasked(template, subs),
});

const stepInputs = (opts: DbQuickInstallOptions): RichCardInput[] => [
  {
    id: opts.hostInputId ?? "host",
    cliFlag: "--host",
    labelKey: opts.hostLabelKey,
    default: "localhost",
    placeholder: raw("localhost"),
  },
  {
    id: "port",
    cliFlag: "--port",
    labelKey: "ingestion.setupCard.portLabel",
    default: opts.defaultPort,
    placeholder: raw(opts.defaultPort),
    width: "sm",
  },
  ...(opts.defaultUser !== undefined
    ? [
        {
          id: "user",
          cliFlag: "--db-user",
          labelKey: "ingestion.setupCard.dbInstallerUserLabel",
          default: opts.defaultUser,
          placeholder: raw(opts.defaultUser),
          helpKey: "ingestion.setupCard.dbInstallerUserHelp",
        } satisfies RichCardInput,
      ]
    : []),
  ...(opts.defaultDatabase !== undefined
    ? [
        {
          id: "database",
          cliFlag: "--database",
          labelKey: "ingestion.setupCard.dbmDatabaseLabel",
          default: opts.defaultDatabase,
          placeholder: raw(opts.defaultDatabase),
        } satisfies RichCardInput,
      ]
    : []),
  {
    id: SERVICE_INPUT,
    cliFlag: "--name",
    sanitize: "slug",
    labelKey: "ingestion.setupCard.dbInstallerServiceNameLabel",
    default: "",
    // Spelled out so uninstall (which needs a name) targets what install created; mirrors install.sh's `<db>-<host>-<port>`.
    fallback: (get) =>
      `${opts.db}-${get(opts.hostInputId ?? "host") || "localhost"}-${get("port") || opts.defaultPort}`,
    placeholder: raw(`${opts.db}-<host>-<port>`),
    helpKey: "ingestion.setupCard.dbInstallerServiceNameHelp",
  },
];

/** The auto-mode install step; DBM-capable cards get a Metrics / Metrics + Database Monitoring toggle. */
export function dbQuickInstallStep(
  t: TranslateFn,
  subs: CardSubstitutions,
  opts: DbQuickInstallOptions,
): RichCardStep {
  const note = raw(
    [
      t(
        opts.defaultUser !== undefined
          ? "ingestion.setupCard.dbInstallerNote"
          : "ingestion.setupCard.dbInstallerNoteRedis",
        { version: DBM_CONTRIB_VERSION },
      ),
      t("ingestion.setupCard.dbInstallerManualHint"),
    ].join(" "),
  );
  const variants: RichCardStepVariant[] | undefined = opts.dbm
    ? [
        {
          id: "metrics",
          labelKey: "common.metrics",
          code: codeFor(installCommand(opts, false), subs),
          note: raw(`${t("ingestion.setupCard.dbInstallerMetricsOnlyNote")} ${note}`),
        },
        {
          id: "metrics-dbm",
          labelKey: "ingestion.setupCard.dbInstallerDbmVariant",
          code: codeFor(installCommand(opts, true), subs),
          inputs:
            opts.dbmLogPath !== undefined
              ? [
                  {
                    id: "logpath",
                    cliFlag: "--log-path",
                    labelKey: opts.dbmLogPath.labelKey,
                    default: opts.dbmLogPath.default,
                    placeholder: raw(opts.dbmLogPath.default),
                    helpKey: opts.dbmLogPath.helpKey,
                  },
                ]
              : undefined,
          note: raw(`${t("ingestion.setupCard.dbInstallerDbmNote")} ${note}`),
        },
      ]
    : undefined;
  return {
    id: "quick-install",
    mode: "auto",
    titleKey: "ingestion.setupCard.quickInstallTitle",
    descriptionKey: "ingestion.setupCard.dbQuickInstallDesc",
    chip: { kind: "terminal", labelKey: "ingestion.setupCard.chipTerminal" },
    required: true,
    completeOn: "copy",
    inputs: stepInputs(opts),
    code: variants ? undefined : codeFor(installCommand(opts, false), subs),
    note: variants ? undefined : note,
    variants,
  };
}

/** How to remove what the quick-install step added, keyed by the same service name. */
export function dbUninstallExtra(): NonNullable<RichCardExtras["uninstall"]> {
  return {
    mode: "auto",
    labelKey: "ingestion.setupCard.dbUninstallLabel",
    descriptionKey: "ingestion.setupCard.dbUninstallDesc",
    code: {
      lang: "bash",
      raw: `curl -fsSLo o2-db-uninstall.sh ${SCRIPT_BASE}/uninstall.sh && \\
sudo bash o2-db-uninstall.sh{flag:${SERVICE_INPUT}}`,
    },
  };
}
