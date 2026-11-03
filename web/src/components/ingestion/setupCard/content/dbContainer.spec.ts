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
import yaml from "js-yaml";

import { gt } from "@/types/i18n";

import type { RichCardContent, RichCardStep, RichCardStepVariant } from "../types";
import { DB_SETUP_MODES } from "./dbInstaller";
import { COLLECTOR_IMAGE, indent } from "./dbContainer";
import { DBM_CONTRIB_VERSION } from "./dbmShared";
import postgresCard from "./postgres";
import mysqlCard from "./mysql";
import mariadbCard from "./mariadb";
import sqlServerCard from "./sqlServer";
import mongodbCard from "./mongodb";
import redisCard from "./redis";

const SUBS = { url: "https://test.openobserve.ai", org: "test-org", token: "dGVzdEB0b2tlbg==" };

const CARDS = {
  postgres: postgresCard(SUBS, gt),
  mysql: mysqlCard(SUBS, gt),
  mariadb: mariadbCard(SUBS, gt),
  sqlserver: sqlServerCard(SUBS, gt),
  mongodb: mongodbCard(SUBS, gt),
  redis: redisCard(SUBS, gt),
};
type Db = keyof typeof CARDS;
const DBS = Object.keys(CARDS) as Db[];
const DBM: Db[] = ["postgres", "mysql", "mariadb", "sqlserver"];

const step = (card: RichCardContent, id: string) => card.steps.find((s) => s.id === id)!;
const allInputs = (card: RichCardContent) =>
  card.steps.flatMap((s) => [
    ...(s.inputs ?? []),
    ...((s.variants ?? []) as RichCardStepVariant[]).flatMap((v) => v.inputs ?? []),
  ]);
/** Fills `{id}` with input defaults, first declaration winning, as the renderer does before any edit. */
const fill = (card: RichCardContent, text: string, values: Record<string, string> = {}) => {
  let out = text;
  for (const i of allInputs(card)) out = out.replaceAll(`{${i.id}}`, values[i.id] ?? i.default);
  return out;
};
/** The command of one variant (or the single command of a card without DBM). */
const code = (s: RichCardStep, withDbm: boolean) =>
  s.variants
    ? (s.variants as RichCardStepVariant[]).find(
        (v) => v.id === (withDbm ? "metrics-dbm" : "metrics"),
      )!.code
    : s.code!;
const variantsOf = (db: Db) => (DBM.includes(db) ? [false, true] : [false]);
const heredocs = (text: string) =>
  Object.fromEntries(
    [...text.matchAll(/cat > [^/]+\/([\w-]+\.yaml) <<'EOF'\n([\s\S]*?)\nEOF/g)].map((m) => [
      m[1],
      m[2],
    ]),
  );
const envRefs = (configs: string[]) =>
  [...new Set(configs.flatMap((c) => [...c.matchAll(/\$\{env:(\w+)\}/g)].map((m) => m[1])))].sort();
const manifest = (text: string) =>
  yaml.loadAll(text.split("<<'EOF'\n")[1].split("\nEOF")[0]).filter(Boolean) as any[];
/** The config the Manual mode's configure step writes, filled the same way. */
const manualConfig = (card: RichCardContent, stepId: string) => {
  const s = step(card, stepId);
  const raw = (s.variants as RichCardStepVariant[])[0].code.raw;
  return fill(card, raw.split("<<'EOF'\n")[1].split("\nEOF")[0]);
};

describe("setup modes", () => {
  it("orders the toggle Automatic, Docker, Kubernetes, Manual", () => {
    expect(DB_SETUP_MODES.map((m) => m.id)).toEqual(["auto", "docker", "kubernetes", "manual"]);
    for (const db of DBS) expect(CARDS[db].setupModes).toEqual(DB_SETUP_MODES);
  });

  it.each(DBS)("%s: tags the Docker and Kubernetes steps for their own modes", (db) => {
    const card = CARDS[db];
    expect(card.steps.filter((s) => s.mode === "docker").map((s) => s.id)).toEqual(["docker-run"]);
    expect(card.steps.filter((s) => s.mode === "kubernetes").map((s) => s.id)).toEqual([
      "k8s-deploy",
    ]);
    const ids = card.steps.map((s) => s.id);
    expect(ids.indexOf("docker-run")).toBe(ids.indexOf("quick-install") + 1);
    expect(ids.indexOf("k8s-deploy")).toBe(ids.indexOf("quick-install") + 2);
    expect(step(card, "docker-run")).toMatchObject({ required: true, completeOn: "copy" });
    expect(step(card, "k8s-deploy")).toMatchObject({ required: true, completeOn: "copy" });
  });

  it.each(DBS)("%s: gives each mode its own host field and default", (db) => {
    const card = CARDS[db];
    expect(step(card, "docker-run").inputs![0]).toMatchObject({
      id: "dockerHost",
      default: "host.docker.internal",
    });
    const k8s = step(card, "k8s-deploy").inputs!;
    expect(k8s[0]).toMatchObject({ id: "namespace", default: "openobserve-collector" });
    expect(k8s[1].id).toBe("k8sHost");
    expect(k8s[1].default).toMatch(/\.default\.svc\.cluster\.local$/);
    // The script and manual modes keep `localhost` under the shared id.
    const local = step(card, "quick-install").inputs![0];
    expect(local.default).toBe("localhost");
    expect(["host", "server"]).toContain(local.id);
  });
});

describe("Docker", () => {
  it.each(DBS.flatMap((db) => variantsOf(db).map((dbm) => [db, dbm] as const)))(
    "%s (dbm=%s): writes the card's own config and runs the pinned upstream image",
    (db, withDbm) => {
      const card = CARDS[db];
      const block = code(step(card, "docker-run"), withDbm);
      const raw = fill(card, block.raw);
      const files = heredocs(raw);
      expect(Object.keys(files)).toEqual(
        withDbm ? ["config.yaml", "dbm-config.yaml"] : ["config.yaml"],
      );
      // Identical to the manual config apart from the host the container sees.
      const hostId = db === "sqlserver" ? "server" : "host";
      const manual = manualConfig(card, "configure").replaceAll(
        `${allInputs(card).find((i) => i.id === hostId)!.default}`,
        "host.docker.internal",
      );
      expect(files["config.yaml"]).toBe(manual);
      if (withDbm) expect(files["dbm-config.yaml"]).toContain("host.docker.internal");

      expect(raw).toContain(`otel/opentelemetry-collector-contrib:${DBM_CONTRIB_VERSION}`);
      expect(COLLECTOR_IMAGE).toBe(`otel/opentelemetry-collector-contrib:${DBM_CONTRIB_VERSION}`);
      expect(raw).toContain(`docker run -d --name o2-${db}-collector --restart unless-stopped`);
      expect(raw).toContain("--add-host=host.docker.internal:host-gateway");
      expect(raw).toContain(`-v "$PWD/o2-${db}-collector:/etc/otelcol-contrib:ro"`);
      expect(raw).toContain("--config=/etc/otelcol-contrib/config.yaml");
      expect(raw.includes("--config=/etc/otelcol-contrib/dbm-config.yaml")).toBe(withDbm);

      // Every variable the configs read is passed, and nothing else.
      const passed = [...raw.matchAll(/-e (\w+)='/g)].map((m) => m[1]).sort();
      expect(passed).toEqual(envRefs(Object.values(files)));

      expect(block.masked).toBeDefined();
      expect(block.masked).not.toContain(SUBS.token);
      expect(block.raw).toContain(`Authorization: Basic ${SUBS.token}`);
    },
  );

  it.each(["postgres", "mysql", "mariadb"] as const)(
    "%s: mounts the deadlock log's directory only with Database Monitoring",
    (db) => {
      const card = CARDS[db];
      const dbm = fill(card, code(step(card, "docker-run"), true).raw);
      const logpath = allInputs(card).find((i) => i.id === "logpath")!.default;
      expect(dbm).toContain(`LOG_DIR="$(dirname '${logpath}')"`);
      expect(dbm).toContain('-v "$LOG_DIR:$LOG_DIR:ro"');
      expect(heredocs(dbm)["dbm-config.yaml"]).toContain(`include: [${logpath}]`);
      expect(fill(card, code(step(card, "docker-run"), false).raw)).not.toContain("LOG_DIR");
      const v = (step(card, "docker-run").variants as RichCardStepVariant[])[1];
      expect(v.inputs?.map((i) => i.id)).toEqual(["logpath"]);
    },
  );

  it("asks for SQL Server's DBM database only with Database Monitoring", () => {
    const s = step(CARDS.sqlserver, "docker-run");
    expect(s.inputs!.map((i) => i.id)).toEqual(["dockerHost", "port"]);
    const v = (s.variants as RichCardStepVariant[])[1];
    expect(v.inputs).toEqual([expect.objectContaining({ id: "database", default: "master" })]);
  });

  it("follows a typed host and port into the config", () => {
    const card = CARDS.redis;
    const raw = fill(card, code(step(card, "docker-run"), false).raw, {
      dockerHost: "cache",
      port: "6380",
    });
    expect(heredocs(raw)["config.yaml"]).toContain('endpoint: "cache:6380"');
  });
});

describe("Kubernetes", () => {
  it.each(DBS.flatMap((db) => variantsOf(db).map((dbm) => [db, dbm] as const)))(
    "%s (dbm=%s): applies a parseable Namespace, Secret, ConfigMap and Deployment",
    (db, withDbm) => {
      const card = CARDS[db];
      const block = code(step(card, "k8s-deploy"), withDbm);
      const raw = fill(card, block.raw, { namespace: "dbmon" });
      const docs = manifest(raw);
      const name = `o2-${db}-collector`;
      const by = (kind: string) => docs.find((d) => d.kind === kind);
      const cm = by("ConfigMap");
      const dep = by("Deployment");
      const secret = by("Secret");
      const files = Object.values(cm.data) as string[];
      const refs = envRefs(files);

      expect(by("Namespace").metadata.name).toBe("dbmon");
      expect(docs.map((d) => d.kind)).toEqual(
        refs.length
          ? ["Namespace", "Secret", "ConfigMap", "Deployment"]
          : ["Namespace", "ConfigMap", "Deployment"],
      );
      for (const d of docs.slice(1)) {
        expect(d.metadata).toMatchObject({ name, namespace: "dbmon", labels: { app: name } });
      }
      if (refs.length) expect(Object.keys(secret.stringData).sort()).toEqual(refs);

      const c = dep.spec.template.spec.containers[0];
      expect(dep.spec.replicas).toBe(1);
      expect(dep.spec.selector.matchLabels).toEqual({ app: name });
      expect(dep.spec.template.metadata.labels).toEqual({ app: name });
      expect(c.image).toBe(COLLECTOR_IMAGE);
      expect(c.args).toEqual(Object.keys(cm.data).map((f) => `--config=/etc/otelcol-contrib/${f}`));
      expect(Object.keys(cm.data)).toEqual(
        withDbm ? ["config.yaml", "dbm-config.yaml"] : ["config.yaml"],
      );
      expect(c.envFrom).toEqual(refs.length ? [{ secretRef: { name } }] : undefined);
      expect(c.volumeMounts).toEqual([
        { name: "config", mountPath: "/etc/otelcol-contrib", readOnly: true },
      ]);
      expect(dep.spec.template.spec.volumes).toEqual([{ name: "config", configMap: { name } }]);
      expect(c.resources.limits.memory).toBe(withDbm ? "1Gi" : "512Mi");

      // The embedded configs survive the indentation: they parse back to the Docker mode's files.
      const docker = heredocs(fill(card, code(step(card, "docker-run"), withDbm).raw));
      const k8sHost = step(card, "k8s-deploy").inputs![1].default;
      for (const [f, text] of Object.entries(cm.data) as [string, string][]) {
        expect(text.trimEnd().replaceAll(k8sHost, "host.docker.internal")).toBe(docker[f]);
      }

      expect(raw).toContain(`kubectl rollout restart deployment/${name} -n dbmon`);
      expect(block.masked).not.toContain(SUBS.token);
    },
  );

  it("shows no log path field: the pod cannot read the database host's log", () => {
    for (const db of ["postgres", "mysql", "mariadb"] as const) {
      const v = (step(CARDS[db], "k8s-deploy").variants as RichCardStepVariant[])[1];
      expect(v.inputs).toBeUndefined();
      expect(v.note).toContain("volume");
    }
  });
});

describe("uninstall per mode", () => {
  it.each(DBS)("%s: removes what each mode created", (db) => {
    const card = CARDS[db];
    const name = `o2-${db}-collector`;
    expect(card.extras!.uninstall!.mode).toBe("auto");
    const [docker, k8s] = card.extras!.uninstallByMode!;
    expect(docker.mode).toBe("docker");
    expect(docker.code.raw).toBe(`docker rm -f ${name}\nrm -rf ${name}`);
    expect(k8s.mode).toBe("kubernetes");
    expect(fill(card, k8s.code.raw)).toBe(
      `kubectl delete deployment,configmap,secret -n openobserve-collector -l app=${name}`,
    );
  });
});

describe("indent", () => {
  it("indents every non-empty line and leaves blank lines empty", () => {
    expect(indent("a:\n  b: 1\n\nc: 2", 4)).toBe("    a:\n      b: 1\n\n    c: 2");
  });
});
