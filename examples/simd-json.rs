use std::env;

fn main() -> Result<(), anyhow::Error> {
    let jsonstr = br#"{"kubernetes.annotations.checksum/config":"7e233732c5d6164e2408296cc5d77749803905c56148fdfc4c92e497abd25093", "kubernetes.annotations.checksum/luascripts":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "kubernetes.annotations.kubernetes.io/psp":"eks.privileged", "kubernetes.container_image":"cr.fluentbit.io/fluent/fluent-bit:1.9.7", "kubernetes.container_name":"fluent-bit", "kubernetes.docker_id":"d0fe1d22906c6918c71322c700f6a9b00f2c47eb14c460a05c709694c7de1644", "kubernetes.host":"ip-10-1-81-177.us-west-2.compute.internal", "kubernetes.labels.app.kubernetes.io/instance":"fluent-bit", "kubernetes.labels.app.kubernetes.io/name":"fluent-bit", "kubernetes.labels.controller-revision-hash":"6db46d9688", "kubernetes.labels.pod-template-generation":"1", "kubernetes.namespace_name":"logging", "kubernetes.pod_id":"f3ce6981-3add-472b-bce5-a4e561d3019d", "kubernetes.pod_name":"fluent-bit-5x4b7", "requestId":"a01ef7fc-0001-bc3a-51d1-0183cfa1c1ec", "stream":"stderr", "time":"2022-10-13T04:37:08.253116988Z"}"#;
    let mut jsonstr = jsonstr.to_vec();

    let mode = env::args().nth(1).unwrap_or("std".to_string());
    println!("arch: {:?}, mode: {}", env::consts::ARCH, mode);
    let start_time = std::time::Instant::now();

    let n = 1000000;
    if mode == "simd" {
        for _ in 0..n {
            let _val: serde_json::Value = simd_json::serde::from_slice(&mut jsonstr).unwrap();
            // println!("{}", val.get("kubernetes.pod_id").unwrap().as_str().unwrap());
        }
    } else {
        for _ in 0..n {
            let _val: serde_json::Value = serde_json::from_slice(&jsonstr).unwrap();
            // println!("{}", val.get("kubernetes.pod_id").unwrap().as_str().unwrap());
        }
    }

    println!("Time elapsed is: {:?}", start_time.elapsed());
    Ok(())
}
