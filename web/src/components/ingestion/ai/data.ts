// Copyright 2026 OpenObserve Inc.

export interface AIIntegration {
  slug: string;
  name: string;
  routeName: string;
  docURL: string;
  keywords: string[];
}

export interface AICategory {
  slug: string;
  name: string;
  integrations: AIIntegration[];
}

export const aiCategories: AICategory[] = [
  {
    slug: "frameworks",
    name: "AI Frameworks & Agents",
    integrations: [
      {
        slug: "agno",
        name: "Agno",
        routeName: "ai-agno",
        docURL: "https://openobserve.ai/docs/integration/ai/frameworks/agno/",
        keywords: ["agno", "ai framework"],
      },
      {
        slug: "autogen",
        name: "AutoGen",
        routeName: "ai-autogen",
        docURL:
          "https://openobserve.ai/docs/integration/ai/frameworks/autogen/",
        keywords: ["autogen", "microsoft", "multi-agent"],
      },
      {
        slug: "beeai",
        name: "BeeAI",
        routeName: "ai-beeai",
        docURL: "https://openobserve.ai/docs/integration/ai/frameworks/beeai/",
        keywords: ["beeai", "bee", "ai"],
      },
      {
        slug: "claude-agent-sdk",
        name: "Claude Agent SDK",
        routeName: "ai-claude-agent-sdk",
        docURL:
          "https://openobserve.ai/docs/integration/ai/frameworks/claude-agent-sdk/",
        keywords: ["claude", "agent", "sdk", "anthropic"],
      },
      {
        slug: "crewai",
        name: "CrewAI",
        routeName: "ai-crewai",
        docURL: "https://openobserve.ai/docs/integration/ai/frameworks/crewai/",
        keywords: ["crewai", "crew", "multi-agent"],
      },
      {
        slug: "dspy",
        name: "DSPy",
        routeName: "ai-dspy",
        docURL: "https://openobserve.ai/docs/integration/ai/frameworks/dspy/",
        keywords: ["dspy", "stanford", "prompting"],
      },
      {
        slug: "google-adk",
        name: "Google ADK",
        routeName: "ai-google-adk",
        docURL:
          "https://openobserve.ai/docs/integration/ai/frameworks/google-adk/",
        keywords: ["google", "adk", "agent development kit"],
      },
      {
        slug: "haystack",
        name: "Haystack",
        routeName: "ai-haystack",
        docURL:
          "https://openobserve.ai/docs/integration/ai/frameworks/haystack/",
        keywords: ["haystack", "deepset", "nlp", "rag"],
      },
      {
        slug: "instructor",
        name: "Instructor",
        routeName: "ai-instructor",
        docURL:
          "https://openobserve.ai/docs/integration/ai/frameworks/instructor/",
        keywords: ["instructor", "structured", "output", "pydantic"],
      },
      {
        slug: "koog",
        name: "Koog",
        routeName: "ai-koog",
        docURL: "https://openobserve.ai/docs/integration/ai/frameworks/koog/",
        keywords: ["koog", "ai"],
      },
      {
        slug: "langchain",
        name: "LangChain",
        routeName: "ai-langchain",
        docURL:
          "https://openobserve.ai/docs/integration/ai/frameworks/langchain/",
        keywords: ["langchain", "lang", "chain", "llm"],
      },
      {
        slug: "deepagents",
        name: "LangChain DeepAgents",
        routeName: "ai-deepagents",
        docURL:
          "https://openobserve.ai/docs/integration/ai/frameworks/deepagents/",
        keywords: ["deepagents", "deep agents", "langchain"],
      },
      {
        slug: "langgraph",
        name: "LangGraph",
        routeName: "ai-langgraph",
        docURL:
          "https://openobserve.ai/docs/integration/ai/frameworks/langgraph/",
        keywords: ["langgraph", "graph", "workflow", "langchain"],
      },
      {
        slug: "langserve",
        name: "Langserve",
        routeName: "ai-langserve",
        docURL:
          "https://openobserve.ai/docs/integration/ai/frameworks/langserve/",
        keywords: ["langserve", "serve", "deploy", "langchain"],
      },
      {
        slug: "litellm-sdk",
        name: "LiteLLM SDK",
        routeName: "ai-litellm-sdk",
        docURL:
          "https://openobserve.ai/docs/integration/ai/frameworks/litellm/",
        keywords: ["litellm", "lite", "llm", "sdk"],
      },
      {
        slug: "livekit",
        name: "LiveKit",
        routeName: "ai-livekit",
        docURL:
          "https://openobserve.ai/docs/integration/ai/frameworks/livekit/",
        keywords: ["livekit", "live", "realtime", "voice"],
      },
      {
        slug: "llamaindex",
        name: "LlamaIndex",
        routeName: "ai-llamaindex",
        docURL:
          "https://openobserve.ai/docs/integration/ai/frameworks/llamaindex/",
        keywords: ["llamaindex", "llama", "index", "rag"],
      },
      {
        slug: "llamaindex-workflows",
        name: "LlamaIndex Workflows",
        routeName: "ai-llamaindex-workflows",
        docURL:
          "https://openobserve.ai/docs/integration/ai/frameworks/llamaindex-workflows/",
        keywords: ["llamaindex", "workflows", "llama"],
      },
      {
        slug: "mastra",
        name: "Mastra",
        routeName: "ai-mastra",
        docURL: "https://openobserve.ai/docs/integration/ai/frameworks/mastra/",
        keywords: ["mastra", "ai"],
      },
      {
        slug: "microsoft-agent-framework",
        name: "Microsoft Agent Framework",
        routeName: "ai-microsoft-agent-framework",
        docURL:
          "https://openobserve.ai/docs/integration/ai/frameworks/microsoft-agent-framework/",
        keywords: ["microsoft", "agent", "framework"],
      },
      {
        slug: "mirascope",
        name: "Mirascope",
        routeName: "ai-mirascope",
        docURL:
          "https://openobserve.ai/docs/integration/ai/frameworks/mirascope/",
        keywords: ["mirascope", "ai"],
      },
      {
        slug: "openai-agents",
        name: "OpenAI Agents",
        routeName: "ai-openai-agents",
        docURL:
          "https://openobserve.ai/docs/integration/ai/frameworks/openai-agents/",
        keywords: ["openai", "agents", "agent sdk"],
      },
      {
        slug: "pipecat",
        name: "Pipecat",
        routeName: "ai-pipecat",
        docURL:
          "https://openobserve.ai/docs/integration/ai/frameworks/pipecat/",
        keywords: ["pipecat", "pipe", "voice", "realtime"],
      },
      {
        slug: "pydantic-ai",
        name: "Pydantic AI",
        routeName: "ai-pydantic-ai",
        docURL:
          "https://openobserve.ai/docs/integration/ai/frameworks/pydantic-ai/",
        keywords: ["pydantic", "ai", "validation"],
      },
      {
        slug: "quarkus-langchain4j",
        name: "Quarkus LangChain4j",
        routeName: "ai-quarkus-langchain4j",
        docURL:
          "https://openobserve.ai/docs/integration/ai/frameworks/quarkus-langchain4j/",
        keywords: ["quarkus", "langchain4j", "java", "langchain"],
      },
      {
        slug: "ragas",
        name: "Ragas",
        routeName: "ai-ragas",
        docURL: "https://openobserve.ai/docs/integration/ai/frameworks/ragas/",
        keywords: ["ragas", "rag", "evaluation", "metrics"],
      },
      {
        slug: "restate",
        name: "Restate",
        routeName: "ai-restate",
        docURL:
          "https://openobserve.ai/docs/integration/ai/frameworks/restate/",
        keywords: ["restate", "durable", "execution"],
      },
      {
        slug: "semantic-kernel",
        name: "Semantic Kernel",
        routeName: "ai-semantic-kernel",
        docURL:
          "https://openobserve.ai/docs/integration/ai/frameworks/semantic-kernel/",
        keywords: ["semantic", "kernel", "microsoft", "sdk"],
      },
      {
        slug: "smolagents",
        name: "SmolAgents",
        routeName: "ai-smolagents",
        docURL:
          "https://openobserve.ai/docs/integration/ai/frameworks/smolagents/",
        keywords: ["smolagents", "smol", "huggingface"],
      },
      {
        slug: "spring-ai",
        name: "Spring AI",
        routeName: "ai-spring-ai",
        docURL:
          "https://openobserve.ai/docs/integration/ai/frameworks/spring-ai/",
        keywords: ["spring", "ai", "java", "spring boot"],
      },
      {
        slug: "strands-agents",
        name: "Strands Agents",
        routeName: "ai-strands-agents",
        docURL:
          "https://openobserve.ai/docs/integration/ai/frameworks/strands-agents/",
        keywords: ["strands", "agents"],
      },
      {
        slug: "swiftide",
        name: "Swiftide",
        routeName: "ai-swiftide",
        docURL:
          "https://openobserve.ai/docs/integration/ai/frameworks/swiftide/",
        keywords: ["swiftide", "swift", "rag"],
      },
      {
        slug: "temporal",
        name: "Temporal",
        routeName: "ai-temporal",
        docURL:
          "https://openobserve.ai/docs/integration/ai/frameworks/temporal/",
        keywords: ["temporal", "workflow", "durable execution"],
      },
      {
        slug: "vercel-ai-sdk",
        name: "Vercel AI SDK",
        routeName: "ai-vercel-ai-sdk",
        docURL:
          "https://openobserve.ai/docs/integration/ai/frameworks/vercel-ai-sdk/",
        keywords: ["vercel", "ai", "sdk", "nextjs"],
      },
      {
        slug: "voltagent",
        name: "VoltAgent",
        routeName: "ai-voltagent",
        docURL:
          "https://openobserve.ai/docs/integration/ai/frameworks/voltagent/",
        keywords: ["voltagent", "volt", "agent"],
      },
    ],
  },
  {
    slug: "model-providers",
    name: "Model Providers",
    integrations: [
      {
        slug: "anthropic-python",
        name: "Anthropic (Python)",
        routeName: "ai-anthropic-python",
        docURL:
          "https://openobserve.ai/docs/integration/ai/providers/anthropic/",
        keywords: ["anthropic", "python", "claude", "model provider"],
      },
      {
        slug: "anthropic-jsts",
        name: "Anthropic (JS/TS)",
        routeName: "ai-anthropic-jsts",
        docURL:
          "https://openobserve.ai/docs/integration/ai/providers/anthropic-js/",
        keywords: [
          "anthropic",
          "javascript",
          "typescript",
          "claude",
          "model provider",
        ],
      },
      {
        slug: "byteplus",
        name: "BytePlus",
        routeName: "ai-byteplus",
        docURL:
          "https://openobserve.ai/docs/integration/ai/providers/byteplus/",
        keywords: ["byteplus", "bytedance", "model provider"],
      },
      {
        slug: "cerebras",
        name: "Cerebras",
        routeName: "ai-cerebras",
        docURL:
          "https://openobserve.ai/docs/integration/ai/providers/cerebras/",
        keywords: ["cerebras", "model provider", "inference"],
      },
      {
        slug: "cohere",
        name: "Cohere",
        routeName: "ai-cohere",
        docURL: "https://openobserve.ai/docs/integration/ai/providers/cohere/",
        keywords: ["cohere", "model provider", "embed"],
      },
      {
        slug: "cometapi",
        name: "CometAPI",
        routeName: "ai-cometapi",
        docURL:
          "https://openobserve.ai/docs/integration/ai/providers/cometapi/",
        keywords: ["cometapi", "comet", "model provider"],
      },
      {
        slug: "databricks",
        name: "Databricks",
        routeName: "ai-databricks",
        docURL:
          "https://openobserve.ai/docs/integration/ai/providers/databricks/",
        keywords: ["databricks", "model provider", "spark"],
      },
      {
        slug: "deepseek",
        name: "DeepSeek",
        routeName: "ai-deepseek",
        docURL:
          "https://openobserve.ai/docs/integration/ai/providers/deepseek/",
        keywords: ["deepseek", "deep", "seek", "model provider"],
      },
      {
        slug: "fireworks",
        name: "Fireworks AI",
        routeName: "ai-fireworks",
        docURL:
          "https://openobserve.ai/docs/integration/ai/providers/fireworks/",
        keywords: ["fireworks", "fire", "model provider", "inference"],
      },
      {
        slug: "google-gemini",
        name: "Google Gemini",
        routeName: "ai-google-gemini",
        docURL:
          "https://openobserve.ai/docs/integration/ai/providers/google-gemini/",
        keywords: ["google", "gemini", "model provider"],
      },
      {
        slug: "groq",
        name: "Groq",
        routeName: "ai-groq",
        docURL: "https://openobserve.ai/docs/integration/ai/providers/groq/",
        keywords: ["groq", "model provider", "inference", "fast"],
      },
      {
        slug: "huggingface",
        name: "Hugging Face",
        routeName: "ai-huggingface",
        docURL:
          "https://openobserve.ai/docs/integration/ai/providers/huggingface/",
        keywords: [
          "huggingface",
          "hugging",
          "face",
          "model provider",
          "transformers",
        ],
      },
      {
        slug: "mistral",
        name: "Mistral",
        routeName: "ai-mistral",
        docURL: "https://openobserve.ai/docs/integration/ai/providers/mistral/",
        keywords: ["mistral", "model provider", "french"],
      },
      {
        slug: "novita",
        name: "Novita AI",
        routeName: "ai-novita",
        docURL: "https://openobserve.ai/docs/integration/ai/providers/novita/",
        keywords: ["novita", "model provider"],
      },
      {
        slug: "ollama",
        name: "Ollama",
        routeName: "ai-ollama",
        docURL: "https://openobserve.ai/docs/integration/ai/providers/ollama/",
        keywords: ["ollama", "local", "model provider", "self-hosted"],
      },
      {
        slug: "openai-python",
        name: "OpenAI (Python)",
        routeName: "ai-openai-python",
        docURL: "https://openobserve.ai/docs/integration/ai/providers/openai/",
        keywords: ["openai", "python", "gpt", "model provider"],
      },
      {
        slug: "openai-jsts",
        name: "OpenAI (JS/TS)",
        routeName: "ai-openai-jsts",
        docURL:
          "https://openobserve.ai/docs/integration/ai/providers/openai-js/",
        keywords: [
          "openai",
          "javascript",
          "typescript",
          "gpt",
          "model provider",
        ],
      },
      {
        slug: "openai-assistants",
        name: "OpenAI Assistants API",
        routeName: "ai-openai-assistants",
        docURL:
          "https://openobserve.ai/docs/integration/ai/providers/openai-assistants/",
        keywords: ["openai", "assistants", "api", "model provider"],
      },
      {
        slug: "together-ai",
        name: "Together AI",
        routeName: "ai-together-ai",
        docURL:
          "https://openobserve.ai/docs/integration/ai/providers/together-ai/",
        keywords: ["together", "ai", "model provider", "inference"],
      },
      {
        slug: "vllm",
        name: "vLLM",
        routeName: "ai-vllm",
        docURL: "https://openobserve.ai/docs/integration/ai/providers/vllm/",
        keywords: ["vllm", "model provider", "inference", "self-hosted"],
      },
      {
        slug: "xai-grok",
        name: "xAI Grok",
        routeName: "ai-xai-grok",
        docURL:
          "https://openobserve.ai/docs/integration/ai/providers/xai-grok/",
        keywords: ["xai", "grok", "elon", "model provider"],
      },
    ],
  },
  {
    slug: "gateways",
    name: "AI Gateways & Proxies",
    integrations: [
      {
        slug: "anannas",
        name: "Anannas",
        routeName: "ai-anannas",
        docURL: "https://openobserve.ai/docs/integration/ai/gateways/anannas/",
        keywords: ["anannas", "gateway"],
      },
      {
        slug: "kong-gateway",
        name: "Kong Gateway",
        routeName: "ai-kong-gateway",
        docURL:
          "https://openobserve.ai/docs/integration/ai/gateways/kong-gateway/",
        keywords: ["kong", "gateway", "api"],
      },
      {
        slug: "litellm-proxy",
        name: "LiteLLM Proxy",
        routeName: "ai-litellm-proxy",
        docURL:
          "https://openobserve.ai/docs/integration/ai/gateways/litellm-proxy/",
        keywords: ["litellm", "proxy", "gateway", "llm"],
      },
      {
        slug: "openrouter",
        name: "OpenRouter",
        routeName: "ai-openrouter",
        docURL:
          "https://openobserve.ai/docs/integration/ai/gateways/openrouter/",
        keywords: ["openrouter", "router", "gateway"],
      },
      {
        slug: "portkey",
        name: "Portkey",
        routeName: "ai-portkey",
        docURL: "https://openobserve.ai/docs/integration/ai/gateways/portkey/",
        keywords: ["portkey", "gateway", "control"],
      },
      {
        slug: "vercel-ai-gateway",
        name: "Vercel AI Gateway",
        routeName: "ai-vercel-ai-gateway",
        docURL:
          "https://openobserve.ai/docs/integration/ai/gateways/vercel-ai-gateway/",
        keywords: ["vercel", "ai", "gateway"],
      },
    ],
  },
  {
    slug: "no-code",
    name: "No-Code Platforms",
    integrations: [
      {
        slug: "codename-goose",
        name: "Codename Goose",
        routeName: "ai-codename-goose",
        docURL:
          "https://openobserve.ai/docs/integration/ai/no-code/codename-goose/",
        keywords: ["codename", "goose", "no-code"],
      },
      {
        slug: "flowise",
        name: "Flowise",
        routeName: "ai-flowise",
        docURL: "https://openobserve.ai/docs/integration/ai/no-code/flowise/",
        keywords: ["flowise", "flow", "no-code", "langchain"],
      },
      {
        slug: "langflow",
        name: "Langflow",
        routeName: "ai-langflow",
        docURL: "https://openobserve.ai/docs/integration/ai/no-code/langflow/",
        keywords: ["langflow", "flow", "no-code", "langchain"],
      },
      {
        slug: "lobechat",
        name: "LobeChat",
        routeName: "ai-lobechat",
        docURL: "https://openobserve.ai/docs/integration/ai/no-code/lobechat/",
        keywords: ["lobechat", "lobe", "chat", "no-code"],
      },
      {
        slug: "n8n",
        name: "n8n",
        routeName: "ai-n8n",
        docURL: "https://openobserve.ai/docs/integration/ai/no-code/n8n/",
        keywords: ["n8n", "automation", "no-code", "workflow"],
      },
      {
        slug: "openwebui",
        name: "OpenWebUI",
        routeName: "ai-openwebui",
        docURL: "https://openobserve.ai/docs/integration/ai/no-code/openwebui/",
        keywords: ["openwebui", "open", "web", "ui", "no-code"],
      },
      {
        slug: "vapi",
        name: "Vapi",
        routeName: "ai-vapi",
        docURL: "https://openobserve.ai/docs/integration/ai/no-code/vapi/",
        keywords: ["vapi", "voice", "api", "no-code"],
      },
    ],
  },
  {
    slug: "analytics",
    name: "Analytics & Evaluation",
    integrations: [
      {
        slug: "mixpanel",
        name: "Mixpanel",
        routeName: "ai-mixpanel",
        docURL: "https://openobserve.ai/docs/integration/ai/tools/mixpanel/",
        keywords: ["mixpanel", "analytics", "product"],
      },
      {
        slug: "posthog",
        name: "PostHog",
        routeName: "ai-posthog",
        docURL: "https://openobserve.ai/docs/integration/ai/tools/posthog/",
        keywords: ["posthog", "analytics", "product", "open source"],
      },
      {
        slug: "trubrics",
        name: "Trubrics",
        routeName: "ai-trubrics",
        docURL: "https://openobserve.ai/docs/integration/ai/tools/trubrics/",
        keywords: ["trubrics", "evaluation", "analytics", "feedback"],
      },
    ],
  },
  {
    slug: "tools",
    name: "Tools & Integrations",
    integrations: [
      {
        slug: "claude-code",
        name: "Claude Code",
        routeName: "ai-claude-code",
        docURL:
          "https://openobserve.ai/docs/integration/ai/claude-code-tracing/",
        keywords: ["claude", "code", "cli", "anthropic", "tracing"],
      },
      {
        slug: "cognee",
        name: "Cognee",
        routeName: "ai-cognee",
        docURL: "https://openobserve.ai/docs/integration/ai/tools/cognee/",
        keywords: ["cognee", "knowledge", "graph"],
      },
      {
        slug: "exa",
        name: "Exa",
        routeName: "ai-exa",
        docURL: "https://openobserve.ai/docs/integration/ai/tools/exa/",
        keywords: ["exa", "search", "api"],
      },
      {
        slug: "firecrawl",
        name: "Firecrawl",
        routeName: "ai-firecrawl",
        docURL: "https://openobserve.ai/docs/integration/ai/tools/firecrawl/",
        keywords: ["firecrawl", "crawl", "scrape", "web"],
      },
      {
        slug: "gradio",
        name: "Gradio",
        routeName: "ai-gradio",
        docURL: "https://openobserve.ai/docs/integration/ai/tools/gradio/",
        keywords: ["gradio", "ui", "demo", "huggingface"],
      },
      {
        slug: "librechat",
        name: "LibreChat",
        routeName: "ai-librechat",
        docURL: "https://openobserve.ai/docs/integration/ai/tools/librechat/",
        keywords: ["librechat", "libre", "chat", "open source"],
      },
      {
        slug: "mcp-use",
        name: "mcp-use",
        routeName: "ai-mcp-use",
        docURL: "https://openobserve.ai/docs/integration/ai/tools/mcp-use/",
        keywords: ["mcp", "use", "model context protocol"],
      },
      {
        slug: "milvus",
        name: "Milvus",
        routeName: "ai-milvus",
        docURL: "https://openobserve.ai/docs/integration/ai/tools/milvus/",
        keywords: ["milvus", "vector", "database", "embedding"],
      },
      {
        slug: "parallel",
        name: "Parallel",
        routeName: "ai-parallel",
        docURL: "https://openobserve.ai/docs/integration/ai/tools/parallel/",
        keywords: ["parallel", "ai"],
      },
      {
        slug: "promptfoo",
        name: "Promptfoo",
        routeName: "ai-promptfoo",
        docURL: "https://openobserve.ai/docs/integration/ai/tools/promptfoo/",
        keywords: ["promptfoo", "prompt", "testing", "evaluation"],
      },
      {
        slug: "zapier",
        name: "Zapier",
        routeName: "ai-zapier",
        docURL: "https://openobserve.ai/docs/integration/ai/tools/zapier/",
        keywords: ["zapier", "automation", "integration", "no-code"],
      },
    ],
  },
];
