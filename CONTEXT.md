# OpenObserve

An observability platform. This glossary covers terms whose meaning is specific to OpenObserve.

## Language

### Status pages

**Status page**:
A public page that shows the health of an org's synthetics checks to people outside the org.
_Avoid_: Public dashboard, uptime page

**Custom domain**:
A hostname the customer owns, such as `status.brandname.com`, used as a second address for one status page.
_Avoid_: Vanity domain, domain mapping, org domain

**Claim**:
An org's request to use a custom domain for one of its status pages. Several orgs may claim one hostname at the same time and none blocks another; only the holder is routed. A claim is live until it is released.
_Avoid_: Domain record, binding

**Ownership proof**:
The record that shows the org controls the hostname, asked for by the installation's certificate mode and never chosen per claim. With built-in TLS it is the claim's CNAME, `<custom domain> CNAME <label>.<domain target>`. In proxy mode it is the TXT record `_o2-verify.<custom domain>` whose value is the claim's token. It must stay in DNS: it is checked again every 6 hours, and a holder whose proof is gone lapses 72 hours after its first negative answer.
_Avoid_: Verification record, DCV

**Certificate mode**:
Who terminates TLS for custom domains and with that which ownership proof is asked, set by `ZO_STATUS_PAGE_DOMAIN_TLS` and read once at startup. `built_in` is the default and the only mode on Cloud; `proxy` is for self-hosted installations. With the default mode and no domain target, custom domains are off.
_Avoid_: TLS mode, proof mode

**Built-in TLS**:
The certificate mode in which OpenObserve orders the certificates and terminates TLS on the domain listener. It needs a domain target, and a claim is proven by its CNAME under that target.
_Avoid_: Managed TLS, auto TLS

**Proxy mode**:
The certificate mode in which the operator's own proxy terminates TLS and forwards to the main HTTP port with the visitor's `Host`. OpenObserve orders no certificate, opens no domain port and needs no target; a claim is proven by its TXT record, and the main listener's host route serves the holder of the `Host`. Everything except the app authority and operational authority is the custom-domain plane: it never reaches the app.
_Avoid_: Reverse proxy mode, passthrough

**Holder**:
The one live claim that holds a hostname, because its ownership proof was found and has not been lost to another claim. A hostname has at most one holder.
_Avoid_: Owner, winner, primary

**Verified claim**:
A live claim that is the holder. Verified means the org controls the hostname, nothing more, and only while the proof stays in DNS.
_Avoid_: Active, connected, live, serving

**Lapse**:
A holder losing its hostname: one DNS answer shows another claim's proof and not the holder's, or the holder's own proof is gone and a negative answer comes 72 hours or more after its first one. The holder fails with reason "proof lost" and nothing grants it the hostname again without a new proof. A DNS outage never lapses a holder: only a negative answer counts.
_Avoid_: Revoke, steal, expire

**Serving custom domain**:
A custom domain for which visitors actually get the status page over valid HTTPS. A verified claim is not serving until DNS, the certificate and the route all work.
_Avoid_: Verified, active

**Release**:
Ending a claim, by the org, by deleting its page or org, or by expiry: a claim that is not the holder is released 7 days after it was created or last checked with "Verify now". A released custom domain may be claimed again, by any org, with a new ownership proof. A claim released by expiry stays listed for 30 days.
_Avoid_: Delete, unclaim

**Pending**:
The state of a claim that is not the holder. It shows the record of the mode and one reason. Built-in TLS: no record, points elsewhere, points at the app host, DNS lookup failed, held by another organization, or proof lost. Proxy mode: record missing, value differs, DNS lookup failed, held by another organization, or proof lost. While custom domains are off it shows that they are not enabled and no record.
_Avoid_: Unverified, waiting

**Not serving**:
The state of a holder that cannot be served: its org is blocked or denied, the license lacks the feature, or the Cloud org has no paid plan.
_Avoid_: Disabled, inactive

**Expired**:
The state of a claim released because it was not the holder for 7 days. It is listed for 30 more days.
_Avoid_: Deleted, failed

**App authority**:
In proxy mode, the host of `ZO_WEB_URL` or a host in `ZO_STATUS_PAGE_DOMAIN_APP_HOSTS`: a request for it keeps normal routing, so the UI, the API and webhooks work.
_Avoid_: App domain, main host

**Operational authority**:
In proxy mode, an IP-literal host, `localhost` or a host in `ZO_STATUS_PAGE_DOMAIN_OPERATIONAL_HOSTS`: a request for it keeps normal routing, so probes and scrapes of the app's own routes work.
_Avoid_: Internal host, health host

### Orgs

**Org domain**:
An email domain an org has proven it owns, so that users with that email domain join the org. Unrelated to custom domains, although both are proven with a TXT record.
_Avoid_: Custom domain, domain mapping
