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
import nvidiaDcgmCard, {
  ALERT_RULES,
  COLLECTOR_CONFIG,
  DCGM_CHART_VERSION,
  DCGM_EXPORTER_IMAGE,
} from "./nvidiaDcgm";
import { getDataSourceCard } from "../registry";
import { MASKED_TOKEN } from "../subs";
import i18n from "@/locales";
import enUS from "@/locales/languages/en-US.json";

const SUBS = { url: "https://o2.example.com", org: "acme", token: "c2VjcmV0" };
const card = () => nvidiaDcgmCard(SUBS, gt);
const step = (id: string) => card().steps.find((s) => s.id === id)!;
const variant = (stepId: string, id: string) => step(stepId).variants!.find((v) => v.id === id)!;

describe("nvidiaDcgmCard", () => {
  it("is registered under the nvidiaDcgm slug", () => {
    expect(getDataSourceCard("nvidiaDcgm", SUBS, gt)?.provider.name).toBe("NVIDIA GPU");
  });

  it("walks prereqs → exporter → ship → verify → alerts", () => {
    expect(card().steps.map((s) => s.id)).toEqual([
      "prereqs",
      "exporter",
      "ship",
      "verify",
      "alerts",
    ]);
  });

  it("offers Docker and Kubernetes with matching ids across the shared platform group", () => {
    for (const id of ["prereqs", "exporter", "ship"]) {
      expect(step(id).variantGroup).toBe("platform");
      expect(step(id).variants!.map((v) => v.id)).toEqual(["docker", "kubernetes"]);
    }
  });

  it("carries the blog's recommended collector settings as valid YAML", () => {
    const cfg: any = yaml.load(COLLECTOR_CONFIG.replace(/\{(url|org|token)\}/g, "x"));
    const job = cfg.receivers.prometheus.config.scrape_configs[0];
    expect(job.scrape_interval).toBe("30s");
    expect(job.static_configs[0].targets).toEqual(["localhost:9400"]);
    expect(job.metric_relabel_configs[0]).toEqual({
      source_labels: ["__name__"],
      regex: "DCGM_.*",
      action: "keep",
    });
    expect(cfg.processors.batch).toEqual({ timeout: "10s", send_batch_size: 1024 });
    expect(cfg.service.pipelines.metrics).toEqual({
      receivers: ["prometheus"],
      processors: ["batch"],
      exporters: ["otlphttp/openobserve"],
    });
  });

  it("substitutes the org endpoint and token into the Docker collector, masked by default", () => {
    const code = variant("ship", "docker").code;
    expect(code.raw).toContain("endpoint: https://o2.example.com/api/acme");
    expect(code.raw).toContain("Authorization: Basic c2VjcmV0");
    expect(code.masked).not.toContain("c2VjcmV0");
    expect(code.masked).toContain(MASKED_TOKEN);
    expect(code.raw).not.toMatch(/\{(url|org|token)\}/);
  });

  it("runs the exporter with GPU access, SYS_ADMIN and host networking at the pinned image", () => {
    const raw = variant("exporter", "docker").code.raw;
    for (const flag of [
      "--gpus all",
      "--cap-add SYS_ADMIN",
      "--network host",
      "--restart unless-stopped",
    ]) {
      expect(raw).toContain(flag);
    }
    expect(raw).toContain(DCGM_EXPORTER_IMAGE);
    expect(raw).toContain("DCGM_EXPORTER_LISTEN=127.0.0.1:9400");
  });

  it("installs the pinned chart on GPU nodes with the annotations the collector discovers", () => {
    const raw = variant("exporter", "kubernetes").code.raw;
    expect(raw).toContain(`--version ${DCGM_CHART_VERSION}`);
    expect(raw).toContain("--timeout=5m");
    const values: any = yaml.load(raw.split("<<'EOF'\n")[1].split("\nEOF")[0]);
    expect(values.podAnnotations).toEqual({
      "prometheus.io/scrape": "true",
      "prometheus.io/port": "9400",
    });
    expect(values.serviceMonitor).toEqual({ enabled: false });
    const terms =
      values.affinity.nodeAffinity.requiredDuringSchedulingIgnoredDuringExecution.nodeSelectorTerms;
    expect(terms.map((t: any) => t.matchExpressions[0].key)).toContain("nvidia.com/gpu.present");
    // The list replaces the chart's own, and managed pools use provider-specific taints.
    expect(values.tolerations).toEqual([{ operator: "Exists" }]);
    // system-node-critical is refused outside kube-system on some managed clusters.
    expect(values.priorityClassName).toBe("");
  });

  it("detects the lower-cased dcgm_fi_* metric streams", () => {
    expect(card().detect).toEqual({
      streamType: "metrics",
      match: "keyword",
      streamName: "dcgm_fi_",
      filter: "",
    });
  });

  it("offers the companion dashboard from the verify step once data lands", () => {
    expect(step("verify").action).toMatchObject({
      id: "open-setup-dashboard",
      showOnDetect: true,
    });
  });

  it("writes bare alert queries — thresholds live in the alert, not the PromQL", () => {
    const queries = ALERT_RULES.split("\n").filter((l) => l && !l.startsWith("#"));
    expect(queries).toHaveLength(4);
    for (const q of queries) expect(q).not.toMatch(/DCGM_/);
    // The alert form applies its own threshold on top, so a baked-in comparison would double-filter.
    for (const q of queries) expect(q).not.toMatch(/[<>]=?\s*\d+\s*$/);
    // XID is a last-value gauge: changes() recovers, max_over_time would stay firing.
    expect(ALERT_RULES).toContain("changes(dcgm_fi_dev_xid_errors[5m])");
    // absent() keeps its last gap sample, so an alert on it outlives the outage.
    expect(ALERT_RULES).not.toContain("absent(");
  });

  it("links the integration guide, the gallery dashboard and NVIDIA's repo", () => {
    const c = card();
    expect(c.docUrl).toBe("https://openobserve.ai/blog/how-to-monitor-nvidia-gpu/");
    const urls = c.docLinks!.map((l) => l.url);
    expect(urls).toContain(
      "https://github.com/openobserve/dashboards/tree/main/NVIDIA%20GPU%20Monitoring",
    );
    expect(urls).toContain("https://github.com/NVIDIA/dcgm-exporter");
  });

  it("renders every GPU string in full (no vue-i18n special characters truncating it)", () => {
    const sc = (enUS as any).ingestion.setupCard as Record<string, string>;
    const keys = Object.keys(sc).filter((k) => /^(gpu|setupDashboard|pillGpu|pillXid)/.test(k));
    expect(keys.length).toBeGreaterThan(20);
    for (const k of keys) {
      const rendered = i18n.global.t(`ingestion.setupCard.${k}`, { name: "N" });
      const expected = sc[k].replaceAll("{'|'}", "|").replaceAll("{name}", "N");
      expect(rendered, k).toBe(expected);
    }
  });
});
