// Build-time overridable RUM target. Committed with the default (dev-cluster) values; CI
// regenerates it (gen-config.sh) to point at a locally-built OpenObserve. See docs/CI-NOTES.md.
enum GeneratedConfig {
    static let host = "https://dev.common-dev.internal.zinclabs.dev"
    static let org = "3HOStgiihM8H43cMLWY3BUfXV5r"
    static let token = "rumtbJXyJcgC8jB9Otu"
    static let env = "testing"
}
