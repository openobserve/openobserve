// Copyright 2026 OpenObserve Inc.

import { gt, raw } from "@/types/i18n";

import { manifestIntegrations, manifestCategories, type ManifestEntry } from "./content/manifest";
import { resolveAICardLogo, getAICardLogos } from "./content";

export interface AIIntegration {
  slug: string;
  name: string;
  routeName: string;
  docURL: string;
  keywords: string[];
  /**
   * Folder slug of the rich card content in o2-datasource
   * (`datasource-ui-content/<contentSlug>/data-source-ui.md`). Set only on
   * integrations whose catalog `slug` differs from the content folder name
   * (e.g. `openai-python` → `"openai"`); defaults to `slug` when omitted.
   * This is the bridge that lets a manifest entry match this catalog entry.
   */
  contentSlug?: string;
  /** Resolved brand logo URL (from the manifest). Shown in the sidebar + card
   *  hero; omitted → lettered monogram fallback. */
  logo?: string;
  /** Optional resolved dark-mode logo URL; used only in dark mode, else `logo`. */
  logoDark?: string;
}

export interface AICategory {
  slug: string;
  name: string;
  integrations: AIIntegration[];
}

// Static catalog of every AI integration (the long tail of basic stubs plus
// the ones that have rich content). This is the BASE — the exported
// `aiCategories` at the bottom of the file merges the o2-datasource manifest on
// top of this (placing/reordering rich cards). Do not import this directly;
// import `aiCategories`.
const realCategories: AICategory[] = [
  {
    slug: "frameworks",
    get name() {
      return gt("ingestion.setupCard.aiCategoryFrameworks");
    },
    integrations: [
      {
        slug: "agno",
        name: raw("Agno"),
        routeName: "ai-agno",
        docURL: "https://openobserve.ai/docs/integration/ai/frameworks/agno/",
        keywords: ["agno", "ai framework"],
      },
      {
        slug: "autogen",
        name: raw("AutoGen"),
        routeName: "ai-autogen",
        docURL: "https://openobserve.ai/docs/integration/ai/frameworks/autogen/",
        keywords: ["autogen", "microsoft", "multi-agent"],
      },
      {
        slug: "beeai",
        name: raw("BeeAI"),
        routeName: "ai-beeai",
        docURL: "https://openobserve.ai/docs/integration/ai/frameworks/beeai/",
        keywords: ["beeai", "bee", "ai"],
      },
      {
        slug: "claude-agent-sdk",
        name: raw("Claude Agent SDK"),
        routeName: "ai-claude-agent-sdk",
        docURL: "https://openobserve.ai/docs/integration/ai/frameworks/claude-agent-sdk/",
        keywords: ["claude", "agent", "sdk", "anthropic"],
      },
      {
        slug: "crewai",
        name: raw("CrewAI"),
        routeName: "ai-crewai",
        docURL: "https://openobserve.ai/docs/integration/ai/frameworks/crewai/",
        keywords: ["crewai", "crew", "multi-agent"],
      },
      {
        slug: "dspy",
        name: raw("DSPy"),
        routeName: "ai-dspy",
        docURL: "https://openobserve.ai/docs/integration/ai/frameworks/dspy/",
        keywords: ["dspy", "stanford", "prompting"],
      },
      {
        slug: "google-adk",
        name: raw("Google ADK"),
        routeName: "ai-google-adk",
        docURL: "https://openobserve.ai/docs/integration/ai/frameworks/google-adk/",
        keywords: ["google", "adk", "agent development kit"],
      },
      {
        slug: "haystack",
        name: raw("Haystack"),
        routeName: "ai-haystack",
        docURL: "https://openobserve.ai/docs/integration/ai/frameworks/haystack/",
        keywords: ["haystack", "deepset", "nlp", "rag"],
      },
      {
        slug: "instructor",
        name: raw("Instructor"),
        routeName: "ai-instructor",
        docURL: "https://openobserve.ai/docs/integration/ai/frameworks/instructor/",
        keywords: ["instructor", "structured", "output", "pydantic"],
      },
      {
        slug: "koog",
        name: raw("Koog"),
        routeName: "ai-koog",
        docURL: "https://openobserve.ai/docs/integration/ai/frameworks/koog/",
        keywords: ["koog", "ai"],
      },
      {
        slug: "langchain",
        name: raw("LangChain"),
        routeName: "ai-langchain",
        docURL: "https://openobserve.ai/docs/integration/ai/frameworks/langchain/",
        keywords: ["langchain", "lang", "chain", "llm"],
      },
      {
        slug: "deepagents",
        name: raw("LangChain DeepAgents"),
        routeName: "ai-deepagents",
        docURL: "https://openobserve.ai/docs/integration/ai/frameworks/deepagents/",
        keywords: ["deepagents", "deep agents", "langchain"],
      },
      {
        slug: "langgraph",
        name: raw("LangGraph"),
        routeName: "ai-langgraph",
        docURL: "https://openobserve.ai/docs/integration/ai/frameworks/langgraph/",
        keywords: ["langgraph", "graph", "workflow", "langchain"],
      },
      {
        slug: "langserve",
        name: raw("Langserve"),
        routeName: "ai-langserve",
        docURL: "https://openobserve.ai/docs/integration/ai/frameworks/langserve/",
        keywords: ["langserve", "serve", "deploy", "langchain"],
      },
      {
        slug: "litellm-sdk",
        name: raw("LiteLLM SDK"),
        routeName: "ai-litellm-sdk",
        docURL: "https://openobserve.ai/docs/integration/ai/frameworks/litellm/",
        keywords: ["litellm", "lite", "llm", "sdk"],
      },
      {
        slug: "livekit",
        name: raw("LiveKit"),
        routeName: "ai-livekit",
        docURL: "https://openobserve.ai/docs/integration/ai/frameworks/livekit/",
        keywords: ["livekit", "live", "realtime", "voice"],
      },
      {
        slug: "llamaindex",
        name: raw("LlamaIndex"),
        routeName: "ai-llamaindex",
        docURL: "https://openobserve.ai/docs/integration/ai/frameworks/llamaindex/",
        keywords: ["llamaindex", "llama", "index", "rag"],
      },
      {
        slug: "llamaindex-workflows",
        name: raw("LlamaIndex Workflows"),
        routeName: "ai-llamaindex-workflows",
        docURL: "https://openobserve.ai/docs/integration/ai/frameworks/llamaindex-workflows/",
        keywords: ["llamaindex", "workflows", "llama"],
      },
      {
        slug: "mastra",
        name: raw("Mastra"),
        routeName: "ai-mastra",
        docURL: "https://openobserve.ai/docs/integration/ai/frameworks/mastra/",
        keywords: ["mastra", "ai"],
      },
      {
        slug: "microsoft-agent-framework",
        name: raw("Microsoft Agent Framework"),
        routeName: "ai-microsoft-agent-framework",
        docURL: "https://openobserve.ai/docs/integration/ai/frameworks/microsoft-agent-framework/",
        keywords: ["microsoft", "agent", "framework"],
      },
      {
        slug: "mirascope",
        name: raw("Mirascope"),
        routeName: "ai-mirascope",
        docURL: "https://openobserve.ai/docs/integration/ai/frameworks/mirascope/",
        keywords: ["mirascope", "ai"],
      },
      {
        slug: "openai-agents",
        name: raw("OpenAI Agents"),
        routeName: "ai-openai-agents",
        docURL: "https://openobserve.ai/docs/integration/ai/frameworks/openai-agents/",
        keywords: ["openai", "agents", "agent sdk"],
      },
      {
        slug: "pipecat",
        name: raw("Pipecat"),
        routeName: "ai-pipecat",
        docURL: "https://openobserve.ai/docs/integration/ai/frameworks/pipecat/",
        keywords: ["pipecat", "pipe", "voice", "realtime"],
      },
      {
        slug: "pydantic-ai",
        name: raw("Pydantic AI"),
        routeName: "ai-pydantic-ai",
        docURL: "https://openobserve.ai/docs/integration/ai/frameworks/pydantic-ai/",
        keywords: ["pydantic", "ai", "validation"],
      },
      {
        slug: "quarkus-langchain4j",
        name: raw("Quarkus LangChain4j"),
        routeName: "ai-quarkus-langchain4j",
        docURL: "https://openobserve.ai/docs/integration/ai/frameworks/quarkus-langchain4j/",
        keywords: ["quarkus", "langchain4j", "java", "langchain"],
      },
      {
        slug: "ragas",
        name: raw("Ragas"),
        routeName: "ai-ragas",
        docURL: "https://openobserve.ai/docs/integration/ai/frameworks/ragas/",
        keywords: ["ragas", "rag", "evaluation", "metrics"],
      },
      {
        slug: "restate",
        name: raw("Restate"),
        routeName: "ai-restate",
        docURL: "https://openobserve.ai/docs/integration/ai/frameworks/restate/",
        keywords: ["restate", "durable", "execution"],
      },
      {
        slug: "semantic-kernel",
        name: raw("Semantic Kernel"),
        routeName: "ai-semantic-kernel",
        docURL: "https://openobserve.ai/docs/integration/ai/frameworks/semantic-kernel/",
        keywords: ["semantic", "kernel", "microsoft", "sdk"],
      },
      {
        slug: "smolagents",
        name: raw("SmolAgents"),
        routeName: "ai-smolagents",
        docURL: "https://openobserve.ai/docs/integration/ai/frameworks/smolagents/",
        keywords: ["smolagents", "smol", "huggingface"],
      },
      {
        slug: "spring-ai",
        name: raw("Spring AI"),
        routeName: "ai-spring-ai",
        docURL: "https://openobserve.ai/docs/integration/ai/frameworks/spring-ai/",
        keywords: ["spring", "ai", "java", "spring boot"],
      },
      {
        slug: "strands-agents",
        name: raw("Strands Agents"),
        routeName: "ai-strands-agents",
        docURL: "https://openobserve.ai/docs/integration/ai/frameworks/strands-agents/",
        keywords: ["strands", "agents"],
      },
      {
        slug: "swiftide",
        name: raw("Swiftide"),
        routeName: "ai-swiftide",
        docURL: "https://openobserve.ai/docs/integration/ai/frameworks/swiftide/",
        keywords: ["swiftide", "swift", "rag"],
      },
      {
        slug: "temporal",
        name: raw("Temporal"),
        routeName: "ai-temporal",
        docURL: "https://openobserve.ai/docs/integration/ai/frameworks/temporal/",
        keywords: ["temporal", "workflow", "durable execution"],
      },
      {
        slug: "vercel-ai-sdk",
        name: raw("Vercel AI SDK"),
        routeName: "ai-vercel-ai-sdk",
        docURL: "https://openobserve.ai/docs/integration/ai/frameworks/vercel-ai-sdk/",
        keywords: ["vercel", "ai", "sdk", "nextjs"],
      },
      {
        slug: "voltagent",
        name: raw("VoltAgent"),
        routeName: "ai-voltagent",
        docURL: "https://openobserve.ai/docs/integration/ai/frameworks/voltagent/",
        keywords: ["voltagent", "volt", "agent"],
      },
    ],
  },
  {
    slug: "model-providers",
    get name() {
      return gt("ingestion.setupCard.aiCategoryModelProviders");
    },
    integrations: [
      {
        slug: "anthropic-python",
        name: raw("Anthropic (Python)"),
        routeName: "ai-anthropic-python",
        docURL: "https://openobserve.ai/docs/integration/ai/providers/anthropic/",
        keywords: ["anthropic", "python", "claude", "model provider"],
        contentSlug: "anthropic",
      },
      {
        slug: "anthropic-jsts",
        name: raw("Anthropic (JS/TS)"),
        routeName: "ai-anthropic-jsts",
        docURL: "https://openobserve.ai/docs/integration/ai/providers/anthropic-js/",
        keywords: ["anthropic", "javascript", "typescript", "claude", "model provider"],
      },
      {
        slug: "byteplus",
        name: raw("BytePlus"),
        routeName: "ai-byteplus",
        docURL: "https://openobserve.ai/docs/integration/ai/providers/byteplus/",
        keywords: ["byteplus", "bytedance", "model provider"],
      },
      {
        slug: "cerebras",
        name: raw("Cerebras"),
        routeName: "ai-cerebras",
        docURL: "https://openobserve.ai/docs/integration/ai/providers/cerebras/",
        keywords: ["cerebras", "model provider", "inference"],
      },
      {
        slug: "cohere",
        name: raw("Cohere"),
        routeName: "ai-cohere",
        docURL: "https://openobserve.ai/docs/integration/ai/providers/cohere/",
        keywords: ["cohere", "model provider", "embed"],
      },
      {
        slug: "cometapi",
        name: raw("CometAPI"),
        routeName: "ai-cometapi",
        docURL: "https://openobserve.ai/docs/integration/ai/providers/cometapi/",
        keywords: ["cometapi", "comet", "model provider"],
      },
      {
        slug: "databricks",
        name: raw("Databricks"),
        routeName: "ai-databricks",
        docURL: "https://openobserve.ai/docs/integration/ai/providers/databricks/",
        keywords: ["databricks", "model provider", "spark"],
      },
      {
        slug: "deepseek",
        name: raw("DeepSeek"),
        routeName: "ai-deepseek",
        docURL: "https://openobserve.ai/docs/integration/ai/providers/deepseek/",
        keywords: ["deepseek", "deep", "seek", "model provider"],
      },
      {
        slug: "fireworks",
        name: raw("Fireworks AI"),
        routeName: "ai-fireworks",
        docURL: "https://openobserve.ai/docs/integration/ai/providers/fireworks/",
        keywords: ["fireworks", "fire", "model provider", "inference"],
      },
      {
        slug: "google-gemini",
        name: raw("Google Gemini"),
        routeName: "ai-google-gemini",
        docURL: "https://openobserve.ai/docs/integration/ai/providers/google-gemini/",
        keywords: ["google", "gemini", "model provider"],
        contentSlug: "gemini",
      },
      {
        slug: "groq",
        name: raw("Groq"),
        routeName: "ai-groq",
        docURL: "https://openobserve.ai/docs/integration/ai/providers/groq/",
        keywords: ["groq", "model provider", "inference", "fast"],
      },
      {
        slug: "huggingface",
        name: raw("Hugging Face"),
        routeName: "ai-huggingface",
        docURL: "https://openobserve.ai/docs/integration/ai/providers/huggingface/",
        keywords: ["huggingface", "hugging", "face", "model provider", "transformers"],
      },
      {
        slug: "mistral",
        name: raw("Mistral"),
        routeName: "ai-mistral",
        docURL: "https://openobserve.ai/docs/integration/ai/providers/mistral/",
        keywords: ["mistral", "model provider", "french"],
      },
      {
        slug: "novita",
        name: raw("Novita AI"),
        routeName: "ai-novita",
        docURL: "https://openobserve.ai/docs/integration/ai/providers/novita/",
        keywords: ["novita", "model provider"],
      },
      {
        slug: "ollama",
        name: raw("Ollama"),
        routeName: "ai-ollama",
        docURL: "https://openobserve.ai/docs/integration/ai/providers/ollama/",
        keywords: ["ollama", "local", "model provider", "self-hosted"],
      },
      {
        slug: "openai-python",
        name: raw("OpenAI (Python)"),
        routeName: "ai-openai-python",
        docURL: "https://openobserve.ai/docs/integration/ai/providers/openai/",
        keywords: ["openai", "python", "gpt", "model provider"],
        contentSlug: "openai",
      },
      {
        slug: "openai-jsts",
        name: raw("OpenAI (JS/TS)"),
        routeName: "ai-openai-jsts",
        docURL: "https://openobserve.ai/docs/integration/ai/providers/openai-js/",
        keywords: ["openai", "javascript", "typescript", "gpt", "model provider"],
      },
      {
        slug: "openai-assistants",
        name: raw("OpenAI Assistants API"),
        routeName: "ai-openai-assistants",
        docURL: "https://openobserve.ai/docs/integration/ai/providers/openai-assistants/",
        keywords: ["openai", "assistants", "api", "model provider"],
      },
      {
        slug: "together-ai",
        name: raw("Together AI"),
        routeName: "ai-together-ai",
        docURL: "https://openobserve.ai/docs/integration/ai/providers/together-ai/",
        keywords: ["together", "ai", "model provider", "inference"],
      },
      {
        slug: "vllm",
        name: raw("vLLM"),
        routeName: "ai-vllm",
        docURL: "https://openobserve.ai/docs/integration/ai/providers/vllm/",
        keywords: ["vllm", "model provider", "inference", "self-hosted"],
      },
      {
        slug: "xai-grok",
        name: raw("xAI Grok"),
        routeName: "ai-xai-grok",
        docURL: "https://openobserve.ai/docs/integration/ai/providers/xai-grok/",
        keywords: ["xai", "grok", "elon", "model provider"],
      },
    ],
  },
  {
    slug: "gateways",
    get name() {
      return gt("ingestion.setupCard.aiCategoryGateways");
    },
    integrations: [
      {
        slug: "anannas",
        name: raw("Anannas"),
        routeName: "ai-anannas",
        docURL: "https://openobserve.ai/docs/integration/ai/gateways/anannas/",
        keywords: ["anannas", "gateway"],
      },
      {
        slug: "kong-gateway",
        name: raw("Kong Gateway"),
        routeName: "ai-kong-gateway",
        docURL: "https://openobserve.ai/docs/integration/ai/gateways/kong-gateway/",
        keywords: ["kong", "gateway", "api"],
      },
      {
        slug: "litellm-proxy",
        name: raw("LiteLLM Proxy"),
        routeName: "ai-litellm-proxy",
        docURL: "https://openobserve.ai/docs/integration/ai/gateways/litellm-proxy/",
        keywords: ["litellm", "proxy", "gateway", "llm"],
        contentSlug: "litellm",
      },
      {
        slug: "openrouter",
        name: raw("OpenRouter"),
        routeName: "ai-openrouter",
        docURL: "https://openobserve.ai/docs/integration/ai/gateways/openrouter/",
        keywords: ["openrouter", "router", "gateway"],
      },
      {
        slug: "portkey",
        name: raw("Portkey"),
        routeName: "ai-portkey",
        docURL: "https://openobserve.ai/docs/integration/ai/gateways/portkey/",
        keywords: ["portkey", "gateway", "control"],
      },
      {
        slug: "vercel-ai-gateway",
        name: raw("Vercel AI Gateway"),
        routeName: "ai-vercel-ai-gateway",
        docURL: "https://openobserve.ai/docs/integration/ai/gateways/vercel-ai-gateway/",
        keywords: ["vercel", "ai", "gateway"],
      },
    ],
  },
  {
    slug: "no-code",
    get name() {
      return gt("ingestion.setupCard.aiCategoryNoCode");
    },
    integrations: [
      {
        slug: "codename-goose",
        name: raw("Codename Goose"),
        routeName: "ai-codename-goose",
        docURL: "https://openobserve.ai/docs/integration/ai/no-code/codename-goose/",
        keywords: ["codename", "goose", "no-code"],
      },
      {
        slug: "flowise",
        name: raw("Flowise"),
        routeName: "ai-flowise",
        docURL: "https://openobserve.ai/docs/integration/ai/no-code/flowise/",
        keywords: ["flowise", "flow", "no-code", "langchain"],
      },
      {
        slug: "langflow",
        name: raw("Langflow"),
        routeName: "ai-langflow",
        docURL: "https://openobserve.ai/docs/integration/ai/no-code/langflow/",
        keywords: ["langflow", "flow", "no-code", "langchain"],
      },
      {
        slug: "lobechat",
        name: raw("LobeChat"),
        routeName: "ai-lobechat",
        docURL: "https://openobserve.ai/docs/integration/ai/no-code/lobechat/",
        keywords: ["lobechat", "lobe", "chat", "no-code"],
      },
      {
        slug: "n8n",
        name: raw("n8n"),
        routeName: "ai-n8n",
        docURL: "https://openobserve.ai/docs/integration/ai/no-code/n8n/",
        keywords: ["n8n", "automation", "no-code", "workflow"],
      },
      {
        slug: "openwebui",
        name: raw("OpenWebUI"),
        routeName: "ai-openwebui",
        docURL: "https://openobserve.ai/docs/integration/ai/no-code/openwebui/",
        keywords: ["openwebui", "open", "web", "ui", "no-code"],
      },
      {
        slug: "vapi",
        name: raw("Vapi"),
        routeName: "ai-vapi",
        docURL: "https://openobserve.ai/docs/integration/ai/no-code/vapi/",
        keywords: ["vapi", "voice", "api", "no-code"],
      },
    ],
  },
  {
    slug: "analytics",
    get name() {
      return gt("ingestion.setupCard.aiCategoryAnalytics");
    },
    integrations: [
      {
        slug: "mixpanel",
        name: raw("Mixpanel"),
        routeName: "ai-mixpanel",
        docURL: "https://openobserve.ai/docs/integration/ai/tools/mixpanel/",
        keywords: ["mixpanel", "analytics", "product"],
      },
      {
        slug: "posthog",
        name: raw("PostHog"),
        routeName: "ai-posthog",
        docURL: "https://openobserve.ai/docs/integration/ai/tools/posthog/",
        keywords: ["posthog", "analytics", "product", "open source"],
      },
      {
        slug: "trubrics",
        name: raw("Trubrics"),
        routeName: "ai-trubrics",
        docURL: "https://openobserve.ai/docs/integration/ai/tools/trubrics/",
        keywords: ["trubrics", "evaluation", "analytics", "feedback"],
      },
    ],
  },
  {
    slug: "tools",
    get name() {
      return gt("ingestion.setupCard.aiCategoryTools");
    },
    integrations: [
      {
        slug: "claude-code",
        name: raw("Claude Code"),
        routeName: "ai-claude-code",
        docURL: "https://openobserve.ai/docs/integration/ai/claude-code-tracing/",
        keywords: ["claude", "code", "cli", "anthropic", "tracing"],
      },
      {
        slug: "cognee",
        name: raw("Cognee"),
        routeName: "ai-cognee",
        docURL: "https://openobserve.ai/docs/integration/ai/tools/cognee/",
        keywords: ["cognee", "knowledge", "graph"],
      },
      {
        slug: "exa",
        name: raw("Exa"),
        routeName: "ai-exa",
        docURL: "https://openobserve.ai/docs/integration/ai/tools/exa/",
        keywords: ["exa", "search", "api"],
      },
      {
        slug: "firecrawl",
        name: raw("Firecrawl"),
        routeName: "ai-firecrawl",
        docURL: "https://openobserve.ai/docs/integration/ai/tools/firecrawl/",
        keywords: ["firecrawl", "crawl", "scrape", "web"],
      },
      {
        slug: "gradio",
        name: raw("Gradio"),
        routeName: "ai-gradio",
        docURL: "https://openobserve.ai/docs/integration/ai/tools/gradio/",
        keywords: ["gradio", "ui", "demo", "huggingface"],
      },
      {
        slug: "librechat",
        name: raw("LibreChat"),
        routeName: "ai-librechat",
        docURL: "https://openobserve.ai/docs/integration/ai/tools/librechat/",
        keywords: ["librechat", "libre", "chat", "open source"],
      },
      {
        slug: "mcp-use",
        name: raw("mcp-use"),
        routeName: "ai-mcp-use",
        docURL: "https://openobserve.ai/docs/integration/ai/tools/mcp-use/",
        keywords: ["mcp", "use", "model context protocol"],
      },
      {
        slug: "milvus",
        name: raw("Milvus"),
        routeName: "ai-milvus",
        docURL: "https://openobserve.ai/docs/integration/ai/tools/milvus/",
        keywords: ["milvus", "vector", "database", "embedding"],
      },
      {
        slug: "parallel",
        name: raw("Parallel"),
        routeName: "ai-parallel",
        docURL: "https://openobserve.ai/docs/integration/ai/tools/parallel/",
        keywords: ["parallel", "ai"],
      },
      {
        slug: "promptfoo",
        name: raw("Promptfoo"),
        routeName: "ai-promptfoo",
        docURL: "https://openobserve.ai/docs/integration/ai/tools/promptfoo/",
        keywords: ["promptfoo", "prompt", "testing", "evaluation"],
      },
      {
        slug: "zapier",
        name: raw("Zapier"),
        routeName: "ai-zapier",
        docURL: "https://openobserve.ai/docs/integration/ai/tools/zapier/",
        keywords: ["zapier", "automation", "integration", "no-code"],
      },
    ],
  },
];

// Tab placement is driven by the content repo's manifest
// (datasource-ui-content/manifest.json). For each manifest entry we build a
// rich card and place it at the TOP of its declared `category` tab. If the
// entry matches an existing catalog integration (by content slug) we MOVE it —
// reusing its route and removing the original — so a card is never duplicated.
// Entries with no existing match (e.g. CLI agents) become new entries; a
// `category` with no existing tab becomes a new tab (labelled via the
// manifest's `categories` block). Adding/moving a card is a content-repo change.

const titleCase = (slug: string): string =>
  slug
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

// Index existing integrations by their content slug so manifest entries can
// reuse routes and we can drop the originals (dedupe).
const existingByContentSlug = new Map<string, AIIntegration>();
for (const category of realCategories) {
  for (const integration of category.integrations) {
    existingByContentSlug.set(integration.contentSlug ?? integration.slug, integration);
  }
}

const toCard = (entry: ManifestEntry): AIIntegration => {
  const existing = existingByContentSlug.get(entry.slug);
  const fmLogos = getAICardLogos(entry.slug);
  return {
    slug: entry.slug,
    name: entry.name,
    routeName: existing?.routeName ?? `ai-${entry.slug}`, // reuse route if it exists
    docURL: entry.docURL ?? existing?.docURL ?? "",
    keywords: entry.keywords ?? existing?.keywords ?? [],
    contentSlug: entry.slug,
    // Logo precedence: manifest entry → the card's frontmatter logo → a
    // hardcoded fallback. (Manifest filename → bundled asset URL, or absolute
    // URL as-is.) `logo_dark`/`logoDark` is the optional dark-mode variant.
    // Falling back to the frontmatter means a single `logo:` in the md shows in
    // both the sidebar menu and the card hero — one authoring spot.
    logo: resolveAICardLogo(entry.slug, entry.logo) || fmLogos.logo || existing?.logo,
    logoDark:
      resolveAICardLogo(entry.slug, entry.logoDark ?? (entry as any).logo_dark) ||
      fmLogos.logoDark ||
      existing?.logoDark,
  };
};

// Group manifest cards by category (sorted by order) and remember which
// existing routes they claimed, so we can remove those originals.
const cardsByCategory = new Map<string, AIIntegration[]>();
const claimedRouteNames = new Set<string>();
for (const entry of [...manifestIntegrations].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
  const card = toCard(entry);
  claimedRouteNames.add(card.routeName);
  const list = cardsByCategory.get(entry.category) ?? [];
  list.push(card);
  cardsByCategory.set(entry.category, list);
}

const categoryLabel = new Map(manifestCategories.map((c) => [c.slug, c.label] as const));

// Build a tab: manifest cards on top, then the remaining (unclaimed) catalog
// entries. Returns null if the tab would be empty.
const buildCategory = (slug: string): AICategory | null => {
  const cards = cardsByCategory.get(slug) ?? [];
  const real = realCategories.find((c) => c.slug === slug);
  if (real) {
    const remaining = real.integrations.filter((i) => !claimedRouteNames.has(i.routeName));
    // Forward the getter rather than reading it: this runs at module scope, so
    // `name: real.name` would resolve the translation once at import and freeze
    // the label to whichever locale happened to be loaded then.
    return {
      slug: real.slug,
      get name() {
        return real.name;
      },
      integrations: [...cards, ...remaining],
    };
  }
  if (!cards.length) return null;
  return {
    slug,
    name: categoryLabel.get(slug) ?? titleCase(slug),
    integrations: cards,
  };
};

const ordered: AICategory[] = [];
const seen = new Set<string>();
const push = (slug: string) => {
  if (seen.has(slug)) return;
  const built = buildCategory(slug);
  if (built) {
    ordered.push(built);
    seen.add(slug);
  }
};

// 0. "Popular" is always pinned first when it has cards.
push("popular");
// 1. Categories the manifest explicitly declares, in their declared order.
[...manifestCategories]
  .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  .forEach((c) => push(c.slug));
// 2. Remaining real categories, in their natural order.
realCategories.forEach((c) => push(c.slug));
// 3. Any manifest categories with cards that weren't declared or pre-existing.
[...cardsByCategory.keys()].forEach((slug) => push(slug));

export const aiCategories: AICategory[] = ordered;
