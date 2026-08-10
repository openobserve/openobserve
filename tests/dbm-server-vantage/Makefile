# DBM server-vantage proof rig.
#   make up      — build + start everything (needs O2_AUTH)
#   make down    — remove ONLY this rig's containers/volumes
#   make logs    — collector logs
#   make errors  — collector errors, deduped
#   make proof   — run the capability probes against OpenObserve
COMPOSE ?= docker compose
O2_URL  ?= http://localhost:5096
O2_USER ?= root@example.com
O2_PASS ?= Complexpass#123
O2_AUTH ?= $(shell printf '%s:%s' '$(O2_USER)' '$(O2_PASS)' | base64)
export O2_AUTH

.PHONY: up down logs errors proof restart-collector

up:
	$(COMPOSE) up -d --build --wait postgres mysql mariadb mssql redis
	$(COMPOSE) up -d --build collector workload

down:
	$(COMPOSE) down -v --remove-orphans

restart-collector:
	$(COMPOSE) restart collector

logs:
	$(COMPOSE) logs --tail=100 collector

errors:
	@docker logs dbm-sv-collector 2>&1 | grep -i error | grep -v '^github' \
	  | sed 's/{"resource.*//' | sort | uniq -c | sort -rn | head -20

proof:
	@FROM=$$(( ($$(date +%s)-1800)*1000000 )); TO=$$(( ($$(date +%s)+60)*1000000 )); \
	for s in \
	  "o2_pg_event distribution|SELECT o2_pg_event, count(*) AS n FROM dbm_server GROUP BY o2_pg_event ORDER BY n DESC" \
	  "o2_recipe distribution|SELECT o2_recipe, count(*) AS n FROM dbm_server GROUP BY o2_recipe ORDER BY n DESC" \
	  "deadlocks|SELECT ts, deadlock_victim_pid AS victim, dl_blocker_pid AS survivor, dl_query_1, dl_query_2 FROM dbm_server WHERE o2_pg_event='deadlock' AND dl_query_1 IS NOT NULL ORDER BY _timestamp DESC" \
	; do \
	  echo "### $${s%%|*}"; \
	  curl -s -u '$(O2_USER):$(O2_PASS)' -H 'Content-Type: application/json' \
	    '$(O2_URL)/api/default/_search?type=logs' \
	    -d "{\"query\":{\"sql\":\"$${s#*|}\",\"start_time\":$$FROM,\"end_time\":$$TO,\"size\":10}}" \
	  | python3 -c 'import sys,json;d=json.load(sys.stdin);[print("  ",h) for h in d.get("hits",[])] or print("  no hits")'; \
	done
