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

/** The names every sample asset is created under; removal finds them by these names. */
export const SAMPLE_STREAMS = {
  appLogs: "sample_app_logs",
  accessLogs: "sample_nginx_access",
  traces: "sample_traces",
} as const;

export const SAMPLE_METRICS = {
  requests: "sample_http_requests_total",
  latencyP95: "sample_http_request_duration_p95_ms",
  cpu: "sample_container_cpu_usage_percent",
  memory: "sample_container_memory_usage_bytes",
  orders: "sample_orders_total",
  kafkaLag: "sample_kafka_consumer_lag",
} as const;

export const SAMPLE_ENRICHMENT_TABLE = "sample_service_owners";
export const SAMPLE_FOLDER_NAME = "Sample data";
export const SAMPLE_OVERVIEW_TITLE = "Storefront · Service overview";
export const SAMPLE_ALERT_TEMPLATE = "sample_alert_template";
export const SAMPLE_ALERT_DESTINATION = "sample_webhook";
export const SAMPLE_FUNCTIONS = ["sample_classify_latency", "sample_parse_user_agent"] as const;

export const SAMPLE_NAMESPACE = "storefront";

export type SampleServiceName =
  | "frontend"
  | "api-gateway"
  | "auth"
  | "product-catalog"
  | "recommendation"
  | "cart"
  | "checkout"
  | "payment"
  | "shipping"
  | "inventory";

export interface SampleService {
  name: SampleServiceName;
  team: string;
  owner: string;
  tier: "critical" | "high" | "medium";
  language: string;
  version: string;
  pods: string[];
  /** Resident memory baseline in MiB, the gauge the infrastructure dashboard charts. */
  memoryMiB: number;
}

const pods = (service: string, hash: string, suffixes: string[]) =>
  suffixes.map((s) => `${service}-${hash}-${s}`);

export const SAMPLE_SERVICES: readonly SampleService[] = [
  {
    name: "frontend",
    team: "web",
    owner: "maya.chen",
    tier: "critical",
    language: "nodejs",
    version: "3.8.2",
    pods: pods("frontend", "6f9c7d8b5", ["x2kqp", "m7tzr", "c4wnd"]),
    memoryMiB: 410,
  },
  {
    name: "api-gateway",
    team: "platform",
    owner: "lucas.otieno",
    tier: "critical",
    language: "go",
    version: "1.22.0",
    pods: pods("api-gateway", "7d4f9b6c8", ["h8jfl", "q2vbn"]),
    memoryMiB: 180,
  },
  {
    name: "auth",
    team: "identity",
    owner: "priya.raman",
    tier: "critical",
    language: "go",
    version: "2.4.1",
    pods: pods("auth", "5b8d6c7f9", ["r6tgy", "k9mwe"]),
    memoryMiB: 150,
  },
  {
    name: "product-catalog",
    team: "catalog",
    owner: "jonas.weber",
    tier: "high",
    language: "java",
    version: "5.1.0",
    pods: pods("product-catalog", "8c7b5d9f4", ["p3xsa", "z8ncv"]),
    memoryMiB: 820,
  },
  {
    name: "recommendation",
    team: "personalization",
    owner: "amara.okafor",
    tier: "medium",
    language: "python",
    version: "0.19.3",
    pods: pods("recommendation", "9d6f8c7b5", ["w5ehj"]),
    memoryMiB: 640,
  },
  {
    name: "cart",
    team: "checkout",
    owner: "diego.santos",
    tier: "high",
    language: "dotnet",
    version: "4.0.7",
    pods: pods("cart", "6c9d7b8f5", ["b2lkq", "n6fdr"]),
    memoryMiB: 300,
  },
  {
    name: "checkout",
    team: "checkout",
    owner: "diego.santos",
    tier: "critical",
    language: "go",
    version: "2.9.0",
    pods: pods("checkout", "7f5c8d9b6", ["t4yhu", "g7cxz"]),
    memoryMiB: 210,
  },
  {
    name: "payment",
    team: "payments",
    owner: "sofia.rossi",
    tier: "critical",
    language: "nodejs",
    version: "2.14.0",
    pods: pods("payment", "5d7c9f6b8", ["j3pwo", "v8sxl"]),
    memoryMiB: 360,
  },
  {
    name: "shipping",
    team: "fulfilment",
    owner: "kenji.watanabe",
    tier: "high",
    language: "rust",
    version: "1.6.4",
    pods: pods("shipping", "8b6d7c5f9", ["e9rtd"]),
    memoryMiB: 90,
  },
  {
    name: "inventory",
    team: "fulfilment",
    owner: "kenji.watanabe",
    tier: "high",
    language: "java",
    version: "3.3.2",
    pods: pods("inventory", "9f8b6d7c5", ["u2mbg", "s5qkw"]),
    memoryMiB: 760,
  },
];

export const SAMPLE_NODES = [
  "ip-10-0-1-23.ec2.internal",
  "ip-10-0-2-71.ec2.internal",
  "ip-10-0-3-118.ec2.internal",
];

export const serviceByName = (name: SampleServiceName): SampleService =>
  SAMPLE_SERVICES.find((s) => s.name === name) as SampleService;

/** A pod always runs on the same node, so per-node charts stay coherent. */
export const nodeForPod = (pod: string): string => {
  let hash = 0;
  for (const ch of pod) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return SAMPLE_NODES[hash % SAMPLE_NODES.length];
};

export const PRODUCTS = [
  { id: "OLJCESPC7Z", name: "Vintage Typewriter", price: 67.99 },
  { id: "66VCHSJNUP", name: "Antique Camera", price: 109.99 },
  { id: "1YMWWN1N4O", name: "Home Barista Kit", price: 124.0 },
  { id: "L9ECAV7KIM", name: "Terrarium", price: 36.45 },
  { id: "2ZYFJ3GM2N", name: "Film Camera", price: 279.0 },
  { id: "0PUK6V6EV0", name: "Vintage Record Player", price: 65.5 },
  { id: "LS4PSXUNUM", name: "Metal Camping Mug", price: 24.33 },
  { id: "9SIQT8TOJO", name: "City Bike", price: 789.5 },
  { id: "6E92ZMYYFZ", name: "Air Plant", price: 12.3 },
  { id: "HQTGWGPNH4", name: "Solar Flashlight", price: 39.95 },
];

export const COUNTRIES = [
  { code: "US", weight: 34 },
  { code: "IN", weight: 14 },
  { code: "DE", weight: 9 },
  { code: "GB", weight: 9 },
  { code: "BR", weight: 7 },
  { code: "JP", weight: 6 },
  { code: "FR", weight: 6 },
  { code: "CA", weight: 5 },
  { code: "AU", weight: 4 },
  { code: "SG", weight: 3 },
  { code: "NL", weight: 3 },
];

export const USER_AGENTS = [
  {
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
    weight: 34,
  },
  {
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15",
    weight: 18,
  },
  {
    ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1",
    weight: 22,
  },
  {
    ua: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36",
    weight: 16,
  },
  {
    ua: "Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0",
    weight: 6,
  },
  {
    ua: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    weight: 4,
  },
];

export const PAYMENT_METHODS = [
  { method: "card", weight: 62 },
  { method: "paypal", weight: 21 },
  { method: "apple_pay", weight: 12 },
  { method: "gift_card", weight: 5 },
];

export type SampleRouteId =
  | "home"
  | "listProducts"
  | "getProduct"
  | "recommendations"
  | "addToCart"
  | "getCart"
  | "checkout"
  | "login"
  | "staticAsset";

export interface SampleRoute {
  id: SampleRouteId;
  method: "GET" | "POST";
  /** The templated route that traces and app logs report. */
  route: string;
  weight: number;
}

export const SAMPLE_ROUTES: readonly SampleRoute[] = [
  { id: "home", method: "GET", route: "/", weight: 12 },
  { id: "listProducts", method: "GET", route: "/api/products", weight: 18 },
  { id: "getProduct", method: "GET", route: "/api/products/{id}", weight: 22 },
  { id: "recommendations", method: "GET", route: "/api/recommendations", weight: 12 },
  { id: "addToCart", method: "POST", route: "/api/cart", weight: 9 },
  { id: "getCart", method: "GET", route: "/api/cart", weight: 7 },
  { id: "checkout", method: "POST", route: "/api/checkout", weight: 5 },
  { id: "login", method: "POST", route: "/api/auth/login", weight: 4 },
  { id: "staticAsset", method: "GET", route: "/static/{asset}", weight: 11 },
];

export const STATIC_ASSETS = [
  "app.4f9c2.js",
  "vendor.b81d0.js",
  "styles.77ae1.css",
  "logo.svg",
  "hero-banner.webp",
  "fonts/inter-var.woff2",
];
