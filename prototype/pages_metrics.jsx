// pages_metrics.jsx — Metrics explorer (metric tree + PromQL + chart + legend)
const { useState: uM } = React;

const METRIC_TREE = [
  { group: "HTTP", metrics: ["http_requests_total", "http_request_duration_seconds", "http_response_size_bytes"] },
  { group: "System", metrics: ["cpu_usage_percent", "memory_usage_bytes", "disk_io_ops", "fd_open_count"] },
  { group: "Runtime", metrics: ["go_goroutines", "go_gc_duration_seconds", "process_uptime_seconds"] },
  { group: "OpenObserve", metrics: ["oo_ingest_records_total", "oo_query_latency_ms", "oo_compaction_runs"] },
];
const SERIES = [
  { label: "api-gateway", hue: 210 }, { label: "auth-svc", hue: 150 },
  { label: "orders-svc", hue: 28 }, { label: "payments-svc", hue: 280 },
];
function seriesPath(hueSeed, w = 100, h = 44) {
  const pts = Array.from({ length: 24 }, (_, i) => h - 6 - Math.abs(Math.sin((i + hueSeed) / 3) + 0.5 * Math.cos(i / 2)) * (h - 16));
  return pts.map((y, i) => `${i === 0 ? "M" : "L"} ${(i / 23) * w} ${y.toFixed(1)}`).join(" ");
}

function MetricsPage() {
  const ui = React.useContext(window.StateCtx);
  const [metric, setMetric] = uM("http_requests_total");
  const [q, setQ] = uM('rate(http_requests_total{job="api"}[5m])');
  const [open, setOpen] = uM({ HTTP: true, System: true, Runtime: false, OpenObserve: false });
  const [mq, setMq] = uM("");
  const [hidden, setHidden] = uM({});

  return (
    <div className="panel fade-in" style={{ flexDirection: "row" }}>
      <span className="annot-badge">Flat explorer module · in-content metric tree (left) + PromQL bar + chart · mirrors Logs’ shape for consistency</span>
      {/* metric tree — in-content, like the Logs fields list */}
      <aside className="l2" data-annot="in-content metric tree">
        <div className="l2-head"><span className="l2-title">Metrics</span></div>
        <div className="l2-search"><Field placeholder="Search metrics" value={mq} onChange={setMq} /></div>
        <div className="l2-list">
          {METRIC_TREE.map(g => {
            const items = g.metrics.filter(m => m.toLowerCase().includes(mq.toLowerCase()));
            if (!items.length) return null;
            return (
              <div key={g.group} className="l2-group">
                <button className={"l2-ghead" + (open[g.group] ? "" : " collapsed")} onClick={() => setOpen(o => ({ ...o, [g.group]: !o[g.group] }))}>
                  {g.group}{Ic("chevDown", { size: 13, className: "chev" })}
                </button>
                {open[g.group] && items.map(m => (
                  <button key={m} className={"l2-link" + (metric === m ? " active" : "")} onClick={() => { setMetric(m); setQ(`rate(${m}{job="api"}[5m])`); }}>
                    {Ic("metrics", { size: 15 })}<span className="mono" style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis" }}>{m}</span>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </aside>

      {/* content */}
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
        <PageHeader icon="metrics" title="Metrics"
          actions={<>
            <button className="chip" onClick={() => toast("Time range", "info")}>{Ic("clock", { size: 15 })} Last 1 hour {Ic("chevDown", { size: 13 })}</button>
            <Btn icon="refresh" sm onClick={() => toast("Refreshed", "info")} />
            <Btn variant="primary" icon="plus" onClick={() => toast("Added to dashboard")}>Add to dashboard</Btn>
          </>} />
        {/* PromQL bar */}
        <div style={{ display: "flex", gap: 10, padding: "12px 14px", borderBottom: "1px solid var(--border-soft)", alignItems: "center" }} data-annot="PromQL query bar">
          <div className="seg"><button className="active">PromQL</button><button onClick={() => toast("Builder mode", "info")}>Builder</button></div>
          <div className="field search-lg grow"><span className="mono" style={{ color: "var(--text-3)", fontSize: 12 }}>Σ</span>
            <input className="mono" placeholder="rate(metric[5m])" value={q} onChange={e => setQ(e.target.value)} /></div>
          <Btn variant="primary" icon="play" onClick={() => toast("Query executed", "info")}>Run</Btn>
        </div>
        {/* chart */}
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 16px", fontSize: 12, color: "var(--text-3)" }}>
            <span className="mono" style={{ color: "var(--text)", fontWeight: 600 }}>{metric}</span>
            <span className="ft-spacer" style={{ flex: 1 }} />
            <span>step 15s</span>
            <div className="seg"><button className="active">Line</button><button onClick={() => toast("Stacked area", "info")}>Area</button><button onClick={() => toast("Heatmap", "info")}>Heatmap</button></div>
          </div>
          <div style={{ flex: 1, minHeight: 0, padding: "4px 16px 12px", position: "relative" }}>
            {ui === "loading"
              ? <div style={{ padding: 20 }}><Skeleton w="100%" h={180} r={10} /></div>
              : ui === "empty"
                ? <Empty icon="metrics" title="No data" hint="Pick a metric and run a query">Select a metric from the tree and run a PromQL query.</Empty>
                : <svg viewBox="0 0 100 44" preserveAspectRatio="none" style={{ width: "100%", height: "100%" }}>
              {[10, 20, 30].map(y => <line key={y} x1="0" x2="100" y1={y} y2={y} stroke="var(--border-soft)" strokeWidth="0.4" />)}
              {SERIES.map((s, i) => hidden[s.label] ? null : (
                <path key={s.label} d={seriesPath(i * 7 + 2)} fill="none" stroke={`hsl(${s.hue} 65% 52%)`} strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
              ))}
            </svg>}
          </div>
          {/* legend — click to toggle series */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "10px 16px", borderTop: "1px solid var(--border-soft)" }} data-annot="interactive legend">
            {SERIES.map(s => (
              <button key={s.label} className="chip" onClick={() => setHidden(h => ({ ...h, [s.label]: !h[s.label] }))}
                style={{ opacity: hidden[s.label] ? 0.45 : 1 }}>
                <span className="dot" style={{ background: `hsl(${s.hue} 65% 52%)` }} />
                <span className="mono" style={{ fontSize: 11 }}>{s.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

window.MetricsPage = MetricsPage;
