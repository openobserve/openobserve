// chrome.jsx — shell chrome + shared primitives
const { useState, useRef, useEffect } = React;
const Ic = (name, props) => { const C = window.Icon[name]; return C ? React.createElement(C, props) : null; };
const HeaderCtx = React.createContext("titled");
window.HeaderCtx = HeaderCtx;
const StateCtx = React.createContext("ready");   // ready | loading | empty
window.StateCtx = StateCtx;

/* transient toast — gives any button instant feedback */
function toast(msg, kind = "ok") {
  const el = document.createElement("div");
  el.className = "toast " + kind;
  el.innerHTML = '<span class="t-dot"></span>' + msg;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => { el.classList.remove("show"); setTimeout(() => el.remove(), 260); }, 2100);
}
window.toast = toast;

/* ---------- TOP BAR (global context only — never a breadcrumb) ---------- */
function TopBar({ org, onPickOrg, theme, onNav, route }) {
  const [open, setOpen] = useState(false);
  const orgs = ["default", "acme-prod", "staging", "platform-team"];
  return (
    <header className="topbar" data-screen-label="Top bar">
      <div className="tb-brand">
        <div className="tb-logo">{Ic("metrics", { size: 16, sw: 2 })}</div>
        <div className="tb-word">open<b>observe</b></div>
      </div>
      <div className="tb-orgwrap" style={{ position: "relative" }}>
        <button className="tb-org" onClick={() => setOpen(v => !v)}>
          <span className="tb-orgdot">{org.slice(0, 1).toUpperCase()}</span>
          {org}
          {Ic("chevDown", { size: 14, className: "chev" })}
        </button>
        {open && <>
          <div className="scrim" onClick={() => setOpen(false)} />
          <div className="pop fade-in" style={{ top: 38, left: 0 }}>
            <div style={{ padding: "4px 9px 7px", fontSize: 11.5, fontWeight: 600, letterSpacing: 0, color: "var(--text-3)" }}>Switch organization</div>
            {orgs.map(o => (
              <button key={o} className={"pop-item" + (o === org ? " active" : "")} onClick={() => { onPickOrg(o); setOpen(false); }}>
                <span className="tb-orgdot">{o.slice(0, 1).toUpperCase()}</span>{o}
                {o === org && <span style={{ marginLeft: "auto" }}>{Ic("check", { size: 16 })}</span>}
              </button>
            ))}
          </div>
        </>}
      </div>
      <div className="tb-spacer" />
      <div className="tb-edition">{Ic("shield", { size: 13 })} Enterprise</div>
      <div className="tb-divider" />
      <div className="tb-icons">
        <button className="tb-ico ai" title="AI assistant">{Ic("spark", { size: 18 })}</button>
        <button className="tb-ico" title="Notifications">{Ic("bell", { size: 17 })}</button>
        <button className="tb-ico" title="Theme">{Ic(theme === "dark" ? "sun" : "sun", { size: 17 })}</button>
        <button className="tb-ico" title="Docs">{Ic("help", { size: 17 })}</button>
        <button className={"tb-ico" + (route === "settings" ? " ai" : "")} title="Settings" onClick={() => onNav && onNav("settings")}>{Ic("settings", { size: 17 })}</button>
        <button className="tb-user" title="Account">PT</button>
      </div>
    </header>
  );
}

/* ---------- ICON RAIL (L1 primary nav) ---------- */
function IconRail({ active, onNav, compact }) {
  return (
    <nav className="rail" data-screen-label="L1 rail" data-annot="L1 · primary rail">
      {MODULES.map(m => (
        <button key={m.id} className={"rail-item" + (active === m.id ? " active" : "")} onClick={() => onNav(m.id)} title={m.label}>
          <span className="ri-ico">{Ic(m.icon, { size: 21 })}</span>
          {!compact && <span className="ri-label">{m.label}</span>}
        </button>
      ))}
    </nav>
  );
}

/* ---------- PAGE HEADER — the ONE-header law ----------
   row1 = tile + title + actions
   row2 = EXACTLY ONE of: tabs | breadcrumb | tagline | backpill (or nothing)  */
/* ---------- PAGE HEADER — the ONE-header law ----------
   TITLED:  row1 = tile + title + actions · row2 = ONE of {tabs | breadcrumb | tagline}
   COMPACT: when drilled, the breadcrumb IS the title (one line + actions); else slim title row  */
function PageHeader({ icon, title, subtitle, actions, row2 }) {
  const mode = React.useContext(HeaderCtx);
  const isCrumb = row2 && row2.type === Breadcrumb;
  const isTabs = row2 && row2.type === Tabs;

  if (mode === "compact") {
    if (isCrumb) {
      return (
        <div className="pagehead compact" data-annot="Compact — breadcrumb IS the title (one line)">
          <div className="ph-bar">
            <div className="ph-crumbline">{row2}</div>
            <span className="ph-spacer" />
            {actions && <div className="ph-actions">{actions}</div>}
          </div>
        </div>
      );
    }
    return (
      <div className="pagehead compact" data-annot="Compact — slim title row">
        <div className="ph-bar">
          <span className="ph-title">{title}</span>
          <span className="ph-spacer" />
          {actions && <div className="ph-actions">{actions}</div>}
        </div>
        {isTabs && <div className="ph-row2" data-annot="A1 · tabs">{row2}</div>}
      </div>
    );
  }

  return (
    <div className="pagehead" data-annot="One header — row1 + row2">
      <div className="ph-row1">
        <div className="ph-tile">{Ic(icon, { size: 21 })}</div>
        <div className="ph-titles">
          <div className="ph-title">{title}</div>
          {subtitle && <div className="ph-sub">{subtitle}</div>}
        </div>
        {actions && <div className="ph-actions">{actions}</div>}
      </div>
      <div className={"ph-row2" + (row2 ? "" : " empty")} data-annot={row2 ? "row2 · ONE of tabs|crumb|tagline" : null}>
        {row2}
      </div>
    </div>
  );
}

/* ---------- BREADCRUMB (L3+ only; middle collapses past 3) ---------- */
function Breadcrumb({ items }) {
  // items: [{label, onClick?}] — last is terminal
  let display = items;
  let collapsed = null;
  if (items.length > 4) {
    collapsed = items.slice(1, items.length - 2);
    display = [items[0], { collapse: true }, items[items.length - 2], items[items.length - 1]];
  }
  return (
    <nav className="crumbs">
      {display.map((it, i) => {
        const sep = i > 0 && <span className="crumb-sep">{Ic("chevRight", { size: 13 })}</span>;
        if (it.collapse) return <React.Fragment key="c">{sep}<CollapseMenu items={collapsed} /></React.Fragment>;
        const term = i === display.length - 1;
        return (
          <React.Fragment key={i}>
            {sep}
            {term
              ? <span className="crumb term" title={it.label}>{it.label}</span>
              : <button className="crumb" onClick={it.onClick}>{it.label}</button>}
          </React.Fragment>
        );
      })}
    </nav>
  );
}
function CollapseMenu({ items }) {
  const [open, setOpen] = useState(false);
  return (
    <span style={{ position: "relative" }}>
      <button className="crumb-collapse" onClick={() => setOpen(v => !v)}>…</button>
      {open && <>
        <div className="scrim" onClick={() => setOpen(false)} />
        <div className="pop fade-in" style={{ top: 28, left: 0, minWidth: 180 }}>
          {items.map((it, i) => (
            <button key={i} className="pop-item" onClick={() => { it.onClick && it.onClick(); setOpen(false); }}>{it.label}</button>
          ))}
        </div>
      </>}
    </span>
  );
}

/* ---------- TABS (A1) ---------- */
function Tabs({ items, active, onPick }) {
  return (
    <div className="tabs" data-annot="A1 · section tabs">
      {items.map(t => (
        <button key={t.id} className={"tab" + (active === t.id ? " active" : "")} onClick={() => onPick(t.id)}>
          {t.icon && Ic(t.icon, { size: 16 })}{t.label}
          {t.count != null && <span className="tcount">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/* ---------- SECTION TOOLBAR — tab-scoped actions attached to CONTENT (not the header) ---------- */
function SectionToolbar({ search, setSearch, placeholder, count, actions, annot }) {
  return (
    <div className="sectionbar" data-annot={annot || "section toolbar — scoped to active tab"}>
      {setSearch !== undefined && <Field className="grow" placeholder={placeholder} value={search} onChange={setSearch} />}
      {count != null && <span className="sb-count">{count}</span>}
      <span className="sb-spacer" />
      {actions}
    </div>
  );
}

/* ---------- BACK PILL (overlays / single reversible step) ---------- */
const BackPill = ({ label, onClick }) => (
  <button className="backpill" onClick={onClick} data-annot="back-pill (overlay)">{Ic("arrowLeft", { size: 15 })}{label}</button>
);

/* ---------- small shared bits ---------- */
const Field = ({ icon = "search", placeholder, value, onChange, className = "", large }) => (
  <div className={"field " + className + (large ? " search-lg" : "")}>
    {Ic(icon, { size: large ? 18 : 16 })}
    <input placeholder={placeholder} value={value || ""} onChange={e => onChange && onChange(e.target.value)} />
  </div>
);
const Btn = ({ children, icon, variant = "", sm, onClick, title }) => (
  <button className={"btn " + variant + (sm ? " sm" : "")} onClick={onClick} title={title}>
    {icon && Ic(icon, { size: sm ? 15 : 16 })}{children}
  </button>
);
const Badge = ({ kind = "neutral", dot, children }) => (
  <span className={"badge " + kind}>{dot && <span className={"dot " + kind} />}{children}</span>
);
const Toggle = ({ on, onClick }) => <button className={"toggle" + (on ? " on" : "")} onClick={onClick} />;
const Cbx = ({ on, onClick }) => <button className={"cbx" + (on ? " on" : "")} onClick={onClick}>{on && Ic("check", { size: 12, sw: 3 })}</button>;

function Empty({ icon = "search", title, children, action, hint }) {
  return <div className="empty"><div className="empty-inner">
    <div className="empty-ico">{Ic(icon, { size: 26 })}</div>
    <h3>{title}</h3>{children && <p>{children}</p>}
    {action && <div className="empty-act"><Btn variant="primary" icon={action.icon || "plus"} onClick={action.onClick}>{action.label}</Btn></div>}
    {hint && <div className="empty-hint">{Ic("spark", { size: 13 })}{hint}</div>}
  </div></div>;
}

/* ---------- SKELETON ---------- */
const Skeleton = ({ w = "100%", h = 12, r = 6, style }) =>
  <span className="skel" style={{ width: w, height: h, borderRadius: r, ...style }} />;
function SkeletonTable({ cols = 5, rows = 9 }) {
  return <div className="tbl-wrap" aria-busy="true">{Array.from({ length: rows }).map((_, i) => (
    <div key={i} className="skel-row">
      {Array.from({ length: cols }).map((_, c) => (
        <Skeleton key={c} w={c === 0 ? 22 : c === 1 ? `${38 + (i * 7 % 30)}%` : `${18 + (c * 5 % 22)}%`} h={c === 0 ? 16 : 11} r={c === 0 ? 5 : 6} style={{ flex: c === 1 ? 1 : "none" }} />
      ))}
    </div>
  ))}</div>;
}
function SkeletonCards({ n = 8 }) {
  return <div className="cardgrid" aria-busy="true">{Array.from({ length: n }).map((_, i) => (
    <div key={i} className="skel-card"><Skeleton w={40} h={40} r={10} /><Skeleton w="70%" h={12} /><Skeleton w="90%" h={9} /></div>
  ))}</div>;
}
function SkeletonList({ rows = 14 }) {
  return <div aria-busy="true">{Array.from({ length: rows }).map((_, i) => (
    <div key={i} className="skel-row" style={{ height: 30 }}><Skeleton w={150} h={10} /><Skeleton w={50} h={10} /><Skeleton w={`${30 + (i * 11 % 50)}%`} h={10} /></div>
  ))}</div>;
}

/* ---------- ADMIN TABLE (full-width records; honors UI state) ---------- */
function AdminTable({ columns, rows, onOpen, onDelete, noun = "record", onNew, search }) {
  const ui = React.useContext(StateCtx);
  const data = search ? rows.filter(r => JSON.stringify(r).toLowerCase().includes(search.toLowerCase())) : rows;
  if (ui === "loading") return <SkeletonTable cols={columns.length + 1} />;
  if (ui === "empty" || !data.length) return (
    <Empty icon="box" title={`No ${noun}s ${ui === "empty" ? "yet" : "match"}`}
      action={onNew && ui === "empty" ? { label: `New ${noun}`, onClick: onNew } : null}>
      {ui === "empty" ? `Create your first ${noun} to get started.` : "Try a different search term."}
    </Empty>
  );
  return (
    <div className="tbl-wrap">
      <table className="tbl"><thead><tr>
        {columns.map((c, i) => <th key={i} style={{ width: c.w, textAlign: c.align }}>{c.label}</th>)}
        <th style={{ textAlign: "right", width: 90 }}>Actions</th>
      </tr></thead><tbody>
        {data.map(r => (
          <tr key={r.id} style={{ cursor: "pointer" }} onClick={() => onOpen(r)}>
            {columns.map((c, i) => <td key={i} style={{ textAlign: c.align }} className={c.cls}>{c.cell(r)}</td>)}
            <td onClick={e => e.stopPropagation()}><div className="row-act">
              <button className="iconbtn" title="Edit" onClick={() => onOpen(r)}>{Ic("edit", { size: 16 })}</button>
              {onDelete && <button className="iconbtn danger" title="Delete" onClick={() => onDelete(r)}>{Ic("trash", { size: 16 })}</button>}
            </div></td>
          </tr>
        ))}
      </tbody></table>
    </div>
  );
}

/* ---------- MASTER-DETAIL (admin record editing, with built-in CREATE mode) ----------
   Create flow: page's top-right "+ New" sets `creating` → detail pane becomes a blank form,
   a temporary highlighted item appears atop the master list, side-nav + list stay put. */
function MasterDetail({ items, selId, onSelect, renderItem, renderDetail, searchKey = "name", placeholder = "Search", wide, masterFooter,
  creating, newTemplate, newLabel = "item", createIcon = "plus", onCancelCreate, onSaveCreate }) {
  const [q, setQ] = React.useState("");
  const filtered = q ? items.filter(i => (i[searchKey] || "").toLowerCase().includes(q.toLowerCase())) : items;
  const sel = items.find(i => i.id === selId) || items[0];
  const ctx = { isNew: true, onCancel: onCancelCreate, onSave: onSaveCreate, newLabel };
  return (
    <div className="md" data-annot="A6 master-detail">
      <div className={"md-master" + (wide ? " wide" : "")} data-annot="master list">
        <div className="md-mhead">
          <Field className="mh-search grow" placeholder={placeholder} value={q} onChange={setQ} />
        </div>
        <div className="md-list">
          {creating && (
            <button className="md-item active" data-annot="temp create item" style={{ outline: "1px dashed var(--iris-900)" }}>
              <span className="md-iavatar" style={{ background: "var(--iris-300)", color: "var(--iris-1100)" }}>{Ic(createIcon, { size: 15 })}</span>
              <div className="md-ibody"><div className="mi-title">New {newLabel}</div><div className="mi-sub">Unsaved · fill in the form →</div></div>
            </button>
          )}
          {filtered.map(it => (
            <button key={it.id} className={"md-item" + (!creating && sel && sel.id === it.id ? " active" : "")} onClick={() => onSelect(it.id)}>
              {renderItem(it)}
            </button>
          ))}
          {!filtered.length && !creating && <div style={{ padding: 20, textAlign: "center", color: "var(--text-3)", fontSize: 12 }}>No matches</div>}
        </div>
        {masterFooter}
      </div>
      <div className="md-detail" data-annot="detail editor">
        {creating ? renderDetail(newTemplate, ctx) : (sel ? renderDetail(sel, {}) : <Empty title="Nothing selected" />)}
      </div>
    </div>
  );
}
/* returns create-mode actions (Cancel + Create) when ctx.isNew, else the normal actions */
const detailActions = (ctx, normal, createLabel) =>
  (ctx && ctx.isNew)
    ? <><Btn onClick={ctx.onCancel}>Cancel</Btn><Btn variant="primary" icon="check" onClick={ctx.onSave}>{createLabel || `Create ${ctx.newLabel || ""}`.trim()}</Btn></>
    : normal;
const detailTitle = (ctx, name, label) => (ctx && ctx.isNew) ? `New ${label}` : name;
/* detail header + field primitives */
const DetailHead = ({ avatar, tone = "var(--iris-300)", color = "var(--iris-1100)", title, sub, actions }) => (
  <div className="md-dhead">
    {avatar !== undefined && <div className="md-dtile" style={{ background: tone, color }}>{avatar}</div>}
    <div style={{ flex: 1, minWidth: 0 }}>
      <div className="md-dtitle">{title}</div>
      {sub && <div className="md-dsub">{sub}</div>}
    </div>
    {actions && <div style={{ display: "flex", gap: 8 }}>{actions}</div>}
  </div>
);
const KV = ({ k, children }) => (<div className="kv"><div className="kv-k">{k}</div><div className="kv-v">{children}</div></div>);
const SectionLabel = ({ children }) => <div className="md-section-label">{children}</div>;
const miAvatar = (text, huev) => <span className="md-iavatar" style={{ background: `hsl(${huev} 60% 93%)`, color: `hsl(${huev} 55% 38%)` }}>{text}</span>;

Object.assign(window, { MasterDetail, DetailHead, KV, SectionLabel, miAvatar, detailActions, detailTitle });

/* ---------- MODAL / DIALOG (decision · needs focus) ---------- */
function Modal({ title, sub, icon = "edit", tone = "brand", wide, onClose, children, footer }) {
  React.useEffect(() => {
    const h = e => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className={"modal" + (wide ? " wide" : "")} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="modal-head">
          <div className={"mh-ico " + tone}>{Ic(icon, { size: 20 })}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="modal-title">{title}</div>
            {sub && <div className="modal-sub">{sub}</div>}
          </div>
          <button className="modal-x" onClick={onClose}>{Ic("plus", { size: 18, style: { transform: "rotate(45deg)" } })}</button>
        </div>
        {children && <div className="modal-body">{children}</div>}
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
function ConfirmDialog({ title, message, confirmLabel = "Delete", danger = true, onConfirm, onClose }) {
  return (
    <Modal title={title} sub={message} icon={danger ? "trash" : "help"} tone={danger ? "danger" : "brand"} onClose={onClose}
      footer={<><Btn onClick={onClose}>Cancel</Btn><Btn variant={danger ? "danger" : "primary"} icon={danger ? "trash" : "check"} onClick={onConfirm}>{confirmLabel}</Btn></>} />
  );
}

/* ---------- DRAWER (contextual detail beside a list) ---------- */
function Drawer({ title, sub, icon, tone = "var(--iris-300)", color = "var(--iris-1100)", onClose, children, actions, wide }) {
  React.useEffect(() => {
    const h = e => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return <>
    <div className="drawer-scrim" onClick={onClose} />
    <aside className={"drawer" + (wide ? " wide" : "")} role="dialog">
      <div className="drawer-head">
        {icon !== undefined && <span className="md-dtile" style={{ width: 36, height: 36, background: tone, color, fontSize: 14 }}>{icon}</span>}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</div>
          {sub && <div style={{ fontSize: 12, color: "var(--text-3)" }}>{sub}</div>}
        </div>
        <button className="modal-x" onClick={onClose}>{Ic("plus", { size: 18, style: { transform: "rotate(45deg)" } })}</button>
      </div>
      <div className="detail-pane">{children}</div>
      {actions && <div className="drawer-foot">{actions}</div>}
    </aside>
  </>;
}

/* ---------- POPOVER (transient · anchored · no decision) ---------- */
function Popover({ children, items, onClose, style }) {
  return <>
    <div className="scrim" onClick={onClose} />
    <div className="pop fade-in" style={style}>
      {items ? items.map((it, i) => (
        it.sep ? <div key={i} style={{ height: 1, background: "var(--border-soft)", margin: "5px 4px" }} /> :
        <button key={i} className={"pop-item" + (it.danger ? " danger" : "")} style={it.danger ? { color: "var(--danger)" } : {}}
          onClick={() => { it.onClick && it.onClick(); onClose(); }}>
          {it.icon && Ic(it.icon, { size: 16 })}{it.label}
        </button>
      )) : children}
    </div>
  </>;
}

Object.assign(window, { TopBar, IconRail, PageHeader, Breadcrumb, Tabs, SectionToolbar, BackPill, Field, Btn, Badge, Toggle, Cbx, Empty, Skeleton, SkeletonTable, SkeletonCards, SkeletonList, AdminTable, Modal, ConfirmDialog, Drawer, Popover, Ic, StateCtx });
