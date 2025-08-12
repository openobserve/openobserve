# Security Policy

Thank you for helping keep OpenObserve and our users safe. This document explains how to report security vulnerabilities, what’s in scope, and what you can expect from us.

## Supported Projects & Versions

OpenObserve is composed of multiple projects and distributions:

* **OpenObserve (OSS)** – the open-source core in this repo
* **OpenObserve Enterprise** – commercial features built on top of OSS
* **OpenObserve Cloud** – our hosted service

We provide security fixes for the **current stable release**. Pre-release builds (e.g., `main`, release candidates) are supported on a best‑effort basis.

## Reporting a Vulnerability (Preferred)

Please **privately disclose** suspected vulnerabilities to our security team:

1. **GitHub → Security → “Report a vulnerability”** (opens a private advisory with maintainers).
2. Or email **[security@openobserve.ai](mailto:security@openobserve.ai)**.

### What to Include

* A clear description of the issue and potential impact
* Exact components affected (repo, package, service)
* Version(s), commit hash(es), and environment details
* Minimal, reproducible steps or PoC (non-destructive)
* Any logs, screenshots, or traces that help reproduce
* Proposed severity (CVSS v3.1 vector, if available)

We’re happy to coordinate on disclosure timelines when your research impacts other vendors or ecosystems.

## Coordinated Disclosure

* We request a **90‑day** disclosure window by default. We may extend this for complex fixes or cross‑vendor coordination.
* We publish advisories via GitHub Security Advisories (GHSA) and CVE where applicable, crediting reporters who wish to be named.

## Scope

**In scope** (examples):

* Remote code execution, injection, authN/authZ bypass, data exposure
* Logic flaws causing privilege escalation or data integrity issues
* Supply‑chain risks in our build/release artifacts
* Default configuration issues that materially reduce security
* OpenObserve Cloud issues (tenant isolation, API auth, data access)

**Out of scope** (examples):

* Vulnerabilities requiring physical access or stolen credentials
* Denial of service from volumetric attacks without a product flaw
* Best‑practice recommendations without a concrete vulnerability
* Issues only affecting unsupported/End‑of‑Life versions
* Vulnerabilities in **third‑party dependencies** with no exploitable impact in OpenObserve’s usage (we’ll upstream where appropriate)

## Responsible Testing Guidelines

Please:

* Use **test or your own accounts/data** only; avoid accessing others’ data.
* Avoid actions that degrade service for other users (no volumetric/DoS).
* Limit testing on **OpenObserve Cloud** to non-production accounts and data.
* Do not run automated scanners against OpenObserve Cloud without prior coordination.
* Respect rate limits and legal boundaries in your jurisdiction.

If you discover sensitive data exposure, stop testing immediately and report privately.

## Safe Harbor

We support good‑faith research. If you:

* Follow this policy,
* Avoid privacy violations, data destruction, and service disruption, and
* Report vulnerabilities promptly and do not abuse them,

we will not pursue or support legal action against you. This safe harbor does **not** cover unlawful actions, uncoordinated testing on production systems, or use of data beyond what’s necessary to demonstrate the issue.

## Recognition & Bounty

At this time we **do not operate a public bug bounty program**. We’re grateful for responsible disclosures and, with your consent, will **credit you** in release notes or advisories. From time to time we may offer thank‑you swag. If a bounty program is introduced, we will update this policy accordingly.

## Security Updates & SBOM

* We proactively update dependencies and ship security fixes in patch releases.
* We publish release notes highlighting security‑relevant changes.
* SBOMs for supported releases are available in this Git repository.

## Build & Supply‑Chain Integrity

We follow industry best practices:

* Reproducible builds and pinned dependencies where feasible
* **Version pinning** for all dependencies and build tools to ensure deterministic and verifiable builds
* Use of **distroless container images** to reduce the attack surface
* Public verification of builds via **GitHub Actions logs** – all release builds are executed through GitHub Actions, and logs are publicly available in this repository’s Actions tab to allow independent verification of the build process.

## Reporting Abuse or Fraud (Cloud)

For phishing, account abuse, or suspicious activity affecting OpenObserve Cloud, contact **[abuse@openobserve.ai](mailto:abuse@openobserve.ai)**. For active incidents, include urgency in the subject.

## Security Contact

* Primary: **[security@openobserve.ai](mailto:security@openobserve.ai)**
* Backup: **security reports via GitHub → Security → “Report a vulnerability”**

We appreciate your help in keeping OpenObserve safe for everyone.
