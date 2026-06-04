// pages_c.jsx — Pipelines (A1 tabs + full-bleed graph editor drill)
const { useState: uSc } = React;

const PIPES = [
  { id: 1, name: "prod-logs-enrich", source: "prod.logs", nodes: 5, on: true, type: "Realtime", updated: "2h ago" },
  { id: 2, name: "trace-sampler", source: "api.traces", nodes: 3, on: true, type: "Realtime", updated: "1d ago" },
  { id: 3, name: "pii-redaction", source: "auth.logs", nodes: 4, on: true, type: "Realtime", updated: "3d ago" },
  { id: 4, name: "metrics-rollup", source: "infra.metrics", nodes: 6, on: false, type: "Scheduled", updated: "5d ago" },
  { id: 5, name: "geoip-tagging", source: "edge.logs", nodes: 4, on: true, type: "Realtime", updated: "1w ago" },
];
const FUNCS = [
  { id: 1, name: "parse_json", lang: "VRL", used: 12 },
  { id: 2, name: "redact_email", lang: "VRL", used: 5 },
  { id: 3, name: "to_lowercase", lang: "VRL", used: 8 },
  { id: 4, name: "geoip_lookup", lang: "VRL", used: 3 },
];

function PipelinesPage() {
  const [tab, setTab] = uSc("pipelines");
  const [editing, setEditing] = uSc(null);   // pipeline → full-bleed graph editor
  const [confirm, setConfirm] = uSc(null);
  const [menu, setMenu] = uSc(null);
  const [q, setQ] = uSc("");
  const [fnModal, setFnModal] = uSc(null);   // function create/edit modal

  const tabs = [
    { id: "pipelines", label: "Pipelines", icon: "pipelines", count: PIPES.length },
    { id: "functions", label: "Functions", icon: "code", count: FUNCS.length },
    { id: "enrichment", label: "Enrichment tables", icon: "database", count: 2 },
    { id: "templates", label: "Eval templates", icon: "reports", count: 3 },
  ];
  const curTab = tabs.find(t => t.id === tab);
  // tab-scoped action labels — singular of the tab
  const noun = { pipelines: "pipeline", functions: "function", enrichment: "table", templates: "template" }[tab];

  /* ---- L3: full-bleed graph editor (breadcrumb REPLACES tabs; actions teleport to header) ---- */
  if (editing) {
    return (
      <div className="panel fade-in">
        <span className="annot-badge">Full-bleed canvas drill — A6 can't hold a node graph, so it goes full-page · breadcrumb replaces tabs · Save/Cancel teleported into header</span>
        <PageHeader icon="pipelines" title={editing.name} subtitle="Realtime pipeline · 5 nodes"
          actions={<><Btn icon="play" onClick={() => toast("Test run started", "info")}>Test run</Btn><Btn onClick={() => setEditing(null)}>Cancel</Btn><Btn variant="primary" icon="check" onClick={() => { setEditing(null); toast("Pipeline saved"); }}>Save pipeline</Btn></>}
          row2={<Breadcrumb items={[
            { label: "Pipeline", onClick: () => setEditing(null) },
            { label: "Pipelines", onClick: () => setEditing(null) },
            { label: editing.name },
          ]} />} />
        <GraphEditor />
      </div>
    );
  }

  /* ---- L2: tabs ---- */
  return (
    <div className="panel fade-in">
      <span className="annot-badge">Primary CTA stays top-right in the header (Datadog/Grafana convention) · tabs are sub-nav · slim filter bar below</span>
      <PageHeader icon="pipelines" title="Pipeline" subtitle="Transform, enrich and route data in flight"
        actions={<><Btn icon="import" onClick={() => toast(`Import ${noun}`, "info")}>Import {noun}</Btn><Btn variant="primary" icon="plus" onClick={() => tab === "pipelines" ? setEditing({ name: "Untitled pipeline", nodes: 0 }) : tab === "functions" ? setFnModal({ name: "", lang: "VRL" }) : toast(`New ${noun}`)}>New {noun}</Btn></>}
        row2={<Tabs items={tabs} active={tab} onPick={(id) => { setTab(id); setQ(""); }} />} />

      {/* slim filter bar — search only; the CREATE action stays top-right where users expect it */}
      <SectionToolbar search={q} setSearch={setQ} placeholder={`Search ${curTab.label.toLowerCase()}`}
        annot="filter bar (search/scope only — no primary action here)" />

      {tab === "pipelines" ? (
        <div className="tbl-wrap">
          <table className="tbl"><thead><tr>
            <th style={{ width: 40 }}><Cbx /></th><th>Status</th><th>Name</th><th>Source</th><th>Type</th><th>Nodes</th><th>Updated</th><th style={{ textAlign: "right" }}>Actions</th>
          </tr></thead><tbody>
            {PIPES.map(p => (
              <tr key={p.id} style={{ cursor: "pointer" }} onClick={() => setEditing(p)}>
                <td onClick={e => e.stopPropagation()}><Cbx /></td>
                <td onClick={e => e.stopPropagation()}><Toggle on={p.on} onClick={() => {}} /></td>
                <td className="c-name">{p.name}</td>
                <td className="mono c-muted">{p.source}</td>
                <td>{p.type}</td>
                <td className="mono">{p.nodes}</td>
                <td className="c-muted">{p.updated}</td>
                <td onClick={e => e.stopPropagation()}><div className="row-act" style={{ position: "relative" }}>
                  <button className="iconbtn" title="Edit" onClick={() => setEditing(p)}>{Ic("edit", { size: 16 })}</button>
                  <button className="iconbtn" title="More" onClick={() => setMenu(menu === p.id ? null : p.id)}>{Ic("dots", { size: 16 })}</button>
                  {menu === p.id && <Popover onClose={() => setMenu(null)} style={{ right: 0, top: 30 }} items={[
                    { label: "Duplicate", icon: "copy", onClick: () => toast("Pipeline duplicated") },
                    { label: "View history", icon: "clock", onClick: () => toast("Version history", "info") },
                    { label: "Backfill", icon: "refresh", onClick: () => toast("Backfill started", "info") },
                    { sep: true },
                    { label: "Delete", icon: "trash", danger: true, onClick: () => setConfirm(p) },
                  ]} />}
                </div></td>
              </tr>
            ))}
          </tbody></table>
        </div>
      ) : tab === "functions" ? (
        <div className="tbl-wrap">
          <table className="tbl"><thead><tr><th>Name</th><th>Language</th><th>Used by</th><th style={{ textAlign: "right" }}>Actions</th></tr></thead><tbody>
            {FUNCS.map(f => (
              <tr key={f.id}>
                <td className="c-name mono">{f.name}</td>
                <td><Badge kind="info">{f.lang}</Badge></td>
                <td className="c-muted">{f.used} pipelines</td>
                <td><div className="row-act"><button className="iconbtn" onClick={() => setFnModal(f)}>{Ic("edit", { size: 16 })}</button><button className="iconbtn danger" onClick={() => setConfirm(f)}>{Ic("trash", { size: 16 })}</button></div></td>
              </tr>
            ))}
          </tbody></table>
        </div>
      ) : (
        <Empty icon={tabs.find(t => t.id === tab).icon} title={tabs.find(t => t.id === tab).label}>Same single header, same tab strip — only the table swaps. Items here open the matching editor; the heavy graph editor is the only one that needs the full-page canvas.</Empty>
      )}

      {confirm && <ConfirmDialog title={`Delete “${confirm.name}”?`}
        message="This permanently removes it and stops its data transforms. This action cannot be undone."
        confirmLabel="Delete" onConfirm={() => { setConfirm(null); toast(`“${confirm.name}” deleted`, "danger"); }} onClose={() => setConfirm(null)} />}

      {fnModal && <Modal title={fnModal.name ? `Edit ${fnModal.name}` : "New function"} sub="VRL transform applied to matching records." icon="code" tone="brand" wide onClose={() => setFnModal(null)}
        footer={<><Btn onClick={() => setFnModal(null)}>Cancel</Btn><Btn variant="primary" icon="check" onClick={() => { setFnModal(null); toast("Function saved"); }}>Save function</Btn></>}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}><label style={{ fontWeight: 600, fontSize: 13 }}>Name</label><input className="input mono" defaultValue={fnModal.name} placeholder="parse_json" style={{ marginTop: 5 }} /></div>
            <div style={{ width: 130 }}><label style={{ fontWeight: 600, fontSize: 13 }}>Language</label><select className="input" style={{ marginTop: 5 }}><option>VRL</option><option>Lua</option></select></div>
          </div>
          <div><label style={{ fontWeight: 600, fontSize: 13 }}>Definition</label>
            <textarea className="input mono" style={{ height: 150, padding: 11, resize: "vertical", lineHeight: 1.5, marginTop: 5 }} defaultValue={fnModal.name ? '.parsed = parse_json!(.message)\n.level = downcase(.level)' : ''} placeholder=". = parse_json!(.message)" /></div>
        </div>
      </Modal>}
    </div>
  );
}

/* full-bleed node-graph editor — a faithful sketch of the canvas */
function GraphEditor() {
  const nodes = [
    { id: "src", cls: "src", icon: "logs", title: "Source", body: "prod.logs", x: 90, y: 360 },
    { id: "fn1", cls: "fn", icon: "code", title: "Function", body: "parse_json", x: 350, y: 270 },
    { id: "fn2", cls: "fn", icon: "code", title: "Function", body: "redact_email", x: 350, y: 450 },
    { id: "dst", cls: "dst", icon: "database", title: "Destination", body: "prod.clean", x: 620, y: 360 },
  ];
  const edges = [["src", "fn1"], ["src", "fn2"], ["fn1", "dst"], ["fn2", "dst"]];
  const cx = n => n.x + (n.id === "src" || n.id === "dst" ? 156 : 156);
  const center = id => { const n = nodes.find(x => x.id === id); return { x: n.x + 78, y: n.y + 32 }; };
  return (
    <div className="graph" data-annot="full-bleed graph canvas (full-page, not master-detail)">
      <div className="gpalette">
        <div style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: 0, color: "var(--text-3)", padding: "0 2px 2px" }}>Drag to add</div>
        <div className="gp-item">{Ic("logs", { size: 15 })} Source</div>
        <div className="gp-item">{Ic("code", { size: 15 })} Function</div>
        <div className="gp-item">{Ic("filter", { size: 15 })} Condition</div>
        <div className="gp-item">{Ic("database", { size: 15 })} Destination</div>
      </div>
      <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
        {edges.map(([a, b], i) => {
          const p1 = center(a), p2 = center(b);
          const mx = (p1.x + p2.x) / 2;
          return <path key={i} d={`M ${p1.x + 78} ${p1.y} C ${mx} ${p1.y}, ${mx} ${p2.y}, ${p2.x - 78} ${p2.y}`} stroke="var(--g-400)" strokeWidth="2" fill="none" />;
        })}
      </svg>
      {nodes.map(n => (
        <div key={n.id} className={"gnode " + n.cls} style={{ left: n.x, top: n.y }}>
          <div className="gnode-head">{Ic(n.icon, { size: 15 })}{n.title}</div>
          <div className="gnode-body mono">{n.body}</div>
          {n.id !== "src" && <span className="gport" style={{ left: -5 }} />}
          {n.id !== "dst" && <span className="gport" style={{ right: -5 }} />}
        </div>
      ))}
      <div className="gminimap">
        <div style={{ position: "absolute", inset: 8, border: "1px dashed var(--g-400)", borderRadius: 4 }} />
        {nodes.map(n => <div key={n.id} style={{ position: "absolute", left: 10 + n.x / 9, top: 10 + n.y / 4, width: 18, height: 8, borderRadius: 2, background: "var(--g-400)" }} />)}
      </div>
    </div>
  );
}

window.PipelinesPage = PipelinesPage;
