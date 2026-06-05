// pages_explorer.jsx — shared Explorer shell for Logs / Metrics / Traces / RUM
const { useState: uX } = React;

/* ---------- shared field rail ---------- */
function FieldRail({ stream, streams, groups, onPick }) {
  const [q, setQ] = uX("");
  const [collapsed, setCollapsed] = uX(() => Object.fromEntries(groups.filter(g => g.collapsed).map(g => [g.group, true])));
  return (
    <aside className="fieldrail" data-annot="in-content field rail (stream + searchable fields)">
      <div className="fr-stream">
        <div className="fr-sel">
          <span className="fr-ico">{Ic("streams", { size: 13 })}</span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{stream}</span>
          {Ic("chevDown", { size: 15, className: "chev" })}
        </div>
      </div>
      <div className="fr-search"><Field placeholder="Search for a field" value={q} onChange={setQ} /></div>
      <div className="fr-list">
        {groups.map(g => {
          const fields = g.fields.filter(f => f[0].toLowerCase().includes(q.toLowerCase()));
          if (!fields.length) return null;
          const isC = collapsed[g.group];
          return (
            <div key={g.group} className="fr-group">
              <button className={"fr-ghead" + (isC ? " collapsed" : "")} onClick={() => setCollapsed(c => ({ ...c, [g.group]: !c[g.group] }))}>
                {g.group} <span className="fg-count">({g.count})</span>
                {Ic("chevDown", { size: 13, className: "chev" })}
              </button>
              {!isC && fields.map(([name, type]) => (
                <button key={name} className="fr-field" onClick={() => onPick && onPick(name)} title={name}>
                  <span className="ff-type">{ftype(type)}</span>
                  <span className="ff-name">{name}</span>
                  <span className="ff-act">
                    <button className="iconbtn" title="Add to filter">{Ic("plus", { size: 13 })}</button>
                    <button className="iconbtn" title="Distinct values">{Ic("metrics", { size: 13 })}</button>
                  </span>
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

/* ---------- shared query bar (collapsible) ---------- */
function QueryBar({ value, onChange, lang = "SQL", placeholder }) {
  const [open, setOpen] = uX(true);
  if (!open) return (
    <div className="qbar-collapsed" onClick={() => setOpen(true)} data-annot="query bar (collapsed)">
      <span className="kbd">{lang}</span>
      <span className="qc-ph">{value || placeholder}</span>
      {Ic("chevDown", { size: 15, style: { color: "var(--text-3)" } })}
    </div>
  );
  return (
    <div className="qbar" data-annot="query editor (mono, collapsible)">
      <div className="qbar-gutter">1</div>
      <div className="qbar-edit"><textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} spellCheck="false" rows={1} /></div>
      <div className="qbar-side">
        <span className="kbd">{lang}</span>
        <button className="iconbtn" title="Collapse" onClick={() => setOpen(false)}>{Ic("chevDown", { size: 16, style: { transform: "rotate(180deg)" } })}</button>
      </div>
    </div>
  );
}

/* ---------- shared time + run cluster ---------- */
const RunCluster = ({ off, extra }) => <>
  {extra}
  <button className="chip" onClick={() => toast("Time range", "info")}>{Ic("clock", { size: 15 })} Past 15 minutes {Ic("chevDown", { size: 13 })}</button>
  {off && <button className="chip" onClick={() => toast("Auto-refresh", "info")}>{Ic("refresh", { size: 15 })} Off {Ic("chevDown", { size: 13 })}</button>}
  <Btn variant="primary" icon="play" onClick={() => toast("Query executed", "info")}>Run query</Btn>
</>;

/* =========================================================== LOGS */
function LogsExplorer() {
  const ui = React.useContext(window.StateCtx);
  const [tab, setTab] = uX("search");
  const [q, setQ] = uX('SELECT * FROM "default" WHERE level = \'ERROR\'');
  const [openRow, setOpenRow] = uX(null);
  const tabs = [
    { id: "search", label: "Search", icon: "search" },
    { id: "timechart", label: "Timechart", icon: "metrics" },
    { id: "visualize", label: "Visualize", icon: "dashboards" },
    { id: "patterns", label: "Patterns", icon: "grid" },
  ];
  return (
    <div className="panel fade-in">
      <span className="annot-badge">Explorer shape · mode tabs in header row2 · query bar · field rail + histogram + expandable results</span>
      <PageHeader icon="logs" title="Logs"
        actions={<RunCluster extra={<Btn sm icon="dots" variant="ghost" />} />}
        row2={<Tabs items={tabs} active={tab} onPick={setTab} />} />
      <QueryBar value={q} onChange={setQ} lang="SQL" placeholder="SELECT * FROM stream WHERE …" />
      <div className="exp-body">
        <FieldRail stream="default" groups={LOG_FIELDS} onPick={f => setQ(v => v + (v ? " AND " : "") + f + " = ''")} />
        <div className="exp-main">
          <div className="res-meta">
            <span>Showing <b>1–50</b> of <b>23,103</b> events in <b>131 ms</b></span>
            <span>· Scan size <b>30.00 MB</b></span>
            <span className="rm-spacer" />
            <select className="input" style={{ width: 64, height: 28 }}><option>50</option><option>100</option></select>
            <div className="pager"><button className="iconbtn">{Ic("chevLeft", { size: 16 })}</button><span className="mono" style={{ fontSize: 12 }}>1 / 5</span><button className="iconbtn">{Ic("chevRight", { size: 16 })}</button></div>
          </div>
          {ui === "loading" ? <SkeletonList rows={16} /> : ui === "empty" ? <Empty icon="logs" title="No results" hint="Adjust the query or widen the time range">Nothing matched in this window.</Empty> : <>
            <div className="exp-hist">
              {HIST.map((h, i) => <div key={i} className="hbar" style={{ height: `${h}%` }} />)}
              <div className="h-axis"><span>15:42</span><span>15:46</span><span>15:50</span><span>15:54</span></div>
            </div>
            <div className="logtbl">
              <div className="logtbl-head"><div>timestamp <span style={{ fontWeight: 400, color: "var(--g-400)" }}>(Asia/Calcutta)</span></div><div>source</div></div>
              {LOG_ROWS.map((r, i) => (
                <React.Fragment key={i}>
                  <div className={"logline" + (openRow === i ? " open" : "")} onClick={() => setOpenRow(openRow === i ? null : i)}>
                    <div className="ll-ts">{Ic("chevRight", { size: 13, className: "ll-chev" })}<span className="ll-time">{r.ts}</span></div>
                    <div className="ll-src"><div className="ll-collapsed">
                      <span className="ll-k">{'{'}"_timestamp":</span><span className="ll-v">{r.fields._timestamp}</span><span className="ll-k">,"level":</span><span className="ll-str">"{r.level}"</span><span className="ll-k">,"body":</span><span className="ll-str">"{r.body.slice(0, 120)}…"</span>
                    </div></div>
                  </div>
                  {openRow === i && (
                    <div className="logline-detail">
                      {Object.entries(r.fields).map(([k, v]) => (
                        <div key={k} className="ld-row">
                          <span className="ld-k"><button className="iconbtn" title="Copy">{Ic("copy", { size: 13 })}</button>{k}</span>
                          <span className="ld-v">{v}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </React.Fragment>
              ))}
            </div>
          </>}
        </div>
      </div>
    </div>
  );
}

/* =========================================================== TRACES */
function TracesExplorer() {
  const ui = React.useContext(window.StateCtx);
  const [tab, setTab] = uX("spans");
  const [q, setQ] = uX("");
  const [hasData, setHasData] = uX(true);
  const empty = ui === "empty" || !hasData;
  const tabs = [
    { id: "spans", label: "Spans", icon: "traces" },
    { id: "traces", label: "Traces", icon: "pipelines" },
    { id: "graph", label: "Service graph", icon: "streams" },
    { id: "catalog", label: "Service catalog", icon: "reports" },
    { id: "sessions", label: "Sessions", icon: "rum" },
    { id: "llm", label: "LLM insights", icon: "spark" },
  ];
  return (
    <div className="panel fade-in">
      <span className="annot-badge">Explorer · 6 mode tabs · RED charts (Rate/Errors/Duration) ride the work area · empty state is first-class</span>
      <PageHeader icon="traces" title="Traces" actions={<RunCluster />} row2={<Tabs items={tabs} active={tab} onPick={setTab} />} />
      <QueryBar value={q} onChange={setQ} lang="TQL" placeholder="service_name='orders-svc' AND duration > 200000" />
      <div className="exp-body">
        <FieldRail stream="default" groups={TRACE_FIELDS} onPick={() => {}} />
        <div className="exp-main">
          <div className="res-meta">
            <span className="badge neutral">{empty ? "0" : "1,204"} spans found</span>
            <button className="chip" onClick={() => toast("Insights", "info")}>{Ic("metrics", { size: 14 })} Insights</button>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span className="dot ok" /> just now</span>
            <span className="rm-spacer" />
            <button className="chip" onClick={() => { setHasData(h => !h); }}>{Ic("refresh", { size: 14 })} {empty ? "Load sample" : "Clear"}</button>
          </div>
          {ui === "loading" ? <SkeletonList rows={14} /> : <>
            <div className="red-row">
              {[["Rate", "req/s", "line"], ["Errors", "%", "bar"], ["Duration", "ms", "area"]].map(([t, u, viz], i) => (
                <div key={t} className="red-card">
                  <div className="rc-title">{t}</div>
                  {empty ? <div style={{ flex: 1, display: "grid", placeItems: "center", color: "var(--text-3)", fontSize: 13 }}>No data</div>
                    : <><div className="rc-val">{i === 0 ? "847" : i === 1 ? "0.4" : "312"}<span style={{ fontSize: 12, color: "var(--text-3)", marginLeft: 3 }}>{u}</span></div><div className="rc-chart"><MiniLine viz={viz} seed={i + 2} hue={i === 1 ? 0 : 234} /></div></>}
                </div>
              ))}
            </div>
            {empty
              ? <Empty icon="traces" title="No traces found" hint="Try a wider time range or relax the filter">Adjust the filters and try again.</Empty>
              : <div className="tbl-wrap">
                  <div className="logtbl-head" style={{ gridTemplateColumns: "150px 200px 1fr 84px" }}><div>Trace ID</div><div>Service</div><div>Operation</div><div style={{ textAlign: "right" }}>Duration</div></div>
                  {TRACE_SPANS.map((s, i) => {
                    const hue = SVC_HUE[s.svc]; const w = Math.max(6, (s.dur / 560) * 100);
                    return (
                      <div key={i} className="span-row" onClick={() => toast("Open trace " + s.id.slice(0, 8), "info")}>
                        <span className="mono" style={{ fontSize: 11.5, color: "var(--text-2)" }}>{s.id.slice(0, 14)}</span>
                        <span><span className="badge" style={{ background: `hsl(${hue} 70% 95%)`, color: `hsl(${hue} 55% 35%)` }}><span className="dot" style={{ background: `hsl(${hue} 60% 50%)` }} />{s.svc}</span></span>
                        <span style={{ minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ fontWeight: 500, fontSize: 12.5 }}>{s.op}</span>{s.err && <Badge kind="danger" dot>error</Badge>}</div>
                          <div className="span-bar-track" style={{ marginTop: 4 }}><div className="span-bar" style={{ left: 0, width: `${w}%`, background: s.err ? "var(--danger)" : `hsl(${hue} 60% 55%)` }} /></div>
                        </span>
                        <span className="mono" style={{ fontSize: 12, color: "var(--text-2)", textAlign: "right" }}>{s.dur} ms</span>
                      </div>
                    );
                  })}
                </div>}
          </>}
        </div>
      </div>
    </div>
  );
}

/* =========================================================== METRICS */
function MetricsExplorer() {
  const ui = React.useContext(window.StateCtx);
  const [viz, setViz] = uX("line");
  const [qtab, setQtab] = uX("builder");
  const [q, setQ] = uX("");
  const VIZ = ["line", "area", "bar", "hbar", "scatter", "heatmap", "pie", "donut", "gauge", "table", "stat", "geomap"];
  const vizIcon = { line: "metrics", area: "metrics", bar: "reports", hbar: "reports", scatter: "grid", heatmap: "grid", pie: "rum", donut: "rum", gauge: "rum", table: "logs", stat: "spark", geomap: "globe" };
  return (
    <div className="panel fade-in">
      <span className="annot-badge">Explorer (builder shape) · viz picker · fields rail · PromQL/SQL builder · query editor docked bottom</span>
      <PageHeader icon="metrics" title="Metrics"
        actions={<RunCluster off extra={<><Btn sm icon="help" variant="ghost">Syntax guide</Btn><Btn sm icon="logs" variant="ghost">Legend</Btn><Btn icon="plus">Add to dashboard</Btn></>} />} />
      <div className="exp-body">
        <div className="vizpicker" data-annot="viz type picker">
          {VIZ.map(v => <button key={v} className={"vizpick" + (viz === v ? " active" : "")} title={v} onClick={() => setViz(v)}>{Ic(vizIcon[v], { size: 17 })}</button>)}
        </div>
        <FieldRail stream="cpu_count" groups={METRIC_FIELDS} onPick={() => {}} />
        <div className="exp-main">
          <div className="mbuilder">
            {qtab === "builder" ? <>
              <div className="mb-row"><span className="mb-label">Label filters</span><div><button className="mb-add">{Ic("plus", { size: 13 })} Add filter</button></div></div>
              <div className="mb-row"><span className="mb-label">Operations</span><div><button className="mb-add">{Ic("plus", { size: 13 })} Add operation</button></div></div>
              <div className="mb-row"><span className="mb-label">Options</span>
                <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, color: "var(--text-3)" }}>Legend <input className="input" style={{ width: 150, height: 30 }} placeholder="{{label}}" /></label>
                  <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, color: "var(--text-3)" }}>Step <input className="input" style={{ width: 100, height: 30 }} placeholder="30s, 1m" /></label>
                  <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, color: "var(--text-3)" }}>Type <select className="input" style={{ width: 110, height: 30 }}><option>Range</option><option>Instant</option></select></label>
                </div>
              </div>
              <div style={{ flex: 1, minHeight: 0, display: "grid", placeItems: "center", color: "var(--text-3)", fontSize: 13 }}>
                {ui === "loading" ? <Skeleton w="90%" h={200} r={10} /> : ui === "empty" ? <Empty icon="metrics" title="No data" hint="Pick a metric and run the query">Build a query, then run it to chart results.</Empty> : <div style={{ width: "92%", height: "70%", alignSelf: "center" }}><MiniLine viz={viz === "line" ? "line" : viz === "bar" ? "bar" : "area"} seed={3} hue={234} big /></div>}
              </div>
            </> : <div style={{ flex: 1, display: "grid", placeItems: "center", color: "var(--text-3)" }}>{qtab} mode</div>}
            <div className="mq-editor">
              <div className="mq-tabs">
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--primary)", padding: "0 8px" }}>Query 1</span>
                <span className="rm-spacer" style={{ flex: 1 }} />
                {["SQL", "PromQL", "Builder", "Custom"].map(t => {
                  const id = t.toLowerCase();
                  return <button key={t} className={"mq-tab" + (qtab === id ? " active" : "")} onClick={() => setQtab(id)}>{t}</button>;
                })}
              </div>
              <div className="qbar" style={{ borderBottom: "none" }}>
                <div className="qbar-gutter">1</div>
                <div className="qbar-edit"><textarea value={q} onChange={e => setQ(e.target.value)} placeholder='rate(cpu_count[5m])' spellCheck="false" rows={1} /></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* =========================================================== RUM */
function RumExplorer() {
  const ui = React.useContext(window.StateCtx);
  const [tab, setTab] = uX("performance");
  const tabs = [
    { id: "performance", label: "Performance", icon: "metrics" },
    { id: "sessions", label: "Sessions", icon: "rum" },
    { id: "errors", label: "Errors", icon: "incidents" },
  ];
  return (
    <div className="panel fade-in">
      <span className="annot-badge">Explorer (dashboard shape) · mode tabs · web-vitals score cards · sessions/errors tables</span>
      <PageHeader icon="rum" title="Real user monitoring"
        actions={<RunCluster extra={<select className="input" style={{ width: 150, height: 34 }}><option>web-app</option><option>mobile-app</option></select>} />}
        row2={<Tabs items={tabs} active={tab} onPick={setTab} />} />
      {ui === "loading" ? <SkeletonCards n={5} /> : ui === "empty" ? <Empty icon="rum" title="No RUM data" hint="Install the RUM SDK to start collecting sessions">Instrument your frontend to see web vitals and sessions.</Empty> :
        tab === "performance" ? <div className="tbl-wrap">
          <div className="vitals-row">
            {WEB_VITALS.map(v => (
              <div key={v.name} className="vital">
                <div className="v-top"><span className="v-name">{v.name}</span><Badge kind={v.rating === "good" ? "ok" : v.rating === "ni" ? "warn" : "danger"} dot>{v.rating === "ni" ? "needs work" : v.rating}</Badge></div>
                <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 6 }}>{v.full}</div>
                <div className={"v-val rating-" + v.rating}>{v.val}<span className="v-unit">{v.unit}</span></div>
                <div className="v-bar"><i className={"bg-" + v.rating} style={{ width: v.pct + "%" }} /></div>
                <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 6 }}>Good {v.good} · p75</div>
              </div>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, padding: "0 14px 14px" }}>
            {["Page load over time", "Sessions by country"].map((t, i) => (
              <div key={t} className="dpanel" style={{ height: 200 }}>
                <div className="dpanel-head"><span className="dpanel-title">{t}</span></div>
                <div className="dpanel-body"><div style={{ position: "absolute", inset: 12 }}><MiniLine viz={i === 0 ? "area" : "bar"} seed={i + 4} hue={234} big /></div></div>
              </div>
            ))}
          </div>
        </div> :
        tab === "sessions" ? <div className="tbl-wrap">
          <table className="tbl"><thead><tr><th>Session</th><th>User</th><th>Browser</th><th>OS</th><th>Country</th><th>Duration</th><th>Views</th><th>Errors</th><th>When</th></tr></thead>
            <tbody>{RUM_SESSIONS.map(s => (
              <tr key={s.id} style={{ cursor: "pointer" }} onClick={() => toast("Open session", "info")}>
                <td className="mono c-muted">{s.id}</td><td>{s.user}</td><td>{s.browser}</td><td className="c-muted">{s.os}</td>
                <td><span className="badge neutral">{s.country}</span></td><td className="mono">{s.duration}</td><td className="mono">{s.views}</td>
                <td>{s.errors ? <Badge kind="danger" dot>{s.errors}</Badge> : <span className="c-muted">0</span>}</td><td className="c-muted">{s.when}</td>
              </tr>
            ))}</tbody></table>
        </div> :
        <div className="tbl-wrap">
          <table className="tbl"><thead><tr><th>Error</th><th>Source</th><th style={{ textAlign: "right" }}>Count</th><th style={{ textAlign: "right" }}>Users</th><th>Last seen</th></tr></thead>
            <tbody>{RUM_ERRORS.map(e => (
              <tr key={e.id} style={{ cursor: "pointer" }} onClick={() => toast("Open error", "info")}>
                <td className="c-name" style={{ color: "var(--danger)" }}>{e.msg}</td>
                <td className="mono c-muted">{e.source}</td>
                <td className="mono" style={{ textAlign: "right" }}>{e.count}</td>
                <td className="mono" style={{ textAlign: "right" }}>{e.users}</td>
                <td className="c-muted">{e.last}</td>
              </tr>
            ))}</tbody></table>
        </div>}
    </div>
  );
}

/* tiny line/area/bar chart */
function MiniLine({ viz = "line", seed = 1, hue = 234, big }) {
  const n = 32;
  const pts = Array.from({ length: n }, (_, i) => 40 - Math.abs(Math.sin((i + seed) / 4) + 0.5 * Math.cos(i / 2.5)) * (big ? 34 : 30) - (i % 5));
  const path = pts.map((y, i) => `${i === 0 ? "M" : "L"} ${(i / (n - 1)) * 100} ${y.toFixed(1)}`).join(" ");
  const area = `M 0 44 ${pts.map((y, i) => `L ${(i / (n - 1)) * 100} ${y.toFixed(1)}`).join(" ")} L 100 44 Z`;
  const col = `hsl(${hue} ${hue === 0 ? 70 : 60}% 55%)`;
  return (
    <svg viewBox="0 0 100 44" preserveAspectRatio="none" style={{ width: "100%", height: "100%" }}>
      {viz === "bar"
        ? pts.map((y, i) => <rect key={i} x={(i / n) * 100} y={y} width={100 / n - 1.2} height={44 - y} rx="0.6" fill={col} opacity=".85" />)
        : <>{viz === "area" && <path d={area} fill={col} opacity=".16" />}<path d={path} fill="none" stroke={col} strokeWidth="1.4" vectorEffect="non-scaling-stroke" /></>}
    </svg>
  );
}

Object.assign(window, { LogsExplorer, TracesExplorer, MetricsExplorer, RumExplorer });
