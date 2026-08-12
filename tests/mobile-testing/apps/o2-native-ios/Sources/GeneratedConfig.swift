// Build-time overridable RUM target. Committed with the default (dev-cluster) values; CI
// regenerates it (gen-config.sh) to point at a locally-built OpenObserve. See docs/CI-NOTES.md.
enum GeneratedConfig {
    static let host = "https://api.introspect.internal.zinclabs.dev"
    static let org = "3H4eDirnysdrcO60XNNKT1wJyQs" // vamsi_org
    static let token = "rum6sEgOCu3A1VO2NeI"
    static let env = "production"
}
