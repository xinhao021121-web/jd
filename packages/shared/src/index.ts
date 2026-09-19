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

/* ------------------------------ 错误码 ------------------------------ */

export const ERROR_CODES = [
  'INVALID_INPUT',
  'RATE_LIMITED',
  'UPSTREAM_ERROR',
  'INVALID_OUTPUT',
  'FIRST_TOKEN_TIMEOUT',
  'TOTAL_TIMEOUT'
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const ERROR_HTTP_STATUS: Record<ErrorCode, number> = {
  INVALID_INPUT: 400,
  RATE_LIMITED: 429,
  UPSTREAM_ERROR: 502,
  INVALID_OUTPUT: 502,
  FIRST_TOKEN_TIMEOUT: 504,
  TOTAL_TIMEOUT: 504
};

/** 前端文案，与 PRD 2.3.1 全局异常处理表逐条对应 */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  INVALID_INPUT: '请先粘贴简历和 JD 内容',
  RATE_LIMITED: '请求过于频繁，请稍后再试',
  UPSTREAM_ERROR: '生成失败，请稍后重试',
  INVALID_OUTPUT: '生成结果异常，请重新生成',
  FIRST_TOKEN_TIMEOUT: '生成超时，请重试',
  TOTAL_TIMEOUT: '生成超时，请重试'
};

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
  errorType: z.string().optional()
});
export type TelemetryEvent = z.infer<typeof TelemetryEventSchema>;
