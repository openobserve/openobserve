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
The DNS TXT record under `_o2-verify.<custom domain>` whose value matches the claim's token. It must stay in DNS: it is checked again every 6 hours.
_Avoid_: Verification record, DCV

**Holder**:
The one live claim that holds a hostname, because its ownership proof was found and has not been lost to another claim. A hostname has at most one holder.
_Avoid_: Owner, winner, primary

**Verified claim**:
A live claim that is the holder. Verified means the org controls the hostname, nothing more, and only while the proof stays in DNS.
_Avoid_: Active, connected, live, serving

**Lapse**:
A holder losing its hostname because one DNS answer shows another claim's token and not the holder's. The holder fails with reason "proof lost", the other claim becomes the holder, and nothing grants the lapsed claim the hostname again without a new proof. A DNS outage never lapses a holder.
_Avoid_: Revoke, steal, expire

**Serving custom domain**:
A custom domain for which visitors actually get the status page over valid HTTPS. A verified claim is not serving until DNS, the certificate and the route all work.
_Avoid_: Verified, active

**Release**:
Ending a claim, by the org, by deleting its page or org, or by expiry: a claim that is not the holder is released 7 days after it was created or last checked with "Verify now". A released custom domain may be claimed again, by any org, with a new ownership proof. A claim released by expiry stays listed for 30 days.
_Avoid_: Delete, unclaim

**Pending**:
The state of a claim that is not the holder. It shows the TXT record and one reason: record missing, value differs, DNS lookup failed, held by another organization, or proof lost.
_Avoid_: Unverified, waiting

**Not serving**:
The state of a holder that cannot be served: its org is blocked or denied, the license lacks the feature, or the Cloud org has no paid plan.
_Avoid_: Disabled, inactive

**Expired**:
The state of a claim released because it was not the holder for 7 days. It is listed for 30 more days.
_Avoid_: Deleted, failed

### Orgs

**Org domain**:
An email domain an org has proven it owns, so that users with that email domain join the org. Unrelated to custom domains, although both are proven with a TXT record.
_Avoid_: Custom domain, domain mapping
