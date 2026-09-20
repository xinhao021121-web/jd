/**
 * 前后端共用的类型、错误码与常量。
 * 这里是 PRD 2.3.1 文案与 4.1/4.3 指标的唯一定义处，前端与服务端都从这里引用。
 */
import { z } from 'zod';

/** 输入长度下限，前端校验与服务端校验同源（PRD 3.1、技术方案 5.3） */
export const MIN_TEXT_LENGTH = 20;

/** 定制简历容量上限（PRD 3.4） */
export const MAX_CUSTOM_RESUMES = 20;

/** 定制简历记录名称长度上限（PRD 3.4） */
export const MAX_TITLE_LENGTH = 40;

/** 话术长度区间（PRD 3.2） */
export const GREETING_LENGTH = { min: 100, max: 160 } as const;

/** 限流与每日配额（PRD 4.1） */
export const RATE_LIMIT = { perMinute: 10, perDay: 100 } as const;

/** 性能预算：首字 ≤5 秒、完整结果 ≤30 秒（PRD 4.3） */
export const LATENCY_BUDGET = { firstTokenMs: 5000, totalMs: 30000 } as const;

/** 简历文件导入：支持范围与体积上限（PRD 增补 3.6） */
export const MAX_RESUME_FILE_BYTES = 10 * 1024 * 1024;
export const RESUME_FILE_EXTENSIONS = ['txt', 'md', 'markdown', 'docx', 'pdf'] as const;

/** JD 图片导入：体积、张数与压缩口径（PRD 增补 3.7） */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_COUNT = 3;
export const MAX_IMAGE_EDGE = 1600;
export const IMAGE_JPEG_QUALITY = 0.8;
export const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

/** /api/vision 入参上限：单图 32 MiB 按 base64 折算（技术方案增补 3.1、四） */
export const MAX_IMAGE_DATA_URL_LENGTH = 45 * 1024 * 1024;

/** 单张图片识别耗时上限（技术方案增补 3.1：15 秒） */
export const VISION_TIMEOUT_MS = 15_000;

/* ------------------------------ 错误码 ------------------------------ */

export const ERROR_CODES = [
  'INVALID_INPUT',
  'RATE_LIMITED',
  'UPSTREAM_ERROR',
  'INVALID_OUTPUT',
  'FIRST_TOKEN_TIMEOUT',
  'TOTAL_TIMEOUT',
  'UNSUPPORTED_FILE',
  'FILE_TOO_LARGE',
  'NO_TEXT_LAYER',
  'PARSE_EMPTY',
  'VISION_FAILED',
  'VISION_EMPTY',
  'VISION_UNAVAILABLE'
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const ERROR_HTTP_STATUS: Record<ErrorCode, number> = {
  INVALID_INPUT: 400,
  RATE_LIMITED: 429,
  UPSTREAM_ERROR: 502,
  INVALID_OUTPUT: 502,
  FIRST_TOKEN_TIMEOUT: 504,
  TOTAL_TIMEOUT: 504,
  UNSUPPORTED_FILE: 400,
  FILE_TOO_LARGE: 400,
  NO_TEXT_LAYER: 422,
  PARSE_EMPTY: 422,
  VISION_FAILED: 502,
  VISION_EMPTY: 502,
  VISION_UNAVAILABLE: 502
};

/** 前端文案，与 PRD 2.3.1 全局异常处理表（含 V0.3 增补新增的 10 条）逐条对应 */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  INVALID_INPUT: '请先粘贴简历和 JD 内容',
  RATE_LIMITED: '请求过于频繁，请稍后再试',
  UPSTREAM_ERROR: '生成失败，请稍后重试',
  INVALID_OUTPUT: '生成结果异常，请重新生成',
  FIRST_TOKEN_TIMEOUT: '生成超时，请重试',
  TOTAL_TIMEOUT: '生成超时，请重试',
  UNSUPPORTED_FILE: '暂不支持该文件格式，请导入 PDF、Word、TXT 或 Markdown 文件',
  FILE_TOO_LARGE: '文件超过 10MB，请压缩后重试（图片为 5MB）',
  NO_TEXT_LAYER: '这份 PDF 没有可提取的文字，可能是扫描件',
  PARSE_EMPTY: '没有从文件里读到内容，请确认文件内容后重试',
  VISION_FAILED: '图片识别失败，可重试一次，或直接粘贴 JD 文本',
  VISION_EMPTY: '没有识别到文字，建议截取更清晰的范围',
  VISION_UNAVAILABLE: '图片识别暂不可用，直接粘贴 JD 文本不影响生成'
};

/** /api/vision 入参不合法时的文案（前端已先做格式与体积校验） */
export const VISION_INPUT_MESSAGE = '图片数据无效，请重新选择或截图后再试';

/** 图片识别完成后进入校对态的提示（PRD 增补 3.7） */
export const JD_REVIEW_NOTICE = '图片识别完成，请核对公司名称、岗位名称与技术名词后再生成';

/* ------------------------------ 状态文案 ------------------------------ */

export const NO_RESUME_NOTICE = '还没有保存简历，先到「我的简历」填写并保存';
export const SHORT_INPUT_NOTICE = '内容较短，生成结果可能不够精准';
export const ABORTED_NOTICE = '已中止，可重新生成';
export const LOW_MATCH_NOTICE =
  '简历与该岗位直接匹配点较少，话术已尽量贴合，未编造简历中没有的经历';
export const LOCKED_NOTICE = '个人信息与教育经历不会被改动，未识别的区块一律按锁定处理';
export const DATA_FLOW_NOTICE = '简历与 JD 会发送给模型服务商（DeepSeek）用于生成，服务端不保存';

export const uncoveredNotice = (items: string[]): string =>
  `岗位要求的「${items.join('、')}」在简历里找不到依据，建议不要写入简历`;

/* ------------------------------ 生成协议 ------------------------------ */

export const TASK_KINDS = ['greeting', 'suggestions'] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

export const LlmRequestSchema = z.object({
  task: z.enum(TASK_KINDS),
  resume: z.string().min(MIN_TEXT_LENGTH),
  jd: z.string().min(MIN_TEXT_LENGTH)
});
export type LlmRequest = z.infer<typeof LlmRequestSchema>;

export const GREETING_STYLES = ['技能匹配型', '经历相关型', '简短直接型'] as const;
export type GreetingStyle = (typeof GREETING_STYLES)[number];

export const SUGGESTION_TYPES = ['术语对齐', '技能补充', '关键词补充'] as const;
export type SuggestionType = (typeof SUGGESTION_TYPES)[number];

export const AnalysisEventSchema = z.object({
  type: z.literal('analysis'),
  requirements: z.array(z.string()),
  matched: z.array(z.string()),
  missing: z.array(z.string()),
  lowMatch: z.boolean()
});

export const GreetingItemEventSchema = z.object({
  type: z.literal('item'),
  kind: z.literal('greeting'),
  index: z.number().int().nonnegative(),
  style: z.enum(GREETING_STYLES),
  text: z.string().min(1)
});

export const SuggestionItemEventSchema = z.object({
  type: z.literal('item'),
  kind: z.literal('suggestion'),
  index: z.number().int().nonnegative(),
  section: z.string().min(1),
  before: z.string().min(1),
  after: z.string().min(1),
  reason: z.string().min(1),
  suggestionType: z.enum(SUGGESTION_TYPES).optional()
});

/** 模型必须按这些事件类型逐行输出 NDJSON（技术方案 5.2） */
export const OutputEventSchema = z.union([
  AnalysisEventSchema,
  GreetingItemEventSchema,
  SuggestionItemEventSchema
]);
export type OutputEvent = z.infer<typeof OutputEventSchema>;
export type AnalysisEvent = z.infer<typeof AnalysisEventSchema>;
export type GreetingItemEvent = z.infer<typeof GreetingItemEventSchema>;
export type SuggestionItemEvent = z.infer<typeof SuggestionItemEventSchema>;

export const DoneEventSchema = z.object({
  type: z.literal('done'),
  elapsedMs: z.number().nonnegative()
});

export const ErrorEventSchema = z.object({
  type: z.literal('error'),
  code: z.enum(ERROR_CODES),
  message: z.string()
});

/** 服务端发往浏览器的 SSE 事件（技术方案 6.2） */
export const StreamEventSchema = z.union([
  AnalysisEventSchema,
  GreetingItemEventSchema,
  SuggestionItemEventSchema,
  DoneEventSchema,
  ErrorEventSchema
]);
export type StreamEvent = z.infer<typeof StreamEventSchema>;
export type DoneEvent = z.infer<typeof DoneEventSchema>;
export type ErrorEvent = z.infer<typeof ErrorEventSchema>;

export function serializeSseEvent(event: StreamEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

export function errorEvent(code: ErrorCode): ErrorEvent {
  return { type: 'error', code, message: ERROR_MESSAGES[code] };
}

/* ------------------------------ 行为记录 ------------------------------ */

export const TELEMETRY_EVENT_TYPES = [
  'generate',
  'copy',
  'regenerate',
  'suggest_generate',
  'suggest_adopt',
  'custom_save',
  'resume_import',
  'jd_image_import',
  'error'
] as const;
export type TelemetryEventType = (typeof TELEMETRY_EVENT_TYPES)[number];

export const TelemetryEventSchema = z.object({
  type: z.enum(TELEMETRY_EVENT_TYPES),
  at: z.number(),
  /** 一次生成的标识：把复制、采纳等行为归属到产生它的那次生成 */
  sessionId: z.string().optional(),
  jdLength: z.number().optional(),
  elapsedMs: z.number().optional(),
  index: z.number().optional(),
  edited: z.boolean().optional(),
  count: z.number().optional(),
  section: z.string().optional(),
  /** 导入事件只记可量化属性：格式、字数与张数，不含文件名与内容（PRD 增补 4.2） */
  format: z.string().optional(),
  chars: z.number().optional(),
  images: z.number().optional(),
  errorType: z.string().optional()
});
export type TelemetryEvent = z.infer<typeof TelemetryEventSchema>;
