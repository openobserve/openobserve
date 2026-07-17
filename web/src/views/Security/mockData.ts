// Copyright 2026 OpenObserve Inc.
// Mock data for Security (SIEM) mode. Representative content so the whole SOC
// experience can be demoed end to end. Replace with real APIs when wiring up.

export const KPIS = [
  { label: "Open critical alerts", val: "7", delta: "▲ 3 vs prev 24h", trend: "up", color: "#e5484d" },
  { label: "Active detections", val: "312", delta: "of 1,240 rules enabled", trend: "flat", color: "#6d5ce0" },
  { label: "Cases in progress", val: "6", delta: "▼ 2 closed today", trend: "down", color: "#f5a524" },
  { label: "Events / sec", val: "48.2k", delta: "1.9 TB ingested today", trend: "flat", color: "#4593e8" },
  { label: "ATT&CK coverage", val: "63%", delta: "▲ 4% this week", trend: "down", color: "#30a46c" },
];

export const DETECTIONS = [
  { id: "rule-1042", name: "Impossible travel: sign-in from 2 countries", tech: "T1078", tactic: "Initial Access", techName: "Valid Accounts", sev: "crit", type: "correlation", enabled: true, source: "okta", fired: "2m", hits: 4, fp: "low" },
  { id: "rule-0087", name: "Credential dumping via LSASS access", tech: "T1003.001", tactic: "Credential Access", techName: "LSASS Memory", sev: "crit", type: "streaming", enabled: true, source: "crowdstrike-edr", fired: "9m", hits: 2, fp: "low" },
  { id: "rule-0311", name: "Suspicious PowerShell — encoded command", tech: "T1059.001", tactic: "Execution", techName: "PowerShell", sev: "high", type: "streaming", enabled: true, source: "sysmon", fired: "14m", hits: 11, fp: "medium" },
  { id: "rule-0455", name: "S3 bucket made public", tech: "T1580", tactic: "Discovery", techName: "Cloud Infrastructure Discovery", sev: "high", type: "scheduled", enabled: true, source: "aws-cloudtrail", fired: "22m", hits: 1, fp: "low" },
  { id: "rule-0122", name: "Brute force succeeded after 40 failures", tech: "T1110", tactic: "Credential Access", techName: "Brute Force", sev: "high", type: "correlation", enabled: true, source: "sshd", fired: "31m", hits: 3, fp: "medium" },
  { id: "rule-0631", name: "New IAM user added to admin group", tech: "T1098", tactic: "Persistence", techName: "Account Manipulation", sev: "med", type: "scheduled", enabled: true, source: "aws-cloudtrail", fired: "48m", hits: 1, fp: "low" },
  { id: "rule-0777", name: "DNS query to known C2 domain", tech: "T1071.004", tactic: "Command and Control", techName: "DNS", sev: "med", type: "streaming", enabled: true, source: "zeek", fired: "1h", hits: 6, fp: "medium" },
  { id: "rule-0902", name: "Scheduled task created for persistence", tech: "T1053.005", tactic: "Persistence", techName: "Scheduled Task", sev: "med", type: "streaming", enabled: true, source: "sysmon", fired: "2h", hits: 2, fp: "high" },
  { id: "rule-1155", name: "Mass file encryption (possible ransomware)", tech: "T1486", tactic: "Impact", techName: "Data Encrypted for Impact", sev: "crit", type: "correlation", enabled: true, source: "edr", fired: "3h", hits: 0, fp: "low" },
  { id: "rule-0044", name: "Disabled Windows Defender", tech: "T1562.001", tactic: "Defense Evasion", techName: "Disable Security Tools", sev: "high", type: "streaming", enabled: false, source: "sysmon", fired: "—", hits: 0, fp: "medium" },
  { id: "rule-0500", name: "Anomalous data egress volume", tech: "T1041", tactic: "Exfiltration", techName: "Exfil Over C2 Channel", sev: "high", type: "scheduled", enabled: true, source: "zeek", fired: "5h", hits: 1, fp: "medium" },
  { id: "rule-0688", name: "OAuth consent grant to unverified app", tech: "T1550.001", tactic: "Lateral Movement", techName: "Application Access Token", sev: "med", type: "scheduled", enabled: true, source: "entra-id", fired: "6h", hits: 2, fp: "medium" },
];

export const ALERTS = [
  { time: "10:42:11", rule: "Impossible travel: sign-in from 2 countries", sev: "crit", entity: "j.torres@acme.com", tech: "T1078", status: "new", assignee: "—", count: 1 },
  { time: "10:35:07", rule: "Credential dumping via LSASS access", sev: "crit", entity: "WIN-DC01", tech: "T1003.001", status: "new", assignee: "—", count: 2 },
  { time: "10:28:44", rule: "Suspicious PowerShell — encoded command", sev: "high", entity: "web-prod-07", tech: "T1059.001", status: "triage", assignee: "a.khan", count: 11 },
  { time: "10:19:03", rule: "S3 bucket made public", sev: "high", entity: "acme-data-lake", tech: "T1580", status: "triage", assignee: "a.khan", count: 1 },
  { time: "10:11:55", rule: "Brute force succeeded after 40 failures", sev: "high", entity: "bastion-01", tech: "T1110", status: "triage", assignee: "m.rossi", count: 3 },
  { time: "09:53:20", rule: "New IAM user added to admin group", sev: "med", entity: "aws:acme-prod", tech: "T1098", status: "open", assignee: "—", count: 1 },
  { time: "09:40:12", rule: "DNS query to known C2 domain", sev: "med", entity: "web-prod-07", tech: "T1071.004", status: "open", assignee: "—", count: 6 },
  { time: "09:22:31", rule: "OAuth consent grant to unverified app", sev: "med", entity: "s.malik@acme.com", tech: "T1550.001", status: "open", assignee: "—", count: 2 },
  { time: "08:58:04", rule: "Anomalous data egress volume", sev: "high", entity: "web-prod-07", tech: "T1041", status: "closed", assignee: "m.rossi", count: 1 },
  { time: "08:31:47", rule: "Scheduled task created for persistence", sev: "med", entity: "WIN-FS02", tech: "T1053.005", status: "closed", assignee: "a.khan", count: 2 },
];

export const CASES = [
  { id: "CASE-2041", title: "Suspected account takeover — j.torres", sev: "crit", status: "inprogress", assignee: "a.khan", alerts: 4, created: "38m ago", updated: "5m ago", tags: ["account-takeover", "okta", "T1078"] },
  { id: "CASE-2039", title: "Possible ransomware staging on WIN-DC01", sev: "crit", status: "inprogress", assignee: "m.rossi", alerts: 6, created: "1h ago", updated: "12m ago", tags: ["ransomware", "edr", "T1486"] },
  { id: "CASE-2038", title: "Public S3 bucket exposure — acme-data-lake", sev: "high", status: "triage", assignee: "a.khan", alerts: 2, created: "2h ago", updated: "40m ago", tags: ["cloud", "aws", "exposure"] },
  { id: "CASE-2035", title: "SSH brute force campaign against bastion", sev: "high", status: "open", assignee: "—", alerts: 3, created: "3h ago", updated: "1h ago", tags: ["brute-force", "ssh"] },
  { id: "CASE-2031", title: "Outbound C2 beaconing from web-prod-07", sev: "high", status: "inprogress", assignee: "m.rossi", alerts: 5, created: "5h ago", updated: "22m ago", tags: ["c2", "zeek", "exfil"] },
  { id: "CASE-2024", title: "Unverified OAuth app consent spike", sev: "med", status: "resolved", assignee: "a.khan", alerts: 2, created: "1d ago", updated: "6h ago", tags: ["oauth", "entra-id"] },
];

export const EVENTS = [
  { time: "10:42:11.204", cls: "Authentication", act: "Logon", sev: "crit", user: "j.torres@acme.com", src: "185.220.101.44", dst: "okta.com", device: "—", product: "okta", msg: "Sign-in success from TOR exit node (RU) 11m after DE sign-in", geo: "RU", mfa: "push", result: "success" },
  { time: "10:41:58.882", cls: "Authentication", act: "Logon", sev: "info", user: "j.torres@acme.com", src: "91.242.13.7", dst: "okta.com", device: "MacBook-Pro", product: "okta", msg: "Sign-in success (DE)", geo: "DE", mfa: "push", result: "success" },
  { time: "10:35:07.410", cls: "Process Activity", act: "Launch", sev: "crit", user: "SYSTEM", src: "WIN-DC01", dst: "—", device: "WIN-DC01", product: "crowdstrike", msg: "procdump.exe accessed lsass.exe memory", geo: "—", mfa: "—", result: "blocked" },
  { time: "10:28:44.019", cls: "Process Activity", act: "Launch", sev: "high", user: "svc_web", src: "web-prod-07", dst: "—", device: "web-prod-07", product: "sysmon", msg: "powershell.exe -enc SQBFAFgA... (base64)", geo: "—", mfa: "—", result: "success" },
  { time: "10:19:03.663", cls: "API Activity", act: "PutBucketAcl", sev: "high", user: "ci-deploy", src: "34.201.9.8", dst: "s3.amazonaws.com", device: "—", product: "aws-cloudtrail", msg: "acme-data-lake ACL set to public-read", geo: "US", mfa: "—", result: "success" },
  { time: "10:11:55.201", cls: "Authentication", act: "Logon", sev: "high", user: "root", src: "45.9.148.99", dst: "bastion-01", device: "bastion-01", product: "sshd", msg: "Accepted password after 40 failures", geo: "CN", mfa: "none", result: "success" },
  { time: "09:53:20.774", cls: "IAM", act: "AddUserToGroup", sev: "med", user: "ci-deploy", src: "34.201.9.8", dst: "iam.amazonaws.com", device: "—", product: "aws-cloudtrail", msg: "user 'temp_admin' added to group 'Administrators'", geo: "US", mfa: "—", result: "success" },
  { time: "09:40:12.556", cls: "Network Activity", act: "DNS Query", sev: "med", user: "—", src: "web-prod-07", dst: "8.8.8.8", device: "web-prod-07", product: "zeek", msg: "query kj3n2x9.bad-c2-domain.ru", geo: "—", mfa: "—", result: "answered" },
  { time: "09:22:31.900", cls: "API Activity", act: "Consent", sev: "med", user: "s.malik@acme.com", src: "20.44.2.1", dst: "login.microsoftonline.com", device: "—", product: "entra-id", msg: "OAuth consent granted to 'DataSyncPro' (unverified)", geo: "US", mfa: "—", result: "success" },
  { time: "08:58:04.113", cls: "Network Activity", act: "Data Transfer", sev: "high", user: "svc_web", src: "web-prod-07", dst: "45.9.148.99", device: "web-prod-07", product: "zeek", msg: "1.8 GB uploaded over TLS to rare destination", geo: "CN", mfa: "—", result: "success" },
];

export const ENTITIES = [
  { name: "WIN-DC01", kind: "host", risk: 96, det: 4, meta: "Windows Server 2022 · Domain Controller", first: "412d", last: "2m", tags: ["crown-jewel", "windows", "critical"], color: "#e5484d" },
  { name: "j.torres@acme.com", kind: "user", risk: 88, det: 3, meta: "Engineering · admin role · Okta", first: "2y", last: "1m", tags: ["privileged", "impossible-travel"], color: "#f76808" },
  { name: "web-prod-07", kind: "host", risk: 71, det: 5, meta: "Ubuntu 22.04 · public web tier", first: "180d", last: "14m", tags: ["internet-facing", "c2"], color: "#f5a524" },
  { name: "bastion-01", kind: "host", risk: 64, det: 2, meta: "Ubuntu 22.04 · SSH jump host", first: "300d", last: "31m", tags: ["internet-facing", "brute-force"], color: "#f5a524" },
  { name: "svc_backup", kind: "user", risk: 54, det: 1, meta: "Service account · backup", first: "1y", last: "3h", tags: ["service-account", "priv-esc"], color: "#4593e8" },
  { name: "s.malik@acme.com", kind: "user", risk: 41, det: 1, meta: "Sales · standard user · Entra ID", first: "9mo", last: "1h", tags: ["oauth"], color: "#4593e8" },
  { name: "45.9.148.99", kind: "ip", risk: 78, det: 3, meta: "External · CN · threat-intel match", first: "6h", last: "8m", tags: ["malicious", "c2", "tor"], color: "#f76808" },
  { name: "acme-data-lake", kind: "asset", risk: 60, det: 2, meta: "AWS S3 bucket · us-east-1", first: "2y", last: "22m", tags: ["cloud", "exposure", "pii"], color: "#f5a524" },
];

export const IOCS = [
  { value: "45.9.148.99", type: "ipv4", threat: "Cobalt Strike C2", feed: "abuse.ch", conf: 95, last: "8m", matches: 3 },
  { value: "kj3n2x9.bad-c2-domain.ru", type: "domain", threat: "C2 / beaconing", feed: "AlienVault OTX", conf: 88, last: "22m", matches: 6 },
  { value: "e99a18c428cb38d5f260853678922e03", type: "md5", threat: "Emotet dropper", feed: "MISP-internal", conf: 90, last: "3h", matches: 1 },
  { value: "185.220.101.44", type: "ipv4", threat: "TOR exit node", feed: "dan.me.uk", conf: 70, last: "12m", matches: 2 },
  { value: "http://update-flash[.]info/x.exe", type: "url", threat: "Malware distribution", feed: "URLhaus", conf: 82, last: "1d", matches: 0 },
  { value: "a94a8fe5ccb19ba61c4c0873d391e987982fbbd3", type: "sha1", threat: "Mimikatz variant", feed: "MISP-internal", conf: 97, last: "9m", matches: 2 },
  { value: "malicious-cdn[.]xyz", type: "domain", threat: "Phishing kit host", feed: "PhishTank", conf: 65, last: "2d", matches: 0 },
];

export const FEEDS = [
  { name: "abuse.ch Feodo Tracker", type: "STIX/TAXII", indicators: 12840, sync: "6m ago", status: "healthy" },
  { name: "AlienVault OTX", type: "OTX API", indicators: 204113, sync: "18m ago", status: "healthy" },
  { name: "MISP (internal)", type: "MISP", indicators: 8422, sync: "1h ago", status: "healthy" },
  { name: "URLhaus", type: "CSV", indicators: 61200, sync: "3h ago", status: "stale" },
  { name: "PhishTank", type: "CSV", indicators: 44190, sync: "5h ago", status: "stale" },
];

export const DATA_SOURCES = [
  { name: "AWS CloudTrail", type: "Cloud audit", eps: "3.2k", last: "just now", status: "healthy", ocsf: true },
  { name: "Okta System Log", type: "IdP", eps: "480", last: "just now", status: "healthy", ocsf: true },
  { name: "Microsoft Entra ID", type: "IdP", eps: "610", last: "12s", status: "healthy", ocsf: true },
  { name: "CrowdStrike Falcon", type: "EDR", eps: "9.1k", last: "just now", status: "healthy", ocsf: true },
  { name: "Sysmon (Windows)", type: "Endpoint", eps: "22.4k", last: "just now", status: "healthy", ocsf: true },
  { name: "Zeek", type: "Network", eps: "11.8k", last: "just now", status: "healthy", ocsf: true },
  { name: "Linux auth (syslog)", type: "Endpoint", eps: "1.4k", last: "3s", status: "healthy", ocsf: true },
  { name: "AWS GuardDuty", type: "Cloud detection", eps: "40", last: "2m", status: "healthy", ocsf: true },
  { name: "Palo Alto NGFW", type: "Firewall", eps: "0", last: "4h", status: "stale", ocsf: false },
];

export const CONTENT_PACKS = [
  { name: "SigmaHQ Core Ruleset", rules: 2140, version: "2026.06", category: "Detections", installed: true, update: true },
  { name: "AWS Threat Detection", rules: 186, version: "1.9.0", category: "Cloud", installed: true, update: false },
  { name: "Windows / Sysmon", rules: 640, version: "3.2.1", category: "Endpoint", installed: true, update: false },
  { name: "Okta & Entra ID", rules: 94, version: "1.4.0", category: "Identity", installed: true, update: true },
  { name: "Kubernetes Runtime", rules: 120, version: "0.8.0", category: "Cloud", installed: false, update: false },
  { name: "MITRE ATT&CK Coverage Pack", rules: 410, version: "2026.05", category: "Detections", installed: true, update: false },
  { name: "PCI-DSS 4.0 Content", rules: 78, version: "1.0.2", category: "Compliance", installed: false, update: false },
  { name: "Ransomware TTPs", rules: 152, version: "2.1.0", category: "Detections", installed: true, update: true },
];

export const COMPLIANCE = [
  { framework: "PCI-DSS 4.0", score: 82, pass: 246, total: 300, failing: 54, color: "#30a46c" },
  { framework: "CIS Benchmarks", score: 74, pass: 592, total: 800, failing: 208, color: "#f5a524" },
  { framework: "NIST 800-53", score: 68, pass: 612, total: 900, failing: 288, color: "#f5a524" },
  { framework: "HIPAA", score: 91, pass: 164, total: 180, failing: 16, color: "#30a46c" },
  { framework: "GDPR", score: 88, pass: 141, total: 160, failing: 19, color: "#30a46c" },
  { framework: "SOC 2", score: 79, pass: 174, total: 220, failing: 46, color: "#f5a524" },
];

// MITRE ATT&CK matrix — a representative slice. `cov` 0..4 = detection strength.
export const MITRE_MATRIX = [
  { tactic: "Initial Access", techniques: [
    { id: "T1566", name: "Phishing", cov: 3, det: 8 },
    { id: "T1078", name: "Valid Accounts", cov: 4, det: 12 },
    { id: "T1190", name: "Exploit Public App", cov: 2, det: 3 },
    { id: "T1133", name: "External Remote Services", cov: 1, det: 1 },
  ]},
  { tactic: "Execution", techniques: [
    { id: "T1059.001", name: "PowerShell", cov: 4, det: 22 },
    { id: "T1059.003", name: "Windows Cmd", cov: 3, det: 9 },
    { id: "T1053", name: "Scheduled Task", cov: 2, det: 4 },
    { id: "T1204", name: "User Execution", cov: 1, det: 2 },
  ]},
  { tactic: "Persistence", techniques: [
    { id: "T1098", name: "Account Manipulation", cov: 3, det: 6 },
    { id: "T1547", name: "Boot/Logon Autostart", cov: 1, det: 1 },
    { id: "T1136", name: "Create Account", cov: 2, det: 3 },
    { id: "T1053.005", name: "Scheduled Task", cov: 2, det: 4 },
  ]},
  { tactic: "Privilege Escalation", techniques: [
    { id: "T1548", name: "Abuse Elevation", cov: 2, det: 5 },
    { id: "T1068", name: "Exploitation for PrivEsc", cov: 3, det: 4 },
    { id: "T1055", name: "Process Injection", cov: 1, det: 1 },
  ]},
  { tactic: "Defense Evasion", techniques: [
    { id: "T1562.001", name: "Disable Security Tools", cov: 3, det: 7 },
    { id: "T1070", name: "Indicator Removal", cov: 2, det: 3 },
    { id: "T1036", name: "Masquerading", cov: 1, det: 2 },
    { id: "T1027", name: "Obfuscated Files", cov: 2, det: 5 },
  ]},
  { tactic: "Credential Access", techniques: [
    { id: "T1003.001", name: "LSASS Memory", cov: 4, det: 10 },
    { id: "T1110", name: "Brute Force", cov: 4, det: 14 },
    { id: "T1552", name: "Unsecured Credentials", cov: 2, det: 3 },
  ]},
  { tactic: "Discovery", techniques: [
    { id: "T1580", name: "Cloud Infra Discovery", cov: 2, det: 4 },
    { id: "T1087", name: "Account Discovery", cov: 1, det: 2 },
    { id: "T1046", name: "Network Service Scan", cov: 3, det: 6 },
  ]},
  { tactic: "Lateral Movement", techniques: [
    { id: "T1021", name: "Remote Services", cov: 2, det: 5 },
    { id: "T1550.001", name: "App Access Token", cov: 2, det: 3 },
    { id: "T1570", name: "Lateral Tool Transfer", cov: 0, det: 0 },
  ]},
  { tactic: "Command and Control", techniques: [
    { id: "T1071.004", name: "DNS", cov: 3, det: 6 },
    { id: "T1071.001", name: "Web Protocols", cov: 2, det: 4 },
    { id: "T1573", name: "Encrypted Channel", cov: 1, det: 1 },
  ]},
  { tactic: "Exfiltration", techniques: [
    { id: "T1041", name: "Exfil Over C2", cov: 2, det: 3 },
    { id: "T1567", name: "Exfil to Cloud", cov: 1, det: 1 },
  ]},
  { tactic: "Impact", techniques: [
    { id: "T1486", name: "Data Encrypted (Ransomware)", cov: 3, det: 4 },
    { id: "T1490", name: "Inhibit System Recovery", cov: 1, det: 1 },
    { id: "T1489", name: "Service Stop", cov: 0, det: 0 },
  ]},
];

// small heatmap for the overview
export const HEAT_TACTICS = [
  { name: "Initial Access", cells: [3, 4, 2, 1] },
  { name: "Execution", cells: [4, 3, 2] },
  { name: "Persistence", cells: [3, 1, 2, 2] },
  { name: "Priv. Esc", cells: [2, 3, 1] },
  { name: "Defense Evasion", cells: [3, 2, 1, 2] },
  { name: "Credential Access", cells: [4, 4, 2] },
];

// ---- UEBA (User & Entity Behavior Analytics) ----
export const UEBA_KPIS = [
  { label: "Entities baselined", val: "4,182", delta: "14-day rolling baseline", trend: "flat", color: "#6d5ce0" },
  { label: "Behavioral anomalies", val: "126", delta: "▲ 22 vs prev 24h", trend: "up", color: "#e5484d" },
  { label: "High-risk users", val: "9", delta: "score ≥ 70", trend: "up", color: "#f76808" },
  { label: "Peer groups", val: "38", delta: "auto-clustered", trend: "flat", color: "#4593e8" },
  { label: "Models trained", val: "312", delta: "RCF per entity/metric", trend: "flat", color: "#30a46c" },
];

// Top risky users by behavioral risk (peer-relative)
export const UEBA_USERS = [
  { user: "j.torres@acme.com", dept: "Engineering", risk: 91, peer: "Eng-Admins", factor: "First-time access to prod DB + impossible travel", dev: "8.4σ", trend: [12, 18, 22, 30, 44, 61, 91] },
  { user: "s.malik@acme.com", dept: "Sales", risk: 76, peer: "Sales-Reps", factor: "Downloaded 40× peer-median volume from CRM", dev: "6.1σ", trend: [8, 9, 11, 20, 35, 52, 76] },
  { user: "svc_backup", dept: "Service acct", risk: 72, peer: "Service-Accounts", factor: "Interactive logon (service accounts never do)", dev: "9.0σ", trend: [4, 4, 5, 6, 40, 58, 72] },
  { user: "a.nguyen@acme.com", dept: "Finance", risk: 64, peer: "Finance", factor: "Off-hours access at 03:14 (baseline 09–18)", dev: "4.7σ", trend: [10, 12, 14, 15, 33, 48, 64] },
  { user: "m.rossi@acme.com", dept: "IT", risk: 58, peer: "IT-Admins", factor: "New admin tool + lateral RDP to 6 hosts", dev: "3.9σ", trend: [20, 22, 25, 30, 41, 50, 58] },
  { user: "contractor_07", dept: "External", risk: 55, peer: "Contractors", factor: "Accessed 3 repos never touched before", dev: "3.5σ", trend: [5, 8, 12, 22, 34, 45, 55] },
];

// Anomaly categories (behavioral factors), with counts + severity
export const UEBA_ANOMALIES = [
  { type: "Unusual login time", count: 34, sev: "med", icon: "schedule" },
  { type: "Impossible travel", count: 6, sev: "crit", icon: "flight" },
  { type: "Data exfil volume", count: 12, sev: "high", icon: "cloud_upload" },
  { type: "First-time resource access", count: 41, sev: "med", icon: "vpn_key" },
  { type: "Privilege escalation", count: 8, sev: "high", icon: "arrow_upward" },
  { type: "Abnormal auth volume", count: 19, sev: "med", icon: "repeat" },
  { type: "New device / geo", count: 22, sev: "low", icon: "devices" },
  { type: "Lateral movement", count: 5, sev: "high", icon: "hub" },
];

// Peer-group deviation examples
export const UEBA_PEER = [
  { user: "s.malik@acme.com", metric: "CRM records exported / day", user_val: "12,400", peer_med: "310", factor: "40×" },
  { user: "j.torres@acme.com", metric: "Distinct prod hosts accessed", user_val: "23", peer_med: "3", factor: "7.6×" },
  { user: "svc_backup", metric: "Interactive logons / week", user_val: "14", peer_med: "0", factor: "∞" },
  { user: "m.rossi@acme.com", metric: "RDP sessions initiated / day", user_val: "6", peer_med: "1", factor: "6×" },
];

export const sevLabel = (s: string) =>
  ({ crit: "critical", high: "high", med: "medium", low: "low", info: "info" } as any)[s] || s;
export const cap = (s: string) =>
  s === "inprogress"
    ? "In progress"
    : s.charAt(0).toUpperCase() + s.slice(1);
export const cellCov = (n: number) =>
  n >= 4 ? "c4" : n >= 3 ? "c3" : n >= 2 ? "c2" : n >= 1 ? "c1" : "";
export const kindIcon = (k: string) =>
  ({ host: "dns", user: "person", ip: "public", asset: "cloud" } as any)[k] || "help";
