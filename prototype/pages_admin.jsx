// pages_admin.jsx — shared admin shell: grouped rail + full-width table + drawer detail.
// Used identically by IAM and Settings so they behave the same.
const { useState: uAd } = React;
const cap = s => (s || "").charAt(0).toUpperCase() + (s || "").slice(1);

function AdminModule({ moduleTitle, moduleIcon, railGroups, sections, defaultId }) {
  const [active, setActive] = uAd(defaultId);
  const [railQ, setRailQ] = uAd("");
  const [tableQ, setTableQ] = uAd("");
  const [openId, setOpenId] = uAd(null);
  const [creating, setCreating] = uAd(false);
  const [confirm, setConfirm] = uAd(null);

  const cfg = sections[active];
  const close = () => { setOpenId(null); setCreating(false); };
  const goSection = id => { setActive(id); close(); setTableQ(""); };
  const isForm = cfg.kind === "form";
  const drawerOpen = !isForm && (creating || openId != null);
  const item = creating ? cfg.newTemplate : (openId != null && cfg.rows ? cfg.rows.find(r => r.id === openId) : null);
  const head = (!isForm && (item || creating)) ? cfg.head(item || cfg.newTemplate, { isNew: creating }) : {};

  return (
    <div className="panel fade-in" style={{ flexDirection: "row" }}>
      <span className="annot-badge">{moduleTitle} & IAM share ONE pattern: grouped rail → full-width table → drawer detail (no second sidebar)</span>
      <GroupedRail title={moduleTitle} groups={railGroups} active={active} onPick={goSection} search={railQ} setSearch={setRailQ} />
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
        <PageHeader icon={cfg.icon || moduleIcon} title={cfg.label} subtitle={cfg.group + " · " + moduleTitle}
          actions={isForm
            ? <><Btn onClick={() => toast("Changes discarded", "info")}>Cancel</Btn><Btn variant="primary" icon="check" onClick={() => toast("Settings saved")}>Save changes</Btn></>
            : <Btn variant="primary" icon="plus" onClick={() => { setCreating(true); setOpenId(null); }}>New {cfg.noun}</Btn>}
          row2={<Breadcrumb items={[{ label: moduleTitle, onClick: () => goSection(defaultId) }, { label: cfg.group }, { label: cfg.label }]} />} />

        {isForm
          ? <div className="detail-pane">{cfg.form()}</div>
          : <>
            <SectionToolbar search={tableQ} setSearch={setTableQ} placeholder={`Search ${cfg.label.toLowerCase()}`} annot="filter bar (search only)" />
            <AdminTable columns={cfg.columns} rows={cfg.rows} noun={cfg.noun} search={tableQ}
              onOpen={r => { setOpenId(r.id); setCreating(false); }}
              onDelete={cfg.deletable === false ? null : r => setConfirm(r)}
              onNew={() => setCreating(true)} />
          </>}
      </div>

      {drawerOpen && (
        <Drawer wide={cfg.wide} icon={head.icon} tone={head.tone} color={head.color}
          title={head.title} sub={head.sub} onClose={close}
          actions={<>
            {!creating && cfg.deletable !== false && <Btn variant="danger" icon="trash" onClick={() => setConfirm(item)}>Delete</Btn>}
            <span style={{ flex: 1 }} />
            <Btn onClick={close}>Cancel</Btn>
            <Btn variant="primary" icon="check" onClick={() => { close(); toast(creating ? `${cap(cfg.noun)} created` : "Saved"); }}>{creating ? `Create ${cfg.noun}` : "Save"}</Btn>
          </>}>
          <div className="drawer-body">{cfg.form(item || cfg.newTemplate, { isNew: creating })}</div>
        </Drawer>
      )}

      {confirm && <ConfirmDialog title={`Delete “${cfg.head(confirm, {}).title}”?`}
        message="This permanently removes the record. This action cannot be undone."
        confirmLabel="Delete" onConfirm={() => { setConfirm(null); close(); toast("Deleted", "danger"); }} onClose={() => setConfirm(null)} />}
    </div>
  );
}

window.AdminModule = AdminModule;
window.cap = cap;
