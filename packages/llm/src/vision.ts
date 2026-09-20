/**
 * 视觉识别客户端：把 JD 截图转成纯文本（技术方案增补 二、三、四）。
 * 与文本客户端共用同一套 OpenAI 兼容接口与密钥，只是 content 由字符串改成 blocks 数组，
 * 且图片只能放在 user 消息里（放 system 会被官方拒绝）。
 */
import { LlmUpstreamError, type FetchLike } from './client';

export type VisionContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface VisionMessage {
  role: 'system' | 'user';
  content: string | VisionContentBlock[];
}

export interface VisionClientConfig {
  baseUrl: string;
  apiKey: string;
  /** 视觉模型，由调用方传入（服务端取 DEEPSEEK_VISION_MODEL） */
  model: string;
  fetchImpl?: FetchLike;
  temperature?: number;
}

export interface VisionResult {
  /** 识别出的原文，未做任何改写 */
  text: string;
  elapsedMs: number;
}

/** 只做图片转文本：不总结、不改写、不补充，避免把模型的理解混进 JD */
export const VISION_SYSTEM_PROMPT = [
  '你是招聘信息截图转文本的工具，只做一件事：把图片里的文字原样转成纯文本。',
  '硬性规则：',
  '1. 只输出图片中真实存在的文字，不总结、不改写、不补充、不翻译、不解释；',
  '2. 按阅读顺序输出，保留自然换行与段落结构，序号与符号一并保留；',
  '3. 公司名称、岗位名称、技术名词按图片原样输出，看不清的字保留最接近的写法，不要凭空猜测；',
  '4. 图片里没有文字时输出空内容，不要编造；',
  '5. 不要输出 Markdown 代码块、标题或任何说明文字。'
].join('\n');

export const VISION_USER_PROMPT = '把这张招聘信息截图里的文字原样输出。';

/** 规则写 system，指令与图片写 user；detail 保持默认，避免小字被降采样 */
export function buildVisionMessages(imageDataUrl: string): VisionMessage[] {
  return [
    { role: 'system', content: VISION_SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        { type: 'text', text: VISION_USER_PROMPT },
        { type: 'image_url', image_url: { url: imageDataUrl } }
      ]
    }
  ];
}

export function createVisionClient(config: VisionClientConfig) {
  const fetchImpl = (config.fetchImpl ?? globalThis.fetch) as FetchLike;
  const endpoint = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`;

  return {
    endpoint,

    /** 非流式：识别结果要整体回填给用户校对，逐字渲染没有价值（技术方案增补 3.1） */
    async recognize(
      imageDataUrl: string,
      options: { signal?: AbortSignal } = {}
    ): Promise<VisionResult> {
      const startedAt = Date.now();
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`
        },
        body: JSON.stringify({
          model: config.model,
          stream: false,
          temperature: config.temperature ?? 0,
          messages: buildVisionMessages(imageDataUrl)
        }),
        signal: options.signal
      });

      if (!response.ok) {
        throw new LlmUpstreamError(`视觉模型返回状态 ${response.status}`, response.status);
      }

      const payload = (await response.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const text = payload.choices?.[0]?.message?.content ?? '';

      return { text, elapsedMs: Date.now() - startedAt };
    }
  };
}

export type VisionClient = ReturnType<typeof createVisionClient>;
