// pages_a.jsx — Home, Dashboards, Logs, Traces
const { useState: uS } = React;

/* =========================================================== HOME */
function HomePage() {
  const stats = [
    { label: "Streams", value: "47", icon: "streams", k: "info" },
    { label: "Dashboards", value: "1,036", icon: "dashboards", k: "ok" },
    { label: "Active alerts", value: "6", icon: "alerts", k: "warn" },
    { label: "Ingest / min", value: "1.2M", icon: "logs", k: "info" },
  ];
  return (
    <div className="panel fade-in">
      <span className="annot-badge">Flat module · row2 = tagline (no L2 nav)</span>
      <PageHeader icon="home" title="Welcome back, Platform Team"
        subtitle="default · Enterprise"
        actions={<><Btn icon="import" variant="">Import</Btn><Btn icon="plus" variant="primary">New stream</Btn></>}
        row2={<span className="ph-tagline">Your observability workspace at a glance</span>} />
      <div style={{ padding: 16, overflow: "auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 14 }}>
          {stats.map(s => (
            <div key={s.label} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 16, background: "var(--g-0)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-3)", letterSpacing: 0 }}>{s.label}</span>
                <span className="ph-tile" style={{ width: 30, height: 30, borderRadius: 8 }}>{Ic(s.icon, { size: 16 })}</span>
              </div>
              <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-1px", marginTop: 8, color: "var(--g-900)" }}>{s.value}</div>
            </div>
          ))}
        </div>
        <div style={{ border: "1px dashed var(--border)", borderRadius: 12, padding: 24, color: "var(--text-3)", fontSize: 13, textAlign: "center", background: "var(--g-50)" }}>
          This prototype focuses on the <b style={{ color: "var(--text-2)" }}>navigation system</b>. Use the left rail to visit Dashboards, Logs, Traces, IAM, Ingestion, Alerts and Settings —
          and toggle <b style={{ color: "var(--text-2)" }}>Annotations</b> in Tweaks to see each chrome rule labelled.
        </div>
      </div>
    </div>
  );
}

/* =========================================================== DASHBOARDS (flat + folder rail, A6) */
function DashboardsPage() {
  const ui = React.useContext(window.StateCtx);
  const [folder, setF] = uS("default");
  const [q, setQ] = uS("");
  const [fq, setFq] = uS("");
  const [scope, setScope] = uS("folder");
  const [sel, setSel] = uS({});
  const [del, setDel] = uS(null);
  const [view, setView] = uS(null);     // null=list | {dash} | {dash, panel:true}
  const folders = FOLDERS.filter(f => f.name.toLowerCase().includes(fq.toLowerCase()));
  const rows = DASHBOARDS.filter(d => d.name.toLowerCase().includes(q.toLowerCase()));
  const folderObj = FOLDERS.find(f => f.id === folder) || FOLDERS[0];

  // ---- drill: View Dashboard / Add Panel ----
  if (view && view.panel) return <PanelEditor dash={view.dash} folder={folderObj}
    onBack={() => setView(null)} onBackFolder={() => setView(null)} onBackDash={() => setView({ dash: view.dash })} />;
  if (view) return <DashboardView dash={view.dash} folder={folderObj}
    onBack={() => setView(null)} onBackFolder={() => setView(null)} onAddPanel={() => setView({ dash: view.dash, panel: true })} />;

  return (
    <div className="panel fade-in">
      <span className="annot-badge">Flat list module · folder rail is in-content (not L2 chrome) · row click drills to View Dashboard → Add Panel</span>
      <PageHeader icon="dashboards" title="Dashboards"
        subtitle="Create, organize, and share dashboards across folders"
        actions={<><Btn icon="import" onClick={() => setDel({ import: true })}>Import</Btn><Btn icon="plus" variant="primary" onClick={() => setView({ dash: { idx: 0, name: "Untitled dashboard", id: "new", created: "now" } })}>New dashboard</Btn></>} />
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* folder rail — belongs to the PAGE, not the chrome */}
        <aside className="l2" style={{ width: 230 }} data-annot="in-content folder rail (A6 master)">
          <div className="l2-head" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span className="l2-title">Folders</span>
            <button className="iconbtn" onClick={() => setDel({ create: true })}>{Ic("plus", { size: 16 })}</button>
          </div>
          <div className="l2-search"><Field placeholder="Search folder" value={fq} onChange={setFq} /></div>
          <div className="l2-list">
            {folders.map(f => (
              <button key={f.id} className={"l2-link" + (folder === f.id ? " active" : "")} onClick={() => setF(f.id)}>
                {f.id === "default" && Ic("home", { size: 15, style: { color: "var(--text-3)", flex: "none" } })}
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
              </button>
            ))}
          </div>
        </aside>
        {/* detail */}
        <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
          <div className="toolbar">
            <Field className="grow" placeholder="Search Dashboard" value={q} onChange={setQ} />
            <div className="seg">
              <button className={scope === "folder" ? "active" : ""} onClick={() => setScope("folder")}>{Ic("folder", { size: 14 })} This folder</button>
              <button className={scope === "all" ? "active" : ""} onClick={() => setScope("all")}>{Ic("search", { size: 14 })} All folders</button>
            </div>
            <button className="iconbtn" title="Refresh">{Ic("refresh", { size: 17 })}</button>
          </div>
          {ui === "loading" ? <SkeletonTable cols={8} /> : ui === "empty" ? <Empty icon="dashboards" title="No dashboards yet" action={{ label: "New dashboard", onClick: () => setView({ dash: { idx: 0, name: "Untitled dashboard", id: "new", created: "now" } }) }} hint="Tip: import an existing dashboard JSON to start fast">Create your first dashboard to visualize this folder.</Empty> : <>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr>
                <th style={{ width: 40 }}><Cbx /></th>
                <th className="c-idx">#</th>
                <th>Name {Ic("chevDown", { size: 13, style: { verticalAlign: -2, opacity: .5 } })}</th>
                <th>Identifier</th><th>Description</th><th>Owner</th><th>Created</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr></thead>
              <tbody>
                {rows.map(d => (
                  <tr key={d.idx} className={sel[d.idx] ? "sel" : ""} style={{ cursor: "pointer" }} onClick={() => setView({ dash: d })}>
                    <td onClick={e => e.stopPropagation()}><Cbx on={!!sel[d.idx]} onClick={() => setSel(s => ({ ...s, [d.idx]: !s[d.idx] }))} /></td>
                    <td className="c-idx">{String(d.idx).padStart(2, "0")}</td>
                    <td className="c-name">{d.name}</td>
                    <td className="c-id mono">{d.id}</td>
                    <td className="c-muted">{d.desc}</td>
                    <td><span className="avatar-xs">PT</span>{d.owner}</td>
                    <td className="c-muted">{d.created}</td>
                    <td onClick={e => e.stopPropagation()}>
                      <div className="row-act">
                        <button className="iconbtn" title="Move">{Ic("move", { size: 16 })}</button>
                        <button className="iconbtn" title="Duplicate">{Ic("copy", { size: 16 })}</button>
                        <button className="iconbtn danger" title="Delete" onClick={() => setDel(d)}>{Ic("trash", { size: 16 })}</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="tbl-foot">
            <span className="ft-spacer" />
            <span>Showing 1–20 of 1,036</span>
            <span>Records per page</span>
            <select className="input" style={{ width: 64, height: 30 }}><option>20</option><option>50</option></select>
            <div className="pager">
              <button className="iconbtn">{Ic("chevLeft", { size: 16 })}</button>
              <button className="iconbtn">{Ic("chevRight", { size: 16 })}</button>
            </div>
          </div>
          </>}
        </div>
      </div>
      {del && del.import && <Modal title="Import dashboard" sub="Paste a dashboard JSON or upload a file." icon="import" tone="brand" onClose={() => setDel(null)}
        footer={<><Btn onClick={() => setDel(null)}>Cancel</Btn><Btn variant="primary" icon="check" onClick={() => { setDel(null); toast("Dashboard imported"); }}>Import</Btn></>}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <button className="btn" style={{ height: 72, borderStyle: "dashed", flexDirection: "column", gap: 4 }} onClick={() => toast("File picker", "info")}>{Ic("import", { size: 20 })}<span style={{ fontSize: 12, color: "var(--text-3)" }}>Drop a .json file or click to browse</span></button>
          <textarea className="input mono" style={{ height: 100, padding: 11, resize: "vertical" }} placeholder='{ "title": "My dashboard", "panels": [ … ] }' />
        </div>
      </Modal>}
      {del && del.create && <Modal title="New folder" sub="Organize dashboards into a folder." icon="folder" tone="brand" onClose={() => setDel(null)}
        footer={<><Btn onClick={() => setDel(null)}>Cancel</Btn><Btn variant="primary" icon="check" onClick={() => setDel(null)}>Create folder</Btn></>}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={{ fontWeight: 600, fontSize: 13 }}>Folder name</label>
          <input className="input" placeholder="e.g. Production" autoFocus />
          <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 4, lineHeight: 1.5 }}>
            <b style={{ color: "var(--text-2)" }}>Why a dialog?</b> Creating a folder needs focused text entry and an explicit confirm — too heavy for a popover, too light for a page. That's a modal.
          </div>
        </div>
      </Modal>}
      {del && !del.create && <ConfirmDialog title={`Delete “${del.name}”?`}
        message="This permanently deletes the dashboard and all its panels for everyone in this organization. This cannot be undone."
        confirmLabel="Delete dashboard" onConfirm={() => setDel(null)} onClose={() => setDel(null)} />}
    </div>
  );
}

/* =========================================================== LOGS (tall search; no header row2) */
function LogsPage() {
  const ui = React.useContext(window.StateCtx);
  const [q, setQ] = uS("");
  const [stream, setStream] = uS("prod.logs");
  const [levels, setLevels] = uS({ info: true, warn: true, error: true });
  const toggleLvl = k => setLevels(l => ({ ...l, [k]: !l[k] }));
  const run = () => toast("Query executed · 3,418 events", "info");
  const visible = LOGS.filter(l => levels[l.lvl] !== false);
  return (
    <div className="panel fade-in">
      <span className="annot-badge">Flat search module · tall search owns the top · sections use the Surface token (Tweaks → Surface style: Combined / Dividers / Cards)</span>
      <PageHeader icon="logs" title="Logs"
        actions={<>
          <button className="chip" onClick={() => toast("Time range", "info")}>{Ic("clock", { size: 15 })} Last 15 min {Ic("chevDown", { size: 13 })}</button>
          <Btn icon="refresh" sm onClick={run}>Run query</Btn>
          <Btn icon="dots" variant="ghost" onClick={() => toast("More actions", "info")} />
        </>} />
      <div className="surfwrap">
        {/* query bar block */}
        <div className="surf surf-query">
          <div style={{ display: "flex", gap: 10, padding: "12px 14px", alignItems: "center" }} data-annot="tall search bar (in-content)">
            <select className="input" style={{ width: 170, height: 42 }} value={stream} onChange={e => setStream(e.target.value)}>
              <option>prod.logs</option><option>api.traces</option><option>auth.logs</option><option>infra.metrics</option>
            </select>
            <div className="field search-lg grow"><span className="mono" style={{ color: "var(--text-3)", fontSize: 12 }}>SQL</span>
              <input placeholder="SELECT * FROM prod.logs WHERE level='error'  —  type to search…" value={q} onChange={e => setQ(e.target.value)} /></div>
            <Btn icon="filter" onClick={() => toast("Field list", "info")}>Fields</Btn>
            <Btn variant="primary" icon="play" onClick={run}>Run</Btn>
          </div>
        </div>
        {/* histogram block */}
        <div className="surf">
          <div className="surf-head"><span className="sh-title">Events over time</span><span className="sh-meta"><b style={{ color: "var(--text-2)" }}>3,418</b> events · 0.42s</span></div>
          <div className="log-histogram" style={{ border: "none" }}>
            {HIST.map((h, i) => <div key={i} className="log-bar" style={{ height: `${h}%` }} />)}
          </div>
        </div>
        {/* results block */}
        <div className="surf grow" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div className="surf-head">
            <span className="sh-title">Results</span>
            <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
              <button className={"chip" + (levels.info ? " on" : "")} onClick={() => toggleLvl("info")}><span className="dot info" /> info</button>
              <button className={"chip" + (levels.warn ? " on" : "")} onClick={() => toggleLvl("warn")}><span className="dot warn" /> warn</button>
              <button className={"chip" + (levels.error ? " on" : "")} onClick={() => toggleLvl("error")}><span className="dot danger" /> error</button>
            </span>
          </div>
          <div className="log-list">
            {ui === "loading" ? <SkeletonList rows={14} /> : ui === "empty" ? <Empty icon="logs" title="No results" hint="Adjust your query or widen the time range">Nothing matched this query in the selected window.</Empty> : visible.map((l, i) => (
              <div key={i} className="log-row">
                <span className="log-ts">{l.ts}</span>
                <span className={"log-lvl " + l.lvl}>{l.lvl.toUpperCase()}</span>
                <span className="log-msg">{l.msg}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* =========================================================== TRACES (search + internal toggle) */
function TracesPage() {
  const ui = React.useContext(window.StateCtx);
  const [view, setView] = uS("list");
  const [q, setQ] = uS("");
  const [trace, setTrace] = uS(null);
  return (
    <div className="panel fade-in">
      <span className="annot-badge">Flat search module · List/Waterfall is an in-content toggle (A5), NOT a 2nd header row</span>
      <PageHeader icon="traces" title="Traces"
        actions={<>
          <button className="chip" onClick={() => toast("Time range", "info")}>{Ic("clock", { size: 15 })} Last 1 hour {Ic("chevDown", { size: 13 })}</button>
          <Btn icon="refresh" sm onClick={() => toast("Refreshed", "info")}>Run query</Btn>
        </>} />
      <div style={{ display: "flex", gap: 10, padding: "12px 14px", borderBottom: "1px solid var(--border-soft)", alignItems: "center" }} data-annot="tall search bar">
        <select className="input" style={{ width: 170, height: 42 }}><option>api.traces</option><option>orders.traces</option></select>
        <div className="field search-lg grow"><span className="mono" style={{ color: "var(--text-3)", fontSize: 12 }}>TQL</span>
          <input placeholder="service=orders-svc duration>200ms  —  filter spans…" value={q} onChange={e => setQ(e.target.value)} /></div>
        <Btn variant="primary" icon="play" onClick={() => toast("1,204 traces", "info")}>Run</Btn>
      </div>
      {/* internal toggle rides the section toolbar (A5) — not the header */}
      <div className="toolbar" style={{ justifyContent: "space-between" }} data-annot="A5 · in-content view toggle">
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, color: "var(--text-3)" }}>
          <b style={{ color: "var(--text-2)" }}>1,204</b> traces · p95 <b style={{ color: "var(--text-2)" }}>312ms</b>
        </div>
        <div className="seg">
          <button className={view === "list" ? "active" : ""} onClick={() => setView("list")}>{Ic("logs", { size: 14 })} List</button>
          <button className={view === "scatter" ? "active" : ""} onClick={() => setView("scatter")}>{Ic("metrics", { size: 14 })} Scatter</button>
        </div>
      </div>
      <div className="tbl-wrap">
        {ui === "loading" ? <SkeletonList rows={12} /> : ui === "empty" ? <Empty icon="traces" title="No traces" hint="Widen the time range or relax the filter">No spans matched this query.</Empty> : view === "list" ? (
          <div>
            {TRACES.map((t, i) => {
              const h = SVC_COLORS[t.root];
              const w = Math.max(8, (t.dur / 500) * 100);
              return (
                <div key={i} className="trace-row" style={{ cursor: "pointer" }} onClick={() => setTrace(t)}>
                  <div><span className="mono" style={{ fontSize: 11.5, color: "var(--text-2)" }}>{t.id.slice(0, 12)}</span></div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <span className="badge" style={{ background: `hsl(${h} 70% 95%)`, color: `hsl(${h} 60% 35%)` }}><span className="dot" style={{ background: `hsl(${h} 65% 50%)` }} />{t.root}</span>
                      <span style={{ fontWeight: 600 }}>{t.op}</span>
                      {t.err && <Badge kind="danger" dot>error</Badge>}
                    </div>
                    <div className="span-bar-track"><div className="span-bar" style={{ left: 0, width: `${w}%`, background: t.err ? "var(--danger)" : `hsl(${h} 60% 55%)` }} /></div>
                  </div>
                  <div className="mono" style={{ fontSize: 12, color: "var(--text-2)", textAlign: "right" }}>{t.dur}ms</div>
                  <div className="c-muted" style={{ fontSize: 12 }}>{t.spans} spans</div>
                </div>
              );
            })}
          </div>
        ) : (
          <Empty icon="metrics" title="Scatter view">Latency-over-time scatter plot would render here — the toggle stays inside the content, so the page keeps its single header.</Empty>
        )}
      </div>
      {trace && <Drawer title="Trace detail" icon="traces" onClose={() => setTrace(null)}
        actions={<><Btn sm icon="external">Open full</Btn></>}>
        <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border-soft)" }}>
          <div className="mono" style={{ fontSize: 12, color: "var(--text-2)" }}>{trace.id}</div>
          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            <Badge kind="info" dot>{trace.root}</Badge>
            <span className="chip">{trace.dur}ms total</span>
            <span className="chip">{trace.spans} spans</span>
            {trace.err && <Badge kind="danger" dot>error</Badge>}
          </div>
        </div>
        <div style={{ padding: "8px 0" }}>
          {Array.from({ length: trace.spans }).map((_, i) => {
            const off = (i / trace.spans) * 60;
            const w = Math.max(6, (1 - i / trace.spans) * 70 + 8);
            const svc = Object.keys(SVC_COLORS)[i % 5];
            return (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "140px 1fr 56px", gap: 10, padding: "5px 14px", alignItems: "center" }}>
                <span className="mono" style={{ fontSize: 11, color: "var(--text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingLeft: i * 6 }}>{svc}</span>
                <div className="span-bar-track"><div className="span-bar" style={{ left: `${off}%`, width: `${w}%`, background: `hsl(${SVC_COLORS[svc]} 60% 55%)` }} /></div>
                <span className="mono" style={{ fontSize: 11, color: "var(--text-3)", textAlign: "right" }}>{Math.round(trace.dur * w / 100)}ms</span>
              </div>
            );
          })}
        </div>
        <div style={{ padding: 12, fontSize: 11.5, color: "var(--text-3)", borderTop: "1px solid var(--border-soft)", lineHeight: 1.5 }}>
          <b style={{ color: "var(--text-2)" }}>Why a drawer?</b> A trace is contextual detail you triage <i>against the list</i> — you want the list still visible and Esc to dismiss. That's a drawer, not a full-page hop and not a modal.
        </div>
      </Drawer>}
    </div>
  );
}

Object.assign(window, { HomePage, DashboardsPage, LogsPage, TracesPage });
