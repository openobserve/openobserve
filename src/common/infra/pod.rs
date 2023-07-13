use k8s_openapi::api::core::v1::Pod;
use kube::{config, Api};
use sys_info::hostname;

#[derive(Clone, Debug)]
pub struct PodLimits {
    pub mem_limit: String,
    pub cpu_limit: String,
}

pub async fn get_pod_limits() -> PodLimits {
    let mut pod_mem_limit = String::new();
    let mut pod_cpu_limit = String::new();
    if let Ok(config) = config::Config::incluster_env() {
        if let Ok(client) = kube::Client::try_from(config) {
            // Retrieve the current pod name
            let pod_name = hostname().unwrap();
            let pods: Api<Pod> = Api::all(client);
            if let Ok(pod) = pods.get(&pod_name).await {
                if let Some(spec) = pod.spec {
                    let containers = spec.containers;
                    for container in containers {
                        if let Some(resources) = container.resources {
                            if let Some(limits) = resources.limits {
                                if let Some(cpu_limit) = limits.get("cpu") {
                                    log::info!("CPU Limit: {:?}", cpu_limit);
                                    pod_cpu_limit = cpu_limit.0.to_owned();
                                }
                                if let Some(memory_limit) = limits.get("memory") {
                                    log::info!("Memory Limit: {:?}", memory_limit);
                                    pod_mem_limit = memory_limit.0.to_owned();
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    PodLimits {
        mem_limit: pod_mem_limit,
        cpu_limit: pod_cpu_limit,
    }
}
