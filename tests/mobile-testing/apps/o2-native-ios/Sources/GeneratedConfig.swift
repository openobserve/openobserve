// Build-time overridable RUM target. Committed with PLACEHOLDER values; CI regenerates it
// (gen-config.sh) to point at a locally-built OpenObserve, and mints its own token per run.
// For a real target set O2_RUM_HOST/ORG/TOKEN and run gen-config.sh. See docs/CI-NOTES.md.
enum GeneratedConfig {
    static let host = "https://openobserve.example.com"
    static let org = "REPLACE_ME"
    static let token = "REPLACE_ME"
    static let env = "production"
}
