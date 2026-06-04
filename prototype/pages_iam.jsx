// pages_iam.jsx — IAM as a config for the shared AdminModule (rail + table + drawer)
const Hh = window.hue;
const initials = n => (n || "?").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();

const IAM_RAIL = [
  { id: "access", label: "Access control", items: [
    { id: "users", label: "Users", icon: "user" },
    { id: "roles", label: "Roles", icon: "shield" },
    { id: "groups", label: "Groups", icon: "users" },
  ]},
  { id: "auth", label: "Authentication", items: [
    { id: "serviceAccounts", label: "Service accounts", icon: "key" },
    { id: "organizations", label: "Organizations", icon: "globe" },
    { id: "quota", label: "Quota", icon: "metrics" },
    { id: "invitations", label: "Invitations", icon: "link" },
  ]},
];

const roleBadge = r => <Badge kind={r === "admin" ? "info" : "neutral"}>{r}</Badge>;
const statusBadge = s => <Badge kind={s === "active" ? "ok" : "warn"} dot>{s}</Badge>;
const bar = (v) => <div style={{ display: "flex", alignItems: "center", gap: 8 }}><div style={{ width: 90, height: 7, borderRadius: 99, background: "var(--g-150)", overflow: "hidden" }}><div style={{ height: "100%", width: v + "%", background: v > 80 ? "var(--warn)" : "var(--iris-1000)" }} /></div><span className="mono" style={{ fontSize: 11 }}>{v}%</span></div>;

const IAM_SECTIONS = {
  users: {
    label: "Users", group: "Access control", icon: "user", noun: "user", wide: true, rows: IAM_USERS,
    columns: [
      { label: "Name", cell: u => <span><span className="avatar-xs" style={{ background: `hsl(${Hh(u.name)} 60% 90%)`, color: `hsl(${Hh(u.name)} 55% 35%)` }}>{initials(u.name)}</span><b style={{ fontWeight: 500 }}>{u.name}</b></span> },
      { label: "Email", cls: "mono c-muted", cell: u => u.email },
      { label: "Role", cell: u => roleBadge(u.role) },
      { label: "Status", cell: u => statusBadge(u.status) },
      { label: "Last active", cls: "c-muted", cell: u => u.last },
    ],
    head: (u, c) => ({ icon: c.isNew ? Ic("user", { size: 18 }) : initials(u.name), tone: `hsl(${Hh(u.name || "x")} 60% 92%)`, color: `hsl(${Hh(u.name || "x")} 55% 38%)`, title: c.isNew ? "New user" : u.name, sub: c.isNew ? "Invite a member" : u.email }),
    newTemplate: { id: "__new__", name: "", email: "", role: "viewer", status: "active", last: "—", groups: [], mfa: false },
    form: (u, c) => <>
      <SectionLabel>Account</SectionLabel>
      <KV k="Name"><input className="input" defaultValue={u.name} placeholder="Full name" /></KV>
      <KV k="Email"><input className="input mono" defaultValue={u.email} placeholder="name@company.com" /></KV>
      {!c.isNew && <KV k="Status">{statusBadge(u.status)}</KV>}
      <KV k="Role"><select className="input" defaultValue={u.role}><option>admin</option><option>editor</option><option>viewer</option></select></KV>
      {!c.isNew && <KV k="MFA">{u.mfa ? <Badge kind="ok" dot>Enabled</Badge> : <Badge kind="warn" dot>Not set up</Badge>}</KV>}
      <SectionLabel>Groups</SectionLabel>
      <div style={{ padding: "8px 18px 18px" }}><div className="tablist">
        {u.groups && u.groups.length ? u.groups.map(g => <span key={g} className="chip on">{Ic("users", { size: 13 })}{g}</span>) : <span className="c-muted" style={{ fontSize: 12 }}>No groups</span>}
        <button className="chip" onClick={() => toast("Add to group")}>{Ic("plus", { size: 13 })} Add</button>
      </div></div>
    </>,
  },
  roles: {
    label: "Roles", group: "Access control", icon: "shield", noun: "role", rows: IAM_ROLES,
    columns: [
      { label: "Name", cell: r => <b style={{ fontWeight: 500 }}>{r.name}</b> },
      { label: "Users", cls: "mono", cell: r => r.users },
      { label: "Permissions", cls: "mono", cell: r => r.perms },
      { label: "Type", cell: r => r.system ? <Badge kind="neutral">system</Badge> : <Badge kind="info">custom</Badge> },
    ],
    head: (r, c) => ({ icon: Ic("shield", { size: 18 }), title: c.isNew ? "New role" : r.name, sub: c.isNew ? "Define a permission set" : r.desc }),
    newTemplate: { id: "__new__", name: "", desc: "", users: 0, perms: 0, system: false },
    wide: true,
    form: (r, c) => <>
      <KV k="Role name"><input className="input" defaultValue={r.name} placeholder="e.g. alerts-manager" /></KV>
      <KV k="Description"><input className="input" defaultValue={r.desc} placeholder="What can this role do?" /></KV>
      <div className="permrow head"><span>Resource</span><span className="pcell">Read</span><span className="pcell">Write</span><span className="pcell">Admin</span></div>
      {PERM_CATS.map((p, i) => {
        const lvl = c.isNew ? 0 : r.id === "admin" ? 3 : r.id === "editor" ? 2 : r.id === "viewer" ? 1 : (i % 3) + 1;
        return <div key={p} className="permrow"><b style={{ fontWeight: 500 }}>{p}</b><span className="pcell"><Cbx on={lvl >= 1} /></span><span className="pcell"><Cbx on={lvl >= 2} /></span><span className="pcell"><Cbx on={lvl >= 3} /></span></div>;
      })}
    </>,
  },
  groups: {
    label: "Groups", group: "Access control", icon: "users", noun: "group", rows: IAM_GROUPS_REC,
    columns: [
      { label: "Name", cell: g => <b style={{ fontWeight: 500 }}>{g.name}</b> },
      { label: "Members", cls: "mono", cell: g => g.members },
      { label: "Roles", cell: g => <span className="tablist">{g.roles.map(r => <span key={r} className="chip" style={{ height: 22 }}>{r}</span>)}</span> },
    ],
    head: (g, c) => ({ icon: Ic("users", { size: 18 }), tone: `hsl(${Hh(g.name || "x")} 60% 92%)`, color: `hsl(${Hh(g.name || "x")} 55% 38%)`, title: c.isNew ? "New group" : g.name, sub: c.isNew ? "Create a group" : g.desc }),
    newTemplate: { id: "__new__", name: "", desc: "", members: 0, roles: [] },
    form: (g, c) => <>
      <KV k="Group name"><input className="input" defaultValue={g.name} placeholder="e.g. Platform" /></KV>
      <KV k="Description"><input className="input" defaultValue={g.desc} placeholder="Purpose of this group" /></KV>
      <SectionLabel>Attached roles</SectionLabel>
      <div style={{ padding: "8px 18px" }}><div className="tablist">
        {g.roles.map(r => <span key={r} className="chip on">{Ic("shield", { size: 13 })}{r}</span>)}
        <button className="chip" onClick={() => toast("Attach role")}>{Ic("plus", { size: 13 })} Attach</button>
      </div></div>
    </>,
  },
  serviceAccounts: {
    label: "Service accounts", group: "Authentication", icon: "key", noun: "service account", wide: true, rows: IAM_SA,
    columns: [
      { label: "Name", cls: "mono c-name", cell: s => s.name },
      { label: "Scopes", cell: s => <span className="tablist">{s.scopes.slice(0, 3).map(x => <span key={x} className="chip mono" style={{ height: 22, fontSize: 10 }}>{x}</span>)}</span> },
      { label: "Expiry", cls: "c-muted", cell: s => s.expiry },
    ],
    head: (s, c) => ({ icon: Ic("key", { size: 18 }), tone: "var(--g-150)", color: "var(--text)", title: c.isNew ? "New service account" : s.name, sub: c.isNew ? "Machine credential" : `Created ${s.created}` }),
    newTemplate: { id: "__new__", name: "", token: "oo_sa_••••••••", created: "—", scopes: [], expiry: "No expiry" },
    form: (s, c) => <>
      <SectionLabel>Credentials</SectionLabel>
      {c.isNew ? <KV k="Name"><input className="input mono" placeholder="e.g. ci-pipeline" /></KV>
        : <KV k="Token"><div style={{ display: "flex", gap: 8, alignItems: "center" }}><span className="mono" style={{ padding: "6px 10px", background: "var(--g-100)", borderRadius: 7 }}>{s.token}</span><button className="iconbtn" onClick={() => toast("Token copied", "info")}>{Ic("copy", { size: 16 })}</button></div></KV>}
      <KV k="Expiry"><select className="input" defaultValue={s.expiry}><option>No expiry</option><option>30 days</option><option>90 days</option><option>1 year</option></select></KV>
      <SectionLabel>Scopes</SectionLabel>
      <div style={{ padding: "8px 18px 18px" }}><div className="tablist">
        {s.scopes.map(sc => <span key={sc} className="chip on mono" style={{ fontSize: 11 }}>{sc}</span>)}
        <button className="chip" onClick={() => toast("Add scope")}>{Ic("plus", { size: 13 })} Add scope</button>
      </div></div>
    </>,
  },
  organizations: {
    label: "Organizations", group: "Authentication", icon: "globe", noun: "organization", rows: IAM_ORGS,
    columns: [
      { label: "Name", cell: o => <span><span className="avatar-xs" style={{ background: "var(--iris-400)", color: "var(--iris-1200)" }}>{(o.name || "N").slice(0, 1).toUpperCase()}</span><b style={{ fontWeight: 500 }}>{o.name}</b></span> },
      { label: "Plan", cell: o => <Badge kind="info">{o.plan}</Badge> },
      { label: "Members", cls: "mono", cell: o => o.members },
      { label: "Region", cls: "mono c-muted", cell: o => o.region },
    ],
    head: (o, c) => ({ icon: (o.name || "N").slice(0, 1).toUpperCase(), tone: "var(--iris-400)", color: "var(--iris-1200)", title: c.isNew ? "New organization" : o.name, sub: c.isNew ? "Spin up an org" : `${o.plan} plan` }),
    newTemplate: { id: "__new__", name: "", plan: "Pro", members: 0, region: "us-east-1", created: "—" },
    form: (o, c) => <>
      <SectionLabel>Details</SectionLabel>
      <KV k="Name"><input className="input" defaultValue={o.name} placeholder="org-name" /></KV>
      <KV k="Plan"><select className="input" defaultValue={o.plan}><option>Enterprise</option><option>Pro</option><option>Free</option></select></KV>
      <KV k="Region"><select className="input" defaultValue={o.region}><option>us-east-1</option><option>eu-west-1</option><option>ap-south-1</option></select></KV>
    </>,
  },
  quota: {
    label: "Quota", group: "Authentication", icon: "metrics", noun: "quota rule", rows: IAM_QUOTA, deletable: false,
    columns: [
      { label: "Resource", cell: q => <b style={{ fontWeight: 500 }}>{q.name}</b> },
      { label: "Usage", cell: q => bar(q.pct) },
      { label: "Limit", cls: "mono c-muted", cell: q => `${q.cap} ${q.unit}` },
    ],
    head: (q, c) => ({ icon: Ic("metrics", { size: 18 }), title: c.isNew ? "New quota rule" : q.name, sub: c.isNew ? "Set a resource limit" : `${q.used} of ${q.cap} ${q.unit} used` }),
    newTemplate: { id: "__new__", name: "", used: 0, cap: 100, unit: "units", pct: 0 },
    form: (q, c) => <>
      {!c.isNew && <div style={{ padding: 18 }}><div style={{ height: 12, borderRadius: 99, background: "var(--g-150)", overflow: "hidden" }}><div style={{ height: "100%", width: q.pct + "%", borderRadius: 99, background: q.pct > 80 ? "var(--warn)" : "var(--iris-1000)" }} /></div></div>}
      {c.isNew && <KV k="Resource"><input className="input" placeholder="e.g. Ingestion volume" /></KV>}
      <KV k="Soft limit"><input className="input" style={{ maxWidth: 160 }} defaultValue={c.isNew ? "" : Math.round(q.cap * 0.8)} /></KV>
      <KV k="Hard limit"><input className="input" style={{ maxWidth: 160 }} defaultValue={c.isNew ? "" : q.cap} /></KV>
      <KV k="On breach"><select className="input"><option>Throttle</option><option>Alert only</option><option>Reject</option></select></KV>
    </>,
  },
  invitations: {
    label: "Invitations", group: "Authentication", icon: "link", noun: "invitation", wide: true, rows: IAM_INVITES,
    columns: [
      { label: "Email", cls: "mono", cell: i => i.name },
      { label: "Role", cell: i => <Badge kind="neutral">{i.role}</Badge> },
      { label: "Sent", cls: "c-muted", cell: i => i.sent },
      { label: "Status", cell: i => <Badge kind={i.status === "pending" ? "warn" : "neutral"} dot>{i.status}</Badge> },
    ],
    head: (i, c) => ({ icon: Ic("link", { size: 18 }), tone: "var(--g-150)", color: "var(--text)", title: c.isNew ? "New invitation" : i.name, sub: c.isNew ? "Invite by email" : `Invited as ${i.role}` }),
    newTemplate: { id: "__new__", name: "", role: "viewer", sent: "—", status: "pending" },
    form: (i, c) => <>
      <KV k="Email"><input className="input mono" defaultValue={i.name} placeholder="name@company.com" /></KV>
      <KV k="Role"><select className="input" defaultValue={i.role}><option>admin</option><option>editor</option><option>viewer</option></select></KV>
    </>,
  },
};

function IamPage() {
  return <AdminModule moduleTitle="IAM" moduleIcon="iam" railGroups={IAM_RAIL} sections={IAM_SECTIONS} defaultId="users" />;
}
window.IamPage = IamPage;
