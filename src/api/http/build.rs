fn main() {
    println!("cargo:rustc-check-cfg=cfg(tokio_unstable)");
}
