// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

// Registry of in-repo (non-AI) data-source setup cards. A data source opts into
// the rich card by adding a typed builder here, keyed by its route slug. The
// builder receives the per-org {url}/{org}/{token} substitutions and returns a
// RichCardContent (see ./content/sqlServer.ts for the reference card).
//
// AI integrations are NOT registered here — they resolve through their own
// markdown pipeline (ai/content). This registry is only for data sources whose
// content lives inside the openobserve repo.

import type { CardSubstitutions, RichCardContent } from "./types";
import sqlServer from "./content/sqlServer";
import postgres from "./content/postgres";
import mysql from "./content/mysql";
import mongodb from "./content/mongodb";
import redis from "./content/redis";
import oracle from "./content/oracle";
import aerospike from "./content/aerospike";
import zookeeper from "./content/zookeeper";
import snowflake from "./content/snowflake";
import cassandra from "./content/cassandra";
import databricks from "./content/databricks";
import dynamodb from "./content/dynamodb";

/** Given per-org substitutions, returns a data source's setup-card content. */
export type DataSourceCardBuilder = (
  subs: CardSubstitutions,
) => RichCardContent;

const registry: Record<string, DataSourceCardBuilder> = {
  sqlServer,
  postgres,
  mySQL: mysql,
  mongoDB: mongodb,
  redis,
  oracle,
  aerospike,
  zookeeper,
  snowflake,
  cassandra,
  databricks,
  dynamoDB: dynamodb,
};

/** Whether a data source slug has an in-repo rich setup card. */
export function hasDataSourceCard(slug: string | undefined): boolean {
  return !!slug && slug in registry;
}

/** Build a data source's rich card content, or undefined if it has none. */
export function getDataSourceCard(
  slug: string | undefined,
  subs: CardSubstitutions,
): RichCardContent | undefined {
  if (!slug) return undefined;
  return registry[slug]?.(subs);
}
