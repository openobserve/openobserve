// pages_dash.jsx — Dashboard drill: View Dashboard (panel grid) + Add Panel (editor)
const { useState: uD } = React;

// mini chart svg by viz type
function MiniChart({ viz, seed = 1 }) {
  const pts = Array.from({ length: 16 }, (_, i) => 40 - Math.abs(Math.sin((i + seed) / 2.5)) * 30 - (i % 4) * 2);
  const path = pts.map((y, i) => `${i === 0 ? "M" : "L"} ${(i / 15) * 100} ${y}`).join(" ");
  const area = `M 0 40 ${pts.map((y, i) => `L ${(i / 15) * 100} ${y}`).join(" ")} L 100 40 Z`;
  if (viz === "stat") return null;
  if (viz === "bar") return (
    <svg viewBox="0 0 100 44" preserveAspectRatio="none" style={{ width: "100%", height: "100%" }}>
      {pts.map((y, i) => <rect key={i} x={i * 6.2} y={y} width="4.6" height={44 - y} rx="1" fill="var(--iris-900)" opacity={.85} />)}
    </svg>
  );
  if (viz === "table") return (
    <div style={{ fontSize: 11 }} className="mono">
      {["GET /checkout", "POST /orders", "GET /me", "POST /pay"].map((r, i) => (
        <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: "1px solid var(--border-soft)", color: "var(--text-2)" }}><span>{r}</span><span>{(900 - i * 180)}</span></div>
      ))}
    </div>
  );
  return (
    <svg viewBox="0 0 100 44" preserveAspectRatio="none" style={{ width: "100%", height: "100%" }}>
      {viz === "area" && <path d={area} fill="var(--iris-500)" opacity={.5} />}
      <path d={path} fill="none" stroke="var(--iris-1000)" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// ---------- VIEW DASHBOARD ----------
function DashboardView({ dash, folder, onBack, onBackFolder, onAddPanel }) {
  return (
    <div className="panel fade-in">
      <span className="annot-badge">L3 drill · breadcrumb shows full path (clickable) · time picker + Add panel in header · canvas of panels below</span>
      <PageHeader icon="dashboards" title={dash.name} subtitle="Auto-refresh: 30s · 6 panels"
        actions={<>
          <button className="chip">{Ic("clock", { size: 15 })} Last 6 hours {Ic("chevDown", { size: 13 })}</button>
          <Btn icon="refresh" sm />
          <Btn icon="settings" sm>Settings</Btn>
          <Btn variant="primary" icon="plus" onClick={onAddPanel}>Add panel</Btn>
        </>}
        row2={<Breadcrumb items={[
          { label: "Dashboards", onClick: onBack },
          { label: folder.name, onClick: onBackFolder },
          { label: dash.name },
        ]} />} />
      <div className="dash-canvas">
        {DASH_PANELS.map((p, i) => (
          <div key={p.id} className="dpanel" style={{ gridColumn: `span ${p.w}`, gridRow: `span ${p.h}` }}>
            <div className="dpanel-head">
              <span className="dpanel-title">{p.title}</span>
              <span className="dp-act">
                <button className="iconbtn" title="Edit" onClick={onAddPanel}>{Ic("edit", { size: 15 })}</button>
                <button className="iconbtn" title="Duplicate">{Ic("copy", { size: 15 })}</button>
                <button className="iconbtn" title="More">{Ic("dots", { size: 15 })}</button>
              </span>
            </div>
            <div className="dpanel-body">
              {p.viz === "stat"
                ? <div style={{ height: "100%", display: "flex", flexDirection: "column", justifyContent: "center" }}>
                    <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: "-1px", color: p.title.includes("Error") ? "var(--danger)" : "var(--g-900)" }}>{p.title.includes("Error") ? "0.42" : "312"}<span style={{ fontSize: 15, color: "var(--text-3)", marginLeft: 4 }}>{p.unit}</span></div>
                    <div style={{ fontSize: 12, color: "var(--ok)", marginTop: 4 }}>▼ 8% vs prev</div>
                  </div>
                : <div style={{ position: "absolute", inset: 10 }}><MiniChart viz={p.viz} seed={i + 1} /></div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- ADD / EDIT PANEL ----------
function PanelEditor({ dash, folder, onBack, onBackFolder, onBackDash }) {
  const [viz, setViz] = uD("line");
  const [q, setQ] = uD("SELECT histogram(_timestamp) as x, count(*) as y FROM \"prod.logs\" GROUP BY x");
  return (
    <div className="panel fade-in">
      <span className="annot-badge">L4 drill (deepest) · breadcrumb walks all the way back · Save/Cancel teleported to header · 3-pane editor</span>
      <PageHeader icon="dashboards" title="Add panel" subtitle={`to ${dash.name}`}
        actions={<><Btn onClick={onBackDash}>Cancel</Btn><Btn variant="primary" icon="check">Save panel</Btn></>}
        row2={<Breadcrumb items={[
          { label: "Dashboards", onClick: onBack },
          { label: folder.name, onClick: onBackFolder },
          { label: dash.name, onClick: onBackDash },
          { label: "Add panel" },
        ]} />} />
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* left: viz picker + fields */}
        <aside style={{ width: 230, borderRight: "1px solid var(--border-soft)", background: "var(--g-50)", overflowY: "auto", flex: "none" }} data-annot="viz + fields rail">
          <SectionLabel>Visualization</SectionLabel>
          <div className="vizgrid">
            {VIZ_TYPES.map(v => (
              <button key={v.id} className={"vizcard" + (viz === v.id ? " active" : "")} onClick={() => setViz(v.id)}>{Ic(v.icon, { size: 20 })}{v.label}</button>
            ))}
          </div>
          <SectionLabel>Fields</SectionLabel>
          <div style={{ padding: "4px 10px 14px" }}>
            {["_timestamp", "level", "service", "status_code", "duration_ms", "trace_id", "message"].map(f => (
              <div key={f} className="l2-link" style={{ cursor: "grab" }}>{Ic("tag", { size: 14 })}<span className="mono" style={{ fontSize: 12 }}>{f}</span></div>
            ))}
          </div>
        </aside>
        {/* center: preview + query */}
        <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
          <div style={{ flex: 1, minHeight: 0, padding: 16, background: "var(--g-100)" }}>
            <div className="dpanel" style={{ height: "100%" }}>
              <div className="dpanel-head"><input className="dpanel-title" defaultValue="New panel" style={{ border: "none", background: "none", outline: "none", fontFamily: "inherit" }} /><span className="badge neutral" style={{ marginLeft: "auto" }}>{viz}</span></div>
              <div className="dpanel-body">
                {viz === "stat"
                  ? <div style={{ height: "100%", display: "grid", placeItems: "center" }}><div style={{ fontSize: 52, fontWeight: 700, letterSpacing: "-2px" }}>1,204</div></div>
                  : <div style={{ position: "absolute", inset: 16 }}><MiniChart viz={viz} seed={3} /></div>}
              </div>
            </div>
          </div>
          <div style={{ borderTop: "1px solid var(--border-soft)", padding: 12, background: "var(--panel)", flex: "none" }} data-annot="query editor">
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <div className="seg"><button className="active">SQL</button><button>PromQL</button></div>
              <select className="input sm" style={{ width: 150, height: 30 }}><option>prod.logs</option><option>api.traces</option></select>
              <span className="sb-spacer" style={{ flex: 1 }} />
              <Btn sm variant="primary" icon="play">Run query</Btn>
            </div>
            <textarea className="input mono" style={{ height: 64, padding: 10, resize: "none", lineHeight: 1.5 }} value={q} onChange={e => setQ(e.target.value)} />
          </div>
        </div>
        {/* right: panel config */}
        <aside style={{ width: 240, borderLeft: "1px solid var(--border-soft)", overflowY: "auto", flex: "none" }} data-annot="panel config rail">
          <SectionLabel>Panel options</SectionLabel>
          <KV k="Title"><input className="input" defaultValue="New panel" /></KV>
          <KV k="Unit"><select className="input"><option>none</option><option>req/s</option><option>ms</option><option>%</option><option>bytes</option></select></KV>
          <KV k="Legend"><Toggle on={true} onClick={() => {}} /></KV>
          <KV k="Y-min"><input className="input" placeholder="auto" /></KV>
          <KV k="Y-max"><input className="input" placeholder="auto" /></KV>
          <SectionLabel>Thresholds</SectionLabel>
          <div style={{ padding: "6px 18px 18px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}><span className="dot warn" /><input className="input sm" defaultValue="80" style={{ width: 70, height: 30 }} /><span style={{ fontSize: 12, color: "var(--text-3)" }}>warning</span></div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}><span className="dot danger" /><input className="input sm" defaultValue="95" style={{ width: 70, height: 30 }} /><span style={{ fontSize: 12, color: "var(--text-3)" }}>critical</span></div>
          </div>
        </aside>
      </div>
    </div>
  );
}

Object.assign(window, { DashboardView, PanelEditor });
