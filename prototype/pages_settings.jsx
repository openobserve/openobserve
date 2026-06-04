// pages_settings.jsx — Settings as a config for the shared AdminModule (same pattern as IAM)
const Hs = window.hue;

const SETTINGS_RAIL = [
  { id: "general", label: "General", items: [
    { id: "org", label: "Organization", icon: "settings" },
    { id: "members", label: "Members", icon: "users" },
    { id: "querymgmt", label: "Query management", icon: "search" },
  ]},
  { id: "security", label: "Security", items: [
    { id: "cipher", label: "Cipher keys", icon: "key" },
    { id: "sso", label: "SSO / OAuth", icon: "shield" },
    { id: "regex", label: "Regex patterns", icon: "code" },
  ]},
  { id: "destinations", label: "Destinations", items: [
    { id: "templates", label: "Templates", icon: "reports" },
    { id: "dest-alerts", label: "Alert destinations", icon: "bell" },
    { id: "dest-pipe", label: "Pipeline destinations", icon: "pipelines" },
  ]},
  { id: "advanced", label: "Advanced", items: [
    { id: "nodes", label: "Nodes", icon: "box" },
    { id: "billing", label: "Billing & plans", icon: "tag" },
    { id: "logs-settings", label: "Logs settings", icon: "logs" },
    { id: "management", label: "Management", icon: "database" },
  ]},
];

const formStub = (cur) => () => {
  const fields = {
    querymgmt: [["Max concurrent queries", "20"], ["Query timeout", "120s"], ["Max result rows", "100000"]],
    sso: [["Provider", "Okta"], ["Client ID", "0oa3k…"], ["Callback URL", "https://api.openobserve.ai/cb"]],
    billing: [["Plan", "Enterprise"], ["Seats", "50"], ["Renewal", "Jan 1, 2027"]],
    "logs-settings": [["Default retention", "30 days"], ["Index fields", "level, service, trace_id"], ["Max field length", "8192"]],
    management: [["Telemetry", "Enabled"], ["Audit log export", "S3"], ["Maintenance window", "Sun 02:00 UTC"]],
  }[cur] || [["Setting", "Value"]];
  return <>{fields.map(([k, v], i) => <div key={i} className="form-row"><div><div className="fr-label">{k}</div></div><div><input className="input" defaultValue={v} style={{ maxWidth: 340 }} /></div></div>)}</>;
};

const SETTINGS_SECTIONS = {
  org: { kind: "form", label: "Organization", group: "General", icon: "settings", form: () => <OrgForm /> },
  members: { kind: "form", label: "Members", group: "General", icon: "users", form: () => <MembersForm /> },
  querymgmt: { kind: "form", label: "Query management", group: "General", icon: "search", form: formStub("querymgmt") },
  sso: { kind: "form", label: "SSO / OAuth", group: "Security", icon: "shield", form: formStub("sso") },
  billing: { kind: "form", label: "Billing & plans", group: "Advanced", icon: "tag", form: formStub("billing") },
  "logs-settings": { kind: "form", label: "Logs settings", group: "Advanced", icon: "logs", form: formStub("logs-settings") },
  management: { kind: "form", label: "Management", group: "Advanced", icon: "database", form: formStub("management") },

  templates: {
    label: "Templates", group: "Destinations", icon: "reports", noun: "template", rows: SET_TEMPLATES,
    columns: [
      { label: "Name", cls: "mono c-name", cell: t => t.name },
      { label: "Type", cell: t => <Badge kind="info">{t.type}</Badge> },
      { label: "Used by", cls: "c-muted", cell: t => `${t.used} destinations` },
    ],
    head: (t, c) => ({ icon: (t.type || "N").slice(0, 2), tone: `hsl(${Hs(t.type)} 60% 92%)`, color: `hsl(${Hs(t.type)} 55% 38%)`, title: c.isNew ? "New template" : t.name, sub: `${t.type} template` }),
    newTemplate: { id: "__new__", name: "", type: "Slack", used: 0 },
    form: (t, c) => <>
      <KV k="Name"><input className="input" defaultValue={t.name} placeholder="template-name" /></KV>
      <KV k="Type"><select className="input" defaultValue={t.type}><option>Slack</option><option>PagerDuty</option><option>Email</option><option>Webhook</option></select></KV>
      <SectionLabel>Body</SectionLabel>
      <div style={{ padding: "8px 18px 18px" }}><textarea className="input mono" style={{ height: 130, padding: 11, resize: "vertical", lineHeight: 1.5 }} defaultValue={c.isNew ? "" : `{\n  "title": "{{alert_name}}",\n  "severity": "{{severity}}"\n}`} placeholder="Payload with {{variables}}" /></div>
    </>,
  },
  "dest-alerts": destCfg("Alert destinations"),
  "dest-pipe": destCfg("Pipeline destinations"),
  cipher: {
    label: "Cipher keys", group: "Security", icon: "key", noun: "cipher key", rows: SET_CIPHER,
    columns: [
      { label: "Name", cls: "mono c-name", cell: c => c.name },
      { label: "Algorithm", cls: "c-muted", cell: c => c.algo },
      { label: "Last rotated", cls: "c-muted", cell: c => c.rotated },
    ],
    head: (k, c) => ({ icon: Ic("key", { size: 18 }), tone: "var(--g-150)", color: "var(--text)", title: c.isNew ? "New cipher key" : k.name, sub: c.isNew ? "Generate an encryption key" : k.algo }),
    newTemplate: { id: "__new__", name: "", algo: "AES-256-GCM", created: "—", rotated: "—" },
    form: (k, c) => <>
      <KV k="Name"><input className="input mono" defaultValue={k.name} placeholder="e.g. pii-key" /></KV>
      <KV k="Algorithm"><select className="input" defaultValue={k.algo}><option>AES-256-GCM</option><option>ChaCha20-Poly1305</option><option>AES-128-GCM</option></select></KV>
      {c.isNew
        ? <KV k="Source"><select className="input"><option>Generate new key</option><option>Import existing</option><option>External KMS (AWS)</option></select></KV>
        : <KV k="Key material"><div style={{ display: "flex", gap: 8, alignItems: "center" }}><span className="mono" style={{ padding: "6px 10px", background: "var(--g-100)", borderRadius: 7 }}>••••••••••••••••</span><button className="iconbtn" onClick={() => toast("Key copied", "info")}>{Ic("copy", { size: 16 })}</button></div></KV>}
    </>,
  },
  regex: {
    label: "Regex patterns", group: "Security", icon: "code", noun: "pattern", wide: true, rows: SET_REGEX,
    columns: [
      { label: "Name", cls: "c-name", cell: r => r.name },
      { label: "Pattern", cls: "mono c-muted", cell: r => r.pattern },
      { label: "Used by", cls: "c-muted", cell: r => `${r.used} pipelines` },
    ],
    head: (r, c) => ({ icon: Ic("code", { size: 18 }), title: c.isNew ? "New pattern" : r.name, sub: c.isNew ? "Redaction / extraction rule" : `Used by ${r.used} pipelines` }),
    newTemplate: { id: "__new__", name: "", pattern: "", replace: "", used: 0 },
    form: (r, c) => <>
      <KV k="Name"><input className="input" defaultValue={r.name} placeholder="e.g. redact-email" /></KV>
      <KV k="Pattern"><input className="input mono" defaultValue={r.pattern} placeholder="regular expression" /></KV>
      <KV k="Replacement"><input className="input mono" defaultValue={r.replace} placeholder="[REDACTED]" /></KV>
      <SectionLabel>Test against sample</SectionLabel>
      <div style={{ padding: "8px 18px 18px" }}><textarea className="input mono" style={{ height: 70, padding: 11, resize: "vertical" }} defaultValue="user john@acme.io logged in" />{!c.isNew && <div style={{ marginTop: 8, fontSize: 12, color: "var(--ok)" }}>{Ic("check", { size: 14, style: { verticalAlign: -2 } })} 1 match → {r.replace}</div>}</div>
    </>,
  },
  nodes: {
    label: "Nodes", group: "Advanced", icon: "box", noun: "node", wide: true, rows: SET_NODES, deletable: false,
    columns: [
      { label: "Name", cls: "mono c-name", cell: n => n.name },
      { label: "Role", cell: n => <Badge kind="neutral">{n.role}</Badge> },
      { label: "Status", cell: n => <Badge kind={n.status === "healthy" ? "ok" : "warn"} dot>{n.status}</Badge> },
      { label: "CPU", cls: "mono", cell: n => `${n.cpu}%` },
      { label: "Memory", cls: "mono", cell: n => `${n.mem}%` },
    ],
    head: (n, c) => ({ icon: Ic("box", { size: 18 }), tone: n.status === "healthy" ? "var(--ok-tint)" : "var(--warn-tint)", color: n.status === "healthy" ? "var(--ok)" : "var(--warn)", title: n.name, sub: `${n.role} · ${n.region}` }),
    newTemplate: { id: "__new__", name: "", role: "Ingester", status: "healthy", cpu: 0, mem: 0, region: "us-east-1a" },
    form: (n, c) => <>
      <KV k="Status"><Badge kind={n.status === "healthy" ? "ok" : "warn"} dot>{n.status}</Badge></KV>
      <KV k="Role"><select className="input" defaultValue={n.role}><option>Ingester</option><option>Querier</option><option>Compactor</option><option>Router</option></select></KV>
      <KV k="Region"><span className="mono">{n.region}</span></KV>
      <SectionLabel>Utilization</SectionLabel>
      {[["CPU", n.cpu], ["Memory", n.mem]].map(([lbl, v]) => (
        <div key={lbl} className="kv"><div className="kv-k">{lbl}</div><div className="kv-v"><div style={{ display: "flex", alignItems: "center", gap: 10 }}><div style={{ flex: 1, height: 8, borderRadius: 99, background: "var(--g-150)", overflow: "hidden", maxWidth: 240 }}><div style={{ height: "100%", width: v + "%", background: v > 80 ? "var(--warn)" : "var(--iris-1000)" }} /></div><span className="mono" style={{ fontSize: 12 }}>{v}%</span></div></div></div>
      ))}
    </>,
  },
};

function destCfg(label) {
  return {
    label, group: "Destinations", icon: "link", noun: "destination", wide: true, rows: SET_DESTINATIONS,
    columns: [
      { label: "Name", cls: "c-name", cell: d => d.name },
      { label: "Type", cell: d => <Badge kind="info">{d.type}</Badge> },
      { label: "Endpoint", cls: "mono c-muted", cell: d => d.url },
      { label: "Active", cell: d => <Badge kind={d.active ? "ok" : "neutral"} dot>{d.active ? "on" : "off"}</Badge> },
    ],
    head: (d, c) => ({ icon: (d.type || "N").slice(0, 2), tone: `hsl(${Hs(d.type)} 60% 92%)`, color: `hsl(${Hs(d.type)} 55% 38%)`, title: c.isNew ? "New destination" : d.name, sub: `${d.type} destination` }),
    newTemplate: { id: "__new__", name: "", type: "Slack", url: "", active: true },
    form: (d, c) => <>
      <KV k="Name"><input className="input" defaultValue={d.name} placeholder="#channel or name" /></KV>
      <KV k="Type"><select className="input" defaultValue={d.type}><option>Slack</option><option>PagerDuty</option><option>Email</option><option>Webhook</option></select></KV>
      <KV k="Endpoint"><input className="input mono" defaultValue={d.url} placeholder="https://…" /></KV>
      <KV k="Template"><select className="input"><option>slack-default</option><option>email-digest</option></select></KV>
      <KV k="Active"><Toggle on={d.active} onClick={() => toast(d.active ? "Disabled" : "Enabled", "info")} /></KV>
    </>,
  };
}

function SettingsPage() {
  return <AdminModule moduleTitle="Settings" moduleIcon="settings" railGroups={SETTINGS_RAIL} sections={SETTINGS_SECTIONS} defaultId="org" />;
}
window.SettingsPage = SettingsPage;
