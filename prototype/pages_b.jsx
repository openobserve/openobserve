// pages_b.jsx — Settings (A2), IAM (A2+A6), Ingestion (A4+A5), Alerts (A1+A6)
const { useState: uSt } = React;

/* ---------- reusable grouped L2 rail (A2) ---------- */
function GroupedRail({ title, groups, active, onPick, search, setSearch }) {
  const [collapsed, setCollapsed] = uSt({});
  const filt = (items) => search ? items.filter(i => i.label.toLowerCase().includes(search.toLowerCase())) : items;
  return (
    <aside className="l2" data-annot="A2 · grouped section rail (L2)">
      <div className="l2-head"><span className="l2-title">{title}</span></div>
      <div className="l2-search"><Field placeholder={"Search " + title.toLowerCase()} value={search} onChange={setSearch} /></div>
      <div className="l2-list">
        {groups.map(g => {
          const items = filt(g.items);
          if (!items.length) return null;
          const isC = collapsed[g.id];
          return (
            <div key={g.id} className="l2-group">
              <button className={"l2-ghead" + (isC ? " collapsed" : "")} onClick={() => setCollapsed(c => ({ ...c, [g.id]: !c[g.id] }))}>
                {g.label}{Ic("chevDown", { size: 13, className: "chev" })}
              </button>
              {!isC && items.map(it => (
                <button key={it.id} className={"l2-link" + (active === it.id ? " active" : "")} onClick={() => onPick(it.id)}>
                  {Ic(it.icon, { size: 16 })}<span>{it.label}</span>
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

/* =========================================================== SETTINGS (A2 grouped rail) */
function SettingsPage() {
  const [active, setActive] = uSt("org");
  const [search, setSearch] = uSt("");
  const flat = SETTINGS_GROUPS.flatMap(g => g.items.map(i => ({ ...i, group: g.label })));
  const cur = flat.find(i => i.id === active) || flat[0];
  return (
    <div className="panel fade-in" style={{ flexDirection: "row" }}>
      <span className="annot-badge">Many-section module (16) · A2 grouped rail · breadcrumb appears only on an editor drill-in</span>
      <GroupedRail title="Settings" groups={SETTINGS_GROUPS} active={active} onPick={setActive} search={search} setSearch={setSearch} />
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
        <PageHeader icon={cur.icon} title={cur.label}
          subtitle={cur.group + " settings"}
          actions={<><Btn>Cancel</Btn><Btn variant="primary" icon="check">Save changes</Btn></>}
          row2={<Breadcrumb items={[{ label: "Settings", onClick: () => setActive("org") }, { label: cur.group }, { label: cur.label }]} />} />
        <div className="detail-pane">
          {active === "org" ? <OrgForm /> : active === "members" ? <MembersForm /> : <GenericForm cur={cur} />}
        </div>
      </div>
    </div>
  );
}
function OrgForm() {
  return <>
    <FormRow label="Organization name" help="Shown in the org switcher and reports."><input className="input" defaultValue="default" /></FormRow>
    <FormRow label="Organization ID" help="Immutable identifier used by the API."><input className="input mono" defaultValue="org_7H2kP9xQ" readOnly style={{ background: "var(--g-50)", color: "var(--text-3)" }} /></FormRow>
    <FormRow label="Default timezone"><select className="input" style={{ maxWidth: 280 }}><option>UTC</option><option>America/New_York</option><option>Europe/Berlin</option></select></FormRow>
    <FormRow label="Data retention" help="How long ingested data is kept before deletion."><select className="input" style={{ maxWidth: 200 }}><option>30 days</option><option>90 days</option><option>1 year</option></select></FormRow>
    <FormRow label="Ingestion endpoint"><input className="input mono" defaultValue="https://api.openobserve.ai/default/_json" /></FormRow>
  </>;
}
function MembersForm() {
  const members = [["Platform Team", "pt@russia.com", "admin"], ["Ada Lovelace", "ada@acme.io", "editor"], ["Grace Hopper", "grace@acme.io", "editor"], ["Alan Turing", "alan@acme.io", "viewer"]];
  return <div style={{ padding: 0 }}>
    <div className="toolbar"><Field className="grow" placeholder="Search members" /><Btn variant="primary" icon="plus">Invite member</Btn></div>
    <table className="tbl"><thead><tr><th>Member</th><th>Email</th><th>Role</th><th style={{ textAlign: "right" }}>Actions</th></tr></thead>
      <tbody>{members.map((m, i) => <tr key={i}>
        <td><span className="avatar-xs">{m[0].split(" ").map(w => w[0]).join("")}</span><b>{m[0]}</b></td>
        <td className="mono c-muted">{m[1]}</td>
        <td><Badge kind={m[2] === "admin" ? "info" : "neutral"}>{m[2]}</Badge></td>
        <td><div className="row-act"><button className="iconbtn">{Ic("edit", { size: 16 })}</button><button className="iconbtn danger">{Ic("trash", { size: 16 })}</button></div></td>
      </tr>)}</tbody></table>
  </div>;
}
function GenericForm({ cur }) {
  return <Empty icon={cur.icon} title={cur.label}>This section’s form renders here. The point: the <b>grouped rail</b> keeps all 16 settings reachable in one click, the header carries the breadcrumb, and there’s only ever one header.</Empty>;
}
const FormRow = ({ label, help, children }) => (
  <div className="form-row"><div><div className="fr-label">{label}</div>{help && <div className="fr-help">{help}</div>}</div><div>{children}</div></div>
);

/* =========================================================== IAM (A2 rail + A6 master-detail) */
function IamPage() {
  const [active, setActive] = uSt("roles");
  const [search, setSearch] = uSt("");
  const flat = IAM_GROUPS.flatMap(g => g.items.map(i => ({ ...i, group: g.label })));
  const cur = flat.find(i => i.id === active) || flat[0];
  return (
    <div className="panel fade-in" style={{ flexDirection: "row" }}>
      <span className="annot-badge">Admin module · A2 rail for sections + A6 master-detail for Roles/Groups editing</span>
      <GroupedRail title="IAM" groups={IAM_GROUPS} active={active} onPick={(id) => { setActive(id); }} search={search} setSearch={setSearch} />
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
        {active === "roles" ? <RolesMasterDetail cur={cur} /> : <IamGeneric cur={cur} />}
      </div>
    </div>
  );
}
function RolesMasterDetail({ cur }) {
  const [selId, setSel] = uSt("admin");
  const role = IAM_ROLES.find(r => r.id === selId);
  return <>
    <PageHeader icon="shield" title="Roles"
      subtitle="Define permission sets and assign them to users"
      actions={<Btn variant="primary" icon="plus">New role</Btn>}
      row2={<Breadcrumb items={[{ label: "IAM", onClick: () => {} }, { label: "Access Control" }, { label: "Roles" }, { label: role.name }]} />} />
    <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
      {/* master list */}
      <div style={{ width: 256, borderRight: "1px solid var(--border-soft)", display: "flex", flexDirection: "column", background: "var(--g-50)" }} data-annot="A6 master list">
        <div style={{ padding: 10 }}><Field placeholder="Search roles" /></div>
        <div style={{ flex: 1, overflowY: "auto", padding: "0 8px 10px" }}>
          {IAM_ROLES.map(r => (
            <button key={r.id} className={"l2-link" + (selId === r.id ? " active" : "")} onClick={() => setSel(r.id)} style={{ flexDirection: "column", alignItems: "flex-start", gap: 3, padding: "9px 10px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
                {Ic("shield", { size: 15 })}<b>{r.name}</b>
                {r.system && <span className="badge neutral" style={{ height: 18, marginLeft: "auto" }}>system</span>}
              </div>
              <span style={{ fontSize: 11, color: "var(--text-3)", paddingLeft: 23, fontWeight: 500 }}>{r.users} users · {r.perms} permissions</span>
            </button>
          ))}
        </div>
      </div>
      {/* detail editor */}
      <div className="detail-pane" data-annot="A6 detail editor (no full-page hop)">
        <FormRow label="Role name"><input className="input" defaultValue={role.name} readOnly={role.system} style={role.system ? { background: "var(--g-50)", color: "var(--text-3)" } : {}} /></FormRow>
        <FormRow label="Description"><input className="input" defaultValue={role.desc} /></FormRow>
        <FormRow label="Assigned users" help="Members who currently hold this role.">
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {Array.from({ length: Math.min(role.users, 5) }).map((_, i) => <span key={i} className="chip"><span className="avatar-xs" style={{ margin: 0 }}>U{i + 1}</span>user{i + 1}@acme.io</span>)}
            {role.users > 5 && <span className="chip">+{role.users - 5} more</span>}
          </div>
        </FormRow>
        <div style={{ padding: "14px 14px 8px", fontWeight: 800, fontSize: 12, textTransform: "uppercase", letterSpacing: ".5px", color: "var(--text-3)" }}>Permissions</div>
        {[["Dashboards", true, true], ["Logs & Streams", true, role.id !== "viewer"], ["Alerts", role.id === "admin" || role.id === "alerts-mgr", role.id === "admin"], ["IAM & Users", role.id === "admin", role.id === "admin"], ["Billing", role.id === "admin" || role.id === "billing", role.id === "billing"]].map((p, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 90px 90px", gap: 10, padding: "10px 14px", borderBottom: "1px solid var(--border-soft)", alignItems: "center" }}>
            <b style={{ fontWeight: 600 }}>{p[0]}</b>
            <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: "var(--text-2)" }}><Cbx on={p[1]} />Read</label>
            <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: "var(--text-2)" }}><Cbx on={p[2]} />Write</label>
          </div>
        ))}
        <div style={{ display: "flex", gap: 8, padding: 14, justifyContent: "flex-end" }}><Btn>Cancel</Btn><Btn variant="primary" icon="check">Save role</Btn></div>
      </div>
    </div>
  </>;
}
function IamGeneric({ cur }) {
  return <>
    <PageHeader icon={cur.icon} title={cur.label} subtitle={cur.group}
      row2={<Breadcrumb items={[{ label: "IAM" }, { label: cur.group }, { label: cur.label }]} />} />
    <Empty icon={cur.icon} title={cur.label}>Same A2 rail, same single header. {cur.label} would list here — Groups & Users reuse the master-detail pattern from Roles.</Empty>
  </>;
}

/* =========================================================== INGESTION (A4 drill rail + A5 leaf grid) */
function IngestionPage() {
  const [cat, setCat] = uSt(null);        // null = categories list; else drilled in
  const [provider, setProvider] = uSt(null);
  const [q, setQ] = uSt("");
  const catObj = ING_CATEGORIES.find(c => c.id === cat);
  const providers = cat ? (ING_PROVIDERS[cat] || []) : [];
  const filtered = providers.filter(p => p.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="panel fade-in" style={{ flexDirection: "row" }}>
      <span className="annot-badge">Deep module · A4 push/pop drill rail (category→providers) · A5 leaf grid · breadcrumb on a chosen provider</span>
      {/* A4 drill rail */}
      <aside className="l2" data-annot="A4 · drill rail (push/pop)">
        {!cat ? (
          <>
            <div className="l2-head"><span className="l2-title">Ingestion</span></div>
            <div className="l2-list">
              {ING_CATEGORIES.map(c => (
                <button key={c.id} className="drill-cat" onClick={() => { setCat(c.id); setProvider(null); setQ(""); }}>
                  <span className="di">{Ic(c.icon, { size: 15 })}</span>
                  <span>{c.label}</span>
                  {Ic("chevRight", { size: 15, className: "dchev" })}
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <button className="drill-back" onClick={() => { setCat(null); setProvider(null); }}>{Ic("arrowLeft", { size: 15 })} All categories</button>
            <div className="l2-head" style={{ paddingTop: 9 }}><span className="l2-title">{catObj.label}</span></div>
            <div className="l2-search"><Field placeholder={"Search " + catObj.label.toLowerCase()} value={q} onChange={setQ} /></div>
            <div className="l2-list">
              {filtered.map(p => (
                <button key={p} className={"l2-link" + (provider === p ? " active" : "")} onClick={() => setProvider(p)}>
                  <span style={{ width: 18, height: 18, borderRadius: 5, background: `hsl(${hue(p)} 65% 92%)`, color: `hsl(${hue(p)} 55% 40%)`, display: "grid", placeItems: "center", fontWeight: 800, fontSize: 9, flex: "none" }}>{p.slice(0, 1)}</span>
                  <span>{p}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </aside>
      {/* content */}
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
        <PageHeader icon="datasources" title={provider || catObj?.label || "Data sources"}
          subtitle={provider ? "Setup guide" : catObj ? null : "Connect a source to start ingesting"}
          actions={provider ? <><Btn icon="external">Docs</Btn><Btn variant="primary" icon="check">Mark connected</Btn></> : <Btn icon="search">Browse all</Btn>}
          row2={
            provider
              ? <Breadcrumb items={[{ label: "Ingestion", onClick: () => { setCat(null); setProvider(null); } }, { label: catObj.label, onClick: () => setProvider(null) }, { label: provider }]} />
              : catObj
                ? <Breadcrumb items={[{ label: "Ingestion", onClick: () => setCat(null) }, { label: catObj.label }]} />
                : null
          } />
        {provider ? <ProviderSetup provider={provider} /> : catObj ? (
          <div className="cardgrid">
            {filtered.map(p => (
              <button key={p} className="pcard" onClick={() => setProvider(p)}>
                <span className="pc-logo" style={{ background: `hsl(${hue(p)} 65% 93%)`, color: `hsl(${hue(p)} 55% 38%)` }}>{p.slice(0, 1)}</span>
                <span className="pc-name">{p}</span>
                <span className="pc-desc">Ship {p} logs & metrics via OpenTelemetry.</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="cardgrid">
            {ING_CATEGORIES.map(c => (
              <button key={c.id} className="pcard" onClick={() => { setCat(c.id); setQ(""); }}>
                <span className="pc-logo" style={{ background: "var(--iris-300)", color: "var(--iris-1100)" }}>{Ic(c.icon, { size: 19 })}</span>
                <span className="pc-name">{c.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
function ProviderSetup({ provider }) {
  return <div className="detail-pane">
    <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 14px", borderBottom: "1px solid var(--border-soft)" }}>
      <span className="pc-logo" style={{ width: 48, height: 48, fontSize: 20, background: `hsl(${hue(provider)} 65% 93%)`, color: `hsl(${hue(provider)} 55% 38%)` }}>{provider.slice(0, 1)}</span>
      <div><div style={{ fontWeight: 800, fontSize: 16 }}>{provider}</div><div style={{ color: "var(--text-3)", fontSize: 12 }}>OpenTelemetry-based ingestion · ~3 min setup</div></div>
    </div>
    {["Install the collector", "Configure the endpoint", "Verify ingestion"].map((s, i) => (
      <div key={i} style={{ padding: "14px", borderBottom: "1px solid var(--border-soft)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 9 }}>
          <span style={{ width: 22, height: 22, borderRadius: 999, background: "var(--iris-1100)", color: "#fff", fontWeight: 800, fontSize: 12, display: "grid", placeItems: "center" }}>{i + 1}</span>
          <b>{s}</b>
        </div>
        <pre className="mono" style={{ margin: 0, marginLeft: 31, padding: 12, background: "var(--g-900)", color: "#E6E8EE", borderRadius: 9, fontSize: 12, overflow: "auto" }}>{
          i === 0 ? `curl -sSL https://get.openobserve.ai/otel | sh` :
          i === 1 ? `OTEL_EXPORTER_OTLP_ENDPOINT="https://api.openobserve.ai/default"\nOTEL_EXPORTER_OTLP_HEADERS="Authorization=Basic <token>"` :
          `# tail the collector\notel-collector --config ./${provider.toLowerCase()}.yaml`
        }</pre>
      </div>
    ))}
  </div>;
}

/* =========================================================== ALERTS (A1 tabs + A6 list→editor) */
function AlertsPage() {
  const [tab, setTab] = uSt("alerts");
  const [editing, setEditing] = uSt(null);  // alert object → editor drill
  const tabs = [
    { id: "alerts", label: "Alerts", icon: "alerts", count: ALERTS.length },
    { id: "destinations", label: "Destinations", icon: "link", count: 4 },
    { id: "templates", label: "Templates", icon: "reports", count: 6 },
    { id: "history", label: "History", icon: "clock" },
  ];

  if (editing) {
    // L3 editor drill → breadcrumb replaces tabs (never both)
    return (
      <div className="panel fade-in">
        <span className="annot-badge">A6 drill-in → breadcrumb REPLACES the tabs (one header rule: never tabs + breadcrumb together)</span>
        <PageHeader icon="alerts" title={editing.name}
          subtitle="Threshold alert"
          actions={<><Btn onClick={() => toast("Test alert sent", "info")}>Test</Btn><Btn onClick={() => setEditing(null)}>Cancel</Btn><Btn variant="primary" icon="check" onClick={() => { setEditing(null); toast("Alert saved"); }}>Save alert</Btn></>}
          row2={<Breadcrumb items={[{ label: "Alerts", onClick: () => setEditing(null) }, { label: "Alerts", onClick: () => setEditing(null) }, { label: editing.name || "New alert" }]} />} />
        <div className="detail-pane">
          <FormRow label="Alert name"><input className="input" defaultValue={editing.name} placeholder="e.g. High CPU usage" /></FormRow>
          <FormRow label="Stream"><select className="input" style={{ maxWidth: 260 }} defaultValue={editing.stream}><option>{editing.stream}</option><option>prod.logs</option></select></FormRow>
          <FormRow label="Condition" help="Fires when the query result crosses the threshold.">
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span className="mono" style={{ padding: "8px 11px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--g-50)" }}>avg(cpu_pct)</span>
              <select className="input" style={{ width: 70 }}><option>&gt;</option><option>&lt;</option><option>=</option></select>
              <input className="input" style={{ width: 80 }} defaultValue="90" />
              <span style={{ color: "var(--text-3)" }}>for</span>
              <input className="input" style={{ width: 70 }} defaultValue="5m" />
            </div>
          </FormRow>
          <FormRow label="Severity"><div className="seg"><button className={editing.sev === "critical" ? "active" : ""}>Critical</button><button className={editing.sev === "warning" ? "active" : ""}>Warning</button><button>Info</button></div></FormRow>
          <FormRow label="Destinations"><div style={{ display: "flex", gap: 6 }}><span className="chip on">{Ic("slack", { size: 14 })} #alerts-prod</span><button className="chip" onClick={() => toast("Add destination")}>{Ic("plus", { size: 14 })} Add</button></div></FormRow>
        </div>
      </div>
    );
  }

  const noun = { alerts: "alert", destinations: "destination", templates: "template", history: "" }[tab];
  return (
    <div className="panel fade-in">
      <span className="annot-badge">Primary CTA stays top-right in the header (industry convention) · tabs are sub-nav · slim filter bar below · row click drills to A6 editor</span>
      <PageHeader icon="alerts" title="Alerts"
        subtitle="Threshold, anomaly & scheduled alerting"
        actions={tab !== "history" ? <><Btn icon="import" onClick={() => toast("Import alerts", "info")}>Import</Btn><Btn variant="primary" icon="plus" onClick={() => tab === "alerts" ? setEditing({ name: "", stream: "prod.logs", sev: "critical", type: "Threshold" }) : toast(`New ${noun}`)}>New {noun}</Btn></> : null}
        row2={<Tabs items={tabs} active={tab} onPick={setTab} />} />
      {tab !== "history" && <SectionToolbar search={""} setSearch={() => {}} placeholder={`Search ${tab}`}
        annot="filter bar (search only)" />}
      {tab === "alerts" ? (
        <div className="tbl-wrap">
          <table className="tbl"><thead><tr>
            <th style={{ width: 40 }}><Cbx /></th><th>Status</th><th>Name</th><th>Stream</th><th>Type</th><th>Severity</th><th>Fires (24h)</th><th style={{ textAlign: "right" }}>Actions</th>
          </tr></thead><tbody>
            {ALERTS.map(a => (
              <tr key={a.id} style={{ cursor: "pointer" }} onClick={() => setEditing(a)}>
                <td onClick={e => e.stopPropagation()}><Cbx /></td>
                <td onClick={e => e.stopPropagation()}><Toggle on={a.on} onClick={() => {}} /></td>
                <td className="c-name">{a.name}</td>
                <td className="mono c-muted">{a.stream}</td>
                <td>{a.type}</td>
                <td><Badge kind={a.sev === "critical" ? "danger" : a.sev === "warning" ? "warn" : "neutral"} dot>{a.sev}</Badge></td>
                <td className="mono">{a.fires > 0 ? <b style={{ color: a.sev === "critical" ? "var(--danger)" : "var(--text)" }}>{a.fires}</b> : <span className="c-muted">0</span>}</td>
                <td onClick={e => e.stopPropagation()}><div className="row-act">
                  <button className="iconbtn" onClick={() => setEditing(a)}>{Ic("edit", { size: 16 })}</button>
                  <button className="iconbtn" onClick={() => toast("Alert duplicated")}>{Ic("copy", { size: 16 })}</button>
                  <button className="iconbtn danger" onClick={() => toast(`“${a.name}” deleted`, "danger")}>{Ic("trash", { size: 16 })}</button>
                </div></td>
              </tr>
            ))}
          </tbody></table>
        </div>
      ) : <Empty icon={tabs.find(t => t.id === tab).icon} title={tabs.find(t => t.id === tab).label}>This tab keeps the exact same single header — only the row2 tab strip changes. Drilling into any item swaps the tabs for a breadcrumb.</Empty>}
    </div>
  );
}

Object.assign(window, { SettingsPage, IamPage, IngestionPage, AlertsPage, GroupedRail, OrgForm, MembersForm, FormRow });
