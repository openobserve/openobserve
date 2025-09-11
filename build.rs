fn main() {
    // Tell Cargo to check the `tokio_unstable` cfg condition
    println!("cargo:rustc-check-cfg=cfg(tokio_unstable)");
}
