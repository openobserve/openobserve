#!/usr/bin/env bash
set -euo pipefail

if [[ ${CI:-} == true ]]; then
    echo "The authorization benchmark runs locally only." >&2
    exit 1
fi

cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.."

fga_image=openfga/openfga:v1.22.1
fga_port=${FGA_PORT:-18090}
metrics_port=${FGA_METRICS_PORT:-12112}
fga_cpuset=${FGA_CPUSET:-0-1}
pg_cpuset=${PG_CPUSET:-2-3}
max_conns=${FGA_MAX_OPEN_CONNS:-30}
idle_conns=${FGA_MAX_IDLE_CONNS:-10}
read -r -a cpu_limits <<< "${FGA_CPUS_LIST:-1 0.2}"
if (("${#cpu_limits[@]}" == 0)); then
    echo "FGA_CPUS_LIST must contain at least one CPU limit" >&2
    exit 1
fi

runner=("${CARGO:-cargo}")
if command -v taskset >/dev/null; then
    client_cpuset=$(python3 - "$fga_cpuset" "$pg_cpuset" <<'PY'
import sys
from pathlib import Path

def expand(mask):
    cores = set()
    for part in mask.split(","):
        start, _, end = part.partition("-")
        cores.update(range(int(start), int(end or start) + 1))
    return cores

for line in Path("/proc/self/status").read_text().splitlines():
    if line.startswith("Cpus_allowed_list:"):
        available = expand(line.split()[1]) - expand(sys.argv[1]) - expand(sys.argv[2])
        if not available:
            sys.exit("FGA_CPUSET and PG_CPUSET must leave a CPU for the benchmark process")
        print(",".join(map(str, sorted(available))))
        break
else:
    sys.exit("cannot read process CPU affinity")
PY
)
    runner=(taskset -c "$client_cpuset" "${runner[@]}")
fi

prefix="o2-authz-bench-${BASHPID}-${RANDOM}"
network="${prefix}-net"
pg="${prefix}-pg"
fga="${prefix}-fga"
network_id=
pg_id=
fga_id=
scratch=$(mktemp -d)
final_out=${O2_BENCH_OUT:-target/authz-bench.jsonl}
cold_out=${final_out%.jsonl}.cold.jsonl
cold_records=()
data="$scratch/cells.jsonl"

cleanup() {
    if [[ -n $fga_id ]]; then
        docker logs --tail 200 "$fga_id" >"${final_out%.jsonl}.fga.log" 2>&1 || true
        docker rm -f "$fga_id" >/dev/null || true
    fi
    if [[ -n $pg_id ]]; then docker rm -f "$pg_id" >/dev/null || true; fi
    if [[ -n $network_id ]]; then docker network rm "$network_id" >/dev/null || true; fi
    if [[ -n ${cold_records[0]:-} ]] && ! cat -- "${cold_records[@]}" >> "$cold_out"; then
        printf 'Could not copy raw cold records. They are in %s\n' "$scratch" >&2
        exit 1
    fi
    rm -rf -- "$scratch"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

wait_for() {
    local attempt
    for ((attempt = 0; attempt < 60; attempt++)); do
        if "$@" >/dev/null 2>&1; then return 0; fi
        sleep 1
    done
    printf 'Timed out waiting for %s\n' "$*" >&2
    return 1
}

fga_cgroup() {
    local id=$1 pid hierarchy controllers location
    local directory="/sys/fs/cgroup/system.slice/docker-${id}.scope"
    if [[ -r $directory/cpu.stat ]]; then
        printf '%s\n' "$directory"
        return 0
    fi
    pid=$(docker inspect --format '{{.State.Pid}}' "$id")
    while IFS=: read -r hierarchy controllers location; do
        if [[ $hierarchy == 0 && -z $controllers && -r /sys/fs/cgroup$location/cpu.stat ]]; then
            printf '/sys/fs/cgroup%s\n' "$location"
            return 0
        fi
    done < "/proc/$pid/cgroup"
    printf 'Cannot locate readable cgroup v2 cpu.stat for %s\n' "$id" >&2
    return 1
}

bench() {
    "${runner[@]}" nextest run --workspace --test authz_list_bench \
        --run-ignored only --no-capture -j 1 --no-tests=fail "$@"
}

network_id=$(docker network create "$network")
pg_id=$(docker run -d --name "$pg" --network "$network_id" --cpuset-cpus "$pg_cpuset" \
    -e POSTGRES_PASSWORD=bench postgres:17)
wait_for docker exec "$pg_id" pg_isready -q -h 127.0.0.1 -U postgres
uri="postgres://postgres:bench@$pg:5432/postgres?sslmode=disable"
docker run --rm --name "${prefix}-migrate" --network "$network_id" "$fga_image" migrate \
    --datastore-engine postgres --datastore-uri "$uri"

fga_id=$(docker run -d --name "$fga" --network "$network_id" \
    --cpuset-cpus "$fga_cpuset" --cpus "${cpu_limits[0]}" \
    -p "127.0.0.1:$fga_port:8080" -p "127.0.0.1:$metrics_port:2112" \
    -e OPENFGA_REQUEST_TIMEOUT=5000ms -e OPENFGA_LIST_OBJECTS_DEADLINE=5000ms \
    "$fga_image" run --datastore-engine postgres --datastore-uri "$uri" \
    --datastore-max-open-conns="$max_conns" --datastore-max-idle-conns="$idle_conns" --playground-enabled=false \
    --http-addr=0.0.0.0:8080 --metrics-enabled=true --metrics-addr=0.0.0.0:2112 \
    --check-query-cache-enabled=false --check-iterator-cache-enabled=false \
    --list-objects-iterator-cache-enabled=false)
export O2_OPENFGA_IT_URL="http://127.0.0.1:$fga_port"
export O2_BENCH_FGA_METRICS_URL="http://127.0.0.1:$metrics_port/metrics"
wait_for curl --noproxy '*' -fsS --max-time 2 "$O2_OPENFGA_IT_URL/healthz"

export O2_BENCH_STORE_ID_FILE="$scratch/store-id"
unset O2_BENCH_SEED_ONLY O2_BENCH_COLD O2_BENCH_COLD_KEY O2_BENCH_COLD_LIST \
    O2_BENCH_COLD_FILE O2_BENCH_FGA_CGROUP
O2_BENCH_SEED_ONLY=1 bench "$@"
if [[ ! -s $O2_BENCH_STORE_ID_FILE ]]; then
    echo "No benchmark store created. Use the enterprise workspace manifest." >&2
    exit 1
fi

mkdir -p -- "$(dirname -- "$final_out")"
touch -- "$final_out" "$cold_out"
initial_lines=$(wc -l < "$final_out")
status=0
for i in "${!cpu_limits[@]}"; do
    cpu=${cpu_limits[i]}
    docker update --cpus "$cpu" "$fga_id" >/dev/null
    export O2_BENCH_FGA_CPUS="$cpu"
    cold_keys="$scratch/cold-keys-$i"
    O2_BENCH_COLD_LIST="$cold_keys" bench "$@"
    cold="$scratch/cold-${i}.jsonl"
    : > "$cold"
    cold_records+=("$cold")
    export O2_BENCH_FGA_CGROUP
    while IFS= read -r key <&3; do
        docker restart "$fga_id" >/dev/null
        wait_for curl --noproxy '*' -fsS --max-time 2 "$O2_OPENFGA_IT_URL/healthz"
        O2_BENCH_FGA_CGROUP=$(fga_cgroup "$fga_id")
        O2_BENCH_COLD=1 O2_BENCH_COLD_KEY="$key" O2_BENCH_OUT="$cold" bench "$@" || status=$?
    done 3< "$cold_keys"
    O2_BENCH_FGA_CGROUP=$(fga_cgroup "$fga_id")
    if [[ -s $cold ]]; then
        O2_BENCH_COLD_FILE="$cold" O2_BENCH_OUT="$final_out" bench "$@" || status=$?
    else
        O2_BENCH_OUT="$final_out" bench "$@" || status=$?
    fi
done

tail -n "+$((initial_lines + 1))" -- "$final_out" > "$data"
if [[ ! -s $data ]]; then
    echo "Benchmark produced no cells" >&2
    exit 1
fi
python3 scripts/authz-bench/summarize.py "$data"
exit "$status"
