import { BedrockRuntimeClient, ConverseCommand, type ContentBlock, type Message } from '@aws-sdk/client-bedrock-runtime';

// Amazon Bedrock access for Porchlight's three model-backed features: the porch
// vision check, the end-of-day digest and "Ask Porchlight". Auth is either a
// Bedrock API key (AWS_BEARER_TOKEN_BEDROCK) or normal AWS credentials.

export interface AiConfig {
  enabled: boolean;
  region: string;
  textModelId: string;
  visionModelId: string;
  apiKey?: string;
  why: string;
}

export function aiConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AiConfig {
  const region = env.AWS_REGION ?? env.AWS_DEFAULT_REGION ?? 'us-east-1';
  const textModelId = env.PORCHLIGHT_TEXT_MODEL ?? 'us.amazon.nova-pro-v1:0';
  const visionModelId = env.PORCHLIGHT_VISION_MODEL ?? 'us.amazon.nova-lite-v1:0';
  const apiKey = env.AWS_BEARER_TOKEN_BEDROCK || undefined;
  const hasCreds = Boolean(apiKey || (env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY) || env.AWS_PROFILE);
  if (env.PORCHLIGHT_AI === 'off') return { enabled: false, region, textModelId, visionModelId, why: 'turned off with PORCHLIGHT_AI=off' };
  if (!hasCreds) return { enabled: false, region, textModelId, visionModelId, why: 'no AWS credentials or Bedrock API key in .env' };
  return { enabled: true, region, textModelId, visionModelId, apiKey, why: apiKey ? 'Bedrock API key' : 'AWS credentials' };
}

export interface ConverseResult {
  text: string;
  modelId: string;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
}

export class Bedrock {
  readonly config: AiConfig;
  readonly #client: BedrockRuntimeClient;

  constructor(config: AiConfig) {
    this.config = config;
    this.#client = new BedrockRuntimeClient({
      region: config.region,
      ...(config.apiKey ? { token: { token: config.apiKey }, authSchemePreference: ['httpBearerAuth'] } : {}),
    });
  }

  async converse(opts: { system: string; content: ContentBlock[]; modelId?: string; maxTokens?: number; temperature?: number }): Promise<ConverseResult> {
    const modelId = opts.modelId ?? this.config.textModelId;
    const started = Date.now();
    const messages: Message[] = [{ role: 'user', content: opts.content }];
    const out = await this.#client.send(
      new ConverseCommand({
        modelId,
        system: [{ text: opts.system }],
        messages,
        inferenceConfig: { maxTokens: opts.maxTokens ?? 400, temperature: opts.temperature ?? 0.2 },
      }),
    );
    const text = (out.output?.message?.content ?? []).map((b) => ('text' in b && b.text ? b.text : '')).join('').trim();
    return { text, modelId, latencyMs: Date.now() - started, inputTokens: out.usage?.inputTokens, outputTokens: out.usage?.outputTokens };
  }

  text(system: string, prompt: string, opts: { maxTokens?: number; temperature?: number } = {}): Promise<ConverseResult> {
    return this.converse({ system, content: [{ text: prompt }], ...opts });
  }

  image(system: string, prompt: string, bytes: Uint8Array, format: 'png' | 'jpeg'): Promise<ConverseResult> {
    return this.converse({
      system,
      modelId: this.config.visionModelId,
      content: [{ image: { format, source: { bytes } } }, { text: prompt }],
      maxTokens: 300,
      temperature: 0,
    });
  }
}

/** Pulls the first JSON object out of a model reply (models sometimes wrap it in prose or fences). */
export function extractJson<T>(text: string): T | undefined {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return undefined;
  try {
    return JSON.parse(text.slice(start, end + 1)) as T;
  } catch {
    return undefined;
  }
}
