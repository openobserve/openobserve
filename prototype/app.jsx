// app.jsx — router + tweaks
const { useState: uSe } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "typeface": "plex",
  "chrome": "framed",
  "header": "titled",
  "surface": "combined",
  "density": "compact",
  "uiState": "ready",
  "annotations": false,
  "railLabels": true,
  "accent": "#575FC5"
}/*EDITMODE-END*/;

const PAGES = {
  home: HomePage, dashboards: DashboardsPage, logs: LogsPage, traces: TracesPage,
  settings: SettingsPage, iam: IamPage, datasources: IngestionPage, alerts: AlertsPage,
  pipelines: PipelinesPage, metrics: MetricsPage,
};
// modules without a dedicated page → graceful placeholder reusing the chrome
function PlaceholderPage({ id }) {
  const m = MODULES.find(x => x.id === id) || { label: id, icon: "box" };
  return (
    <div className="panel fade-in">
      <PageHeader icon={m.icon} title={m.label} subtitle="Module"
        row2={<span className="ph-tagline">Same chrome, same one-header law — this module follows the matching pattern from the system</span>} />
      <Empty icon={m.icon} title={m.label + " follows the system"}>
        Flat modules (Metrics, Streams, Reports, Incidents) use a single header with a tagline or breadcrumb.
        Few-section modules (RUM, Pipelines) use A1 tabs. The five built-out pages show every rule in action.
      </Empty>
    </div>
  );
}

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [route, setRoute] = uSe("dashboards");
  const [org, setOrg] = uSe("default");
  const Page = PAGES[route] || (() => <PlaceholderPage id={route} />);

  React.useEffect(() => {
    document.documentElement.style.setProperty("--primary", t.accent);
    document.documentElement.style.setProperty("--primary-hover", t.accent);
  }, [t.accent]);

  return (
    <window.HeaderCtx.Provider value={t.header}>
    <window.StateCtx.Provider value={t.uiState}>
    <div className={"app" + (t.annotations ? " annot-on" : "")} data-density={t.density} data-typeface={t.typeface} data-surface={t.surface} data-chrome={t.chrome} data-header={t.header}
      style={{ "--rail-w": t.railLabels ? "74px" : "56px" }}>
      <TopBar org={org} onPickOrg={setOrg} theme="light" onNav={setRoute} route={route} />
      <div className="app-body">
        <IconRail active={route} onNav={setRoute} compact={!t.railLabels} />
        <main className="content">
          <Page id={route} />
        </main>
      </div>

      <TweaksPanel>
        <TweakSection label="Preview state" />
        <TweakRadio label="Data state" value={t.uiState} options={["ready", "loading", "empty"]} onChange={v => setTweak("uiState", v)} />
        <div style={{ fontSize: 11, color: "var(--text-3)", padding: "0 2px 8px", lineHeight: 1.4 }}>
          Preview every list in <b>Loading</b> (shimmer skeletons) or <b>Empty</b> (first-run empty states). Affects Dashboards, Logs, Traces, Metrics, IAM & Settings tables.
        </div>
        <TweakSection label="Typography" />
        <TweakRadio label="Typeface" value={t.typeface} options={["plex", "hanken", "nunito"]} onChange={v => setTweak("typeface", v)} />
        <div style={{ fontSize: 11, color: "var(--text-3)", padding: "0 2px 8px", lineHeight: 1.4 }}>
          <b>Plex</b> = IBM Plex Sans (recommended, built for data UIs) · <b>Hanken</b> = modern neutral grotesque · <b>Nunito</b> = your current brand. Data/IDs always use a matched mono.
        </div>
        <TweakSection label="Header style" />
        <TweakRadio label="Header" value={t.header} options={["compact", "titled"]} onChange={v => setTweak("header", v)} />
        <div style={{ fontSize: 11, color: "var(--text-3)", padding: "0 2px 8px", lineHeight: 1.4 }}>
          <b>Compact</b> (recommended) = breadcrumb becomes the title on drill pages, no icon tile or subtitle — ~46px. <b>Titled</b> = the bigger two-row header with tile + subtitle.
        </div>
        <TweakSection label="Chrome style" />
        <TweakRadio label="Frame" value={t.chrome} options={["flush", "framed"]} onChange={v => setTweak("chrome", v)} />
        <div style={{ fontSize: 11, color: "var(--text-3)", padding: "0 2px 8px", lineHeight: 1.4 }}>
          <b>Flush</b> = all-white, regions split by hairlines. <b>Framed</b> = top bar + rail merge into one tinted L-frame with the content nested as a white card (the single-unit look).
        </div>
        <TweakSection label="Surface style (Logs sections)" />
        <TweakRadio label="Sections" value={t.surface} options={["combined", "dividers", "cards"]} onChange={v => setTweak("surface", v)} />
        <div style={{ fontSize: 11, color: "var(--text-3)", padding: "0 2px 8px", lineHeight: 1.4 }}>
          Settle the customer debate with one token. Visit <b>Logs</b> and switch: <b>Combined</b> (hairline dividers, default) · <b>Dividers</b> (tinted gaps) · <b>Cards</b> (shadowed tray).
        </div>
        <TweakSection label="Navigation system" />
        <TweakToggle label="Show annotations" value={t.annotations} onChange={v => setTweak("annotations", v)} />
        <div style={{ fontSize: 11, color: "var(--text-3)", padding: "0 2px 8px", lineHeight: 1.4 }}>
          Labels every chrome rule: L1 rail, the one-header law, A1 tabs, A2 rails, A4 drill, A6 master-detail, breadcrumb vs back-pill, and the full-bleed canvas drill.
        </div>
        <TweakToggle label="Rail labels" value={t.railLabels} onChange={v => setTweak("railLabels", v)} />
        <TweakSection label="Density" />
        <TweakRadio label="Row density" value={t.density} options={["compact", "comfortable"]} onChange={v => setTweak("density", v)} />
        <TweakSection label="Brand" />
        <TweakColor label="Accent" value={t.accent} options={["#575FC5", "#6069D3", "#2A6FDB", "#1F8A5B", "#7A5AE0"]} onChange={v => setTweak("accent", v)} />
        <TweakSection label="Jump to page" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          {["dashboards", "logs", "traces", "pipelines", "alerts", "settings", "iam", "datasources"].map(r => (
            <button key={r} className={"btn sm" + (route === r ? " primary" : "")} onClick={() => setRoute(r)} style={{ justifyContent: "flex-start", textTransform: "capitalize" }}>
              {r === "datasources" ? "Ingestion" : r}
            </button>
          ))}
        </div>
      </TweaksPanel>
    </div>
    </window.StateCtx.Provider>
    </window.HeaderCtx.Provider>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
