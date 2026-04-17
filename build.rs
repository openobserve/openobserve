fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    // Tell Cargo to check the `tokio_unstable` cfg condition
    println!("cargo:rustc-check-cfg=cfg(tokio_unstable)");
}
