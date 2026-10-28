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

import { describe, it, expect } from "vitest";

import { gt } from "@/types/i18n";

import type { RichCardContent, RichCardInput, RichCardStep, RichCardStepVariant } from "../types";
import { DB_SETUP_MODES, dbQuickInstallStep, dbUninstallExtra, manualOnly } from "./dbInstaller";
import { DBM_CONTRIB_VERSION } from "./dbmShared";
import { cliFlagArg } from "../subs";
import postgresCard from "./postgres";
import mysqlCard from "./mysql";
import mariadbCard from "./mariadb";
import sqlServerCard from "./sqlServer";
import mongodbCard from "./mongodb";
import redisCard from "./redis";

const SUBS = { url: "https://test.openobserve.ai", org: "test-org", token: "dGVzdEB0b2tlbg==" };
const SCRIPT =
  "https://raw.githubusercontent.com/openobserve/o2-datasource/d23d6b7cfb34b6c09f2583318063da82c84eafa3/databases";

const CARDS = {
  postgres: postgresCard(SUBS, gt),
  mysql: mysqlCard(SUBS, gt),
  mariadb: mariadbCard(SUBS, gt),
  sqlserver: sqlServerCard(SUBS, gt),
  mongodb: mongodbCard(SUBS, gt),
  redis: redisCard(SUBS, gt),
};

const quick = (card: RichCardContent) => card.steps.find((s) => s.id === "quick-install")!;
const variant = (step: RichCardStep, id: string) =>
  step.variants!.find((v) => v.id === id) as RichCardStepVariant;
/** The metrics-only command, whether the step has a DBM toggle or not. */
const metricsCode = (step: RichCardStep) =>
  step.variants ? variant(step, "metrics").code : step.code!;
/** Expands `{flag:<id>}` the way the renderer does, from defaults unless a value is given. */
const fill = (text: string, inputs: RichCardInput[], values: Record<string, string> = {}) => {
  const get = (id: string) => (values[id] ?? inputs.find((i) => i.id === id)?.default ?? "").trim();
  return inputs.reduce(
    (out, i) => out.replaceAll(`{flag:${i.id}}`, () => cliFlagArg(i, get(i.id), get)),
    text,
  );
};

describe("dbQuickInstallStep", () => {
  it("builds the installer contract's command with the org's endpoint and token", () => {
    const step = dbQuickInstallStep(gt, SUBS, {
      db: "mongodb",
      hostLabelKey: "ingestion.setupCard.mongodbHostLabel",
      defaultPort: "27017",
      defaultUser: "otel",
    });
    expect(step).toMatchObject({ id: "quick-install", mode: "auto", required: true });
    expect(step.completeOn).toBe("copy");
    const raw = step.code!.raw;
    expect(raw).toContain(`curl -fsSLo o2-db-install.sh ${SCRIPT}/install.sh`);
    // Downloaded, not piped: the script reads the password from the terminal.
    expect(raw).toContain("bash o2-db-install.sh");
    expect(raw).not.toContain("| bash");
    for (const flag of [
      "--db=mongodb",
      "{flag:serviceName}",
      "{flag:host}",
      "{flag:port}",
      "{flag:user}",
      `--o2-url=${SUBS.url}`,
      `--org-id=${SUBS.org}`,
      `O2_ACCESS_KEY=${SUBS.token} sudo --preserve-env=O2_ACCESS_KEY bash`,
    ]) {
      expect(raw).toContain(flag);
    }
    expect(raw).not.toContain("--database");
    expect(raw).not.toContain("--dbm");
    expect(raw).not.toMatch(/password/i);
  });

  it("masks the token in the displayed command", () => {
    const step = dbQuickInstallStep(gt, SUBS, {
      db: "redis",
      hostLabelKey: "ingestion.setupCard.redisHostLabel",
      defaultPort: "6379",
    });
    expect(step.code!.masked).toBeDefined();
    expect(step.code!.masked).not.toContain(SUBS.token);
    expect(step.code!.masked).toContain("O2_ACCESS_KEY=");
    expect(step.code!.raw).not.toContain("--access-key");
  });

  it("tells the Metrics-only variant that the DBM steps need the other command", () => {
    const step = dbQuickInstallStep(gt, SUBS, {
      db: "postgres",
      hostLabelKey: "ingestion.setupCard.postgresHostLabel",
      defaultPort: "5432",
      defaultUser: "myuser",
      dbm: true,
    });
    expect(variant(step, "metrics").note).toBeDefined();
    expect(JSON.stringify(variant(step, "metrics").note)).toContain(
      "Metrics + Database Monitoring",
    );
  });

  it("names the collector version the script installs and links to the manual mode", () => {
    const step = dbQuickInstallStep(gt, SUBS, {
      db: "mongodb",
      hostLabelKey: "ingestion.setupCard.mongodbHostLabel",
      defaultPort: "27017",
      defaultUser: "otel",
    });
    expect(step.note).toContain(`v${DBM_CONTRIB_VERSION}`);
    expect(step.note).toContain("(#manual)");
  });

  it("offers a Metrics + Database Monitoring variant that adds --dbm", () => {
    const step = dbQuickInstallStep(gt, SUBS, {
      db: "sqlserver",
      hostInputId: "server",
      hostLabelKey: "ingestion.setupCard.sqlServerHostLabel",
      defaultPort: "1433",
      defaultUser: "otel",
      dbm: true,
    });
    expect(step.code).toBeUndefined();
    expect(step.variants!.map((v) => v.id)).toEqual(["metrics", "metrics-dbm"]);
    expect(variant(step, "metrics").code.raw).not.toContain("--dbm");
    const dbm = variant(step, "metrics-dbm");
    expect(dbm.code.raw).toContain("--dbm");
    expect(dbm.code.raw).toContain("{flag:server}");
    expect(dbm.code.raw).not.toContain("--log-path");
    expect(dbm.code.masked).not.toContain(SUBS.token);
    // The DBM prerequisites sit below the installer, so its note sends the user there first.
    expect(dbm.note).toContain("Do the **Database Monitoring** steps below before you run this");
    expect(dbm.note).toContain("run this command again");
  });

  it.each([
    ["postgres", "/var/log/postgresql/postgresql*.log"],
    ["mysql", "/var/log/mysql/error.log"],
    ["mariadb", "/var/log/mysql/error.log"],
  ] as const)("%s: the DBM variant passes a quoted --log-path", (db, path) => {
    const step = quick(CARDS[db]);
    const dbm = variant(step, "metrics-dbm");
    expect(dbm.inputs?.map((i) => i.id)).toEqual(["logpath"]);
    // Quoted, so the shell does not expand the Postgres glob.
    expect(fill(dbm.code.raw, dbm.inputs!)).toContain(`--dbm \\\n  --log-path='${path}'`);
    expect(variant(step, "metrics").code.raw).not.toContain("logpath");
    // Same id and default as the manual DBM step, so a typed path carries across modes.
    const manual = CARDS[db].steps.find((s) => s.id === "dbm-configure")!;
    expect(manual.inputs!.find((i) => i.id === "logpath")!.default).toBe(path);
  });

  it("names the RHEL MariaDB log in the MySQL-family log path help", () => {
    const logpath = variant(quick(CARDS.mariadb), "metrics-dbm").inputs![0];
    expect(gt(logpath.helpKey!)).toContain("/var/log/mariadb/mariadb.log");
  });

  it("does not claim nothing secret is on the command line", () => {
    const note = quick(CARDS.mongodb).note!;
    expect(note).not.toContain("nothing secret");
    expect(note).toContain("access key");
  });
});

describe("command values", () => {
  const step = quick(CARDS.postgres);
  const command = (values: Record<string, string>) =>
    fill(variant(step, "metrics").code.raw, step.inputs!, values);

  it("single-quotes every typed value so spaces and metacharacters stay one argument", () => {
    const out = command({ host: "db host", port: "5432", user: "o'brien", database: "$(id)" });
    expect(out).toContain("--host='db host'");
    expect(out).toContain("--port='5432'");
    expect(out).toContain(`--db-user='o'\\''brien'`);
    expect(out).toContain("--database='$(id)'");
  });

  it("omits the flag of a cleared field so the script's default applies", () => {
    const out = command({ host: "", port: "  ", user: "", database: "", serviceName: "" });
    for (const flag of ["--host", "--port", "--db-user", "--database"]) {
      expect(out).not.toContain(flag);
    }
    expect(out).toContain("--db=postgres \\\n  --name=");
  });

  it("names the service the way the script will, in install and uninstall alike", () => {
    expect(command({ serviceName: "My PG_main" })).toContain("--name='my-pg-main'");
    const uninstall = fill(dbUninstallExtra().code.raw, step.inputs!, {
      serviceName: "My PG_main",
    });
    expect(uninstall).toContain("--name='my-pg-main'");
  });

  it("names an empty Service Name <db>-<host>-<port>, in install and uninstall alike", () => {
    const empty = { serviceName: "" };
    expect(command(empty)).toContain("--name='postgres-localhost-5432'");
    expect(fill(dbUninstallExtra().code.raw, step.inputs!, empty)).toContain(
      "sudo bash o2-db-uninstall.sh \\\n  --name='postgres-localhost-5432'",
    );
  });

  it("gives two host/port combos two different names, matched by their uninstall", () => {
    const names = [
      { host: "10.0.0.5", port: "5432", name: "postgres-10-0-0-5-5432" },
      { host: "db2.internal", port: "5433", name: "postgres-db2-internal-5433" },
    ].map(({ host, port, name }) => {
      const values = { serviceName: "", host, port };
      expect(command(values)).toContain(`--name='${name}'`);
      expect(fill(dbUninstallExtra().code.raw, step.inputs!, values)).toContain(`--name='${name}'`);
      return name;
    });
    expect(new Set(names).size).toBe(2);
  });

  it("falls back to the defaults when host and port are cleared too", () => {
    expect(command({ serviceName: "", host: " ", port: "" })).toContain(
      "--name='postgres-localhost-5432'",
    );
  });

  it("lets a typed name win over the derived one", () => {
    const values = { serviceName: "Prod PG", host: "h", port: "1" };
    expect(command(values)).toContain("--name='prod-pg'");
    expect(fill(dbUninstallExtra().code.raw, step.inputs!, values)).toContain("--name='prod-pg'");
  });

  it("is shown in the automatic mode only", () => {
    expect(dbUninstallExtra().mode).toBe("auto");
  });
});

describe("the six database cards (defaults)", () => {
  const EXPECTED: Record<
    keyof typeof CARDS,
    { flags: string[]; absent: string[]; dbm: boolean; inputs: string[] }
  > = {
    postgres: {
      flags: [
        "--db=postgres",
        "--host='localhost'",
        "--port='5432'",
        "--db-user='myuser'",
        "--database='postgres'",
      ],
      absent: [],
      dbm: true,
      inputs: ["host", "port", "user", "database", "serviceName"],
    },
    mysql: {
      flags: ["--db=mysql", "--port='3306'", "--db-user='otel'", "--database='mysql'"],
      absent: ["--log-path"],
      dbm: true,
      inputs: ["host", "port", "user", "database", "serviceName"],
    },
    mariadb: {
      flags: ["--db=mariadb", "--port='3306'", "--db-user='otel'", "--database='mysql'"],
      absent: ["--log-path"],
      dbm: true,
      inputs: ["host", "port", "user", "database", "serviceName"],
    },
    sqlserver: {
      flags: [
        "--db=sqlserver",
        "--host='localhost'",
        "--port='1433'",
        "--db-user='otel'",
        "--database='master'",
      ],
      absent: ["--log-path"],
      dbm: true,
      inputs: ["server", "port", "user", "database", "serviceName"],
    },
    mongodb: {
      flags: ["--db=mongodb", "--port='27017'", "--db-user='otel'"],
      absent: ["--database", "--dbm", "--log-path"],
      dbm: false,
      inputs: ["host", "port", "user", "serviceName"],
    },
    redis: {
      flags: ["--db=redis", "--port='6379'"],
      absent: ["--db-user", "--database", "--dbm", "--log-path"],
      dbm: false,
      inputs: ["host", "port", "serviceName"],
    },
  };

  it.each(Object.keys(CARDS) as (keyof typeof CARDS)[])(
    "%s: the default command carries its defaults",
    (db) => {
      const step = quick(CARDS[db]);
      const { flags, absent, dbm, inputs } = EXPECTED[db];
      expect(step.inputs!.map((i) => i.id)).toEqual(inputs);
      const command = fill(metricsCode(step).raw, step.inputs!);
      for (const flag of flags) expect(command).toContain(flag);
      expect(command).toContain(`--name='${db}-localhost-`);
      for (const flag of absent) expect(command).not.toContain(flag);
      expect(!!step.variants).toBe(dbm);
    },
  );

  it.each(Object.keys(CARDS) as (keyof typeof CARDS)[])(
    "%s: offers both modes, auto first, and tags each step for its path",
    (db) => {
      const card = CARDS[db];
      expect(card.setupModes).toEqual(DB_SETUP_MODES);
      expect(card.setupModes![0].id).toBe("auto");
      const auto = card.steps.filter((s) => s.mode === "auto").map((s) => s.id);
      const manual = card.steps.filter((s) => s.mode === "manual").map((s) => s.id);
      expect(auto).toEqual(["quick-install"]);
      const dbmManual = EXPECTED[db].dbm ? ["dbm-configure", "dbm-run"] : [];
      expect(manual).toEqual(["install", "configure", "run", ...dbmManual]);
      // Prerequisites and verification show in both modes.
      const shared = card.steps.filter((s) => !s.mode).map((s) => s.id);
      expect(shared).toContain("verify");
      if (db !== "redis") expect(shared[0]).toBe("prepare");
      if (EXPECTED[db].dbm)
        expect(shared).toEqual(expect.arrayContaining(["dbm-grant", "verify-dbm"]));
    },
  );

  it.each(Object.keys(CARDS) as (keyof typeof CARDS)[])(
    "%s: the installer step comes before verify, right after prepare",
    (db) => {
      const ids = CARDS[db].steps.map((s) => s.id);
      expect(ids.indexOf("quick-install")).toBe(db === "redis" ? 0 : 1);
      expect(ids.indexOf("quick-install")).toBeLessThan(ids.indexOf("verify"));
    },
  );

  it.each(Object.keys(CARDS) as (keyof typeof CARDS)[])(
    "%s: an input id shared by both modes has one default",
    (db) => {
      // The renderer keeps one value per id, so two defaults would silently pick the last.
      const all = CARDS[db].steps.flatMap((s) => [
        ...(s.inputs ?? []),
        ...((s.variants ?? []) as RichCardStepVariant[]).flatMap((v) => v.inputs ?? []),
      ]);
      const defaults = new Map<string, Set<string>>();
      for (const i of all) defaults.set(i.id, (defaults.get(i.id) ?? new Set()).add(i.default));
      for (const [id, values] of defaults) expect([id, values.size]).toEqual([id, 1]);
    },
  );

  it.each(Object.keys(CARDS) as (keyof typeof CARDS)[])(
    "%s: the default uninstall carries the derived name, never a bare command",
    (db) => {
      const card = CARDS[db];
      const install = fill(metricsCode(quick(card)).raw, quick(card).inputs!);
      const name = /--name='([^']+)'/.exec(install)![1];
      expect(fill(card.extras!.uninstall!.code.raw, quick(card).inputs!)).toContain(
        `--name='${name}'`,
      );
    },
  );

  it.each(Object.keys(CARDS) as (keyof typeof CARDS)[])(
    "%s: uninstalls by the same service name it installed with",
    (db) => {
      const card = CARDS[db];
      expect(card.extras?.uninstall).toEqual(dbUninstallExtra());
      const code = card.extras!.uninstall!.code.raw;
      expect(code).toContain(`${SCRIPT}/uninstall.sh`);
      expect(fill(code, quick(card).inputs!, { serviceName: `My ${db}` })).toContain(
        `sudo bash o2-db-uninstall.sh \\\n  --name='my-${db}'`,
      );
    },
  );
});

describe("manualOnly", () => {
  it("tags a copy and leaves the shared step untouched", () => {
    const step: RichCardStep = { id: "install", completeOn: "copy" };
    expect(manualOnly(step)).toEqual({ id: "install", completeOn: "copy", mode: "manual" });
    expect(step.mode).toBeUndefined();
  });
});
