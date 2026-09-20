/**
 * localStorage 读写层（技术方案 5.4 / 5.5）。
 * 键名统一前缀与版本号；读取时用 Zod 校验，校验失败回退默认值并保留原始数据，
 * 避免一次解析失败就把用户长期维护的简历清空。
 */
import { z } from 'zod';
import {
  GREETING_STYLES,
  MAX_GREETING_HISTORY,
  MAX_CUSTOM_RESUMES,
  TelemetryEventSchema,
  type TelemetryEvent
} from '@zhipin/shared';

export const STORAGE_KEYS = {
  resume: 'zhipin-assistant:v1:resume',
  jd: 'zhipin-assistant:v1:jd',
  customResumes: 'zhipin-assistant:v1:customResumes',
  greetingHistory: 'zhipin-assistant:v1:greetingHistory',
  events: 'zhipin-assistant:v1:events',
  ui: 'zhipin-assistant:v1:ui'
} as const;

export const MAX_STORED_EVENTS = 500;

export const CustomResumeRecordSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  nameEdited: z.boolean(),
  jdText: z.string(),
  content: z.string().min(1),
  adoptedCount: z.number().int().nonnegative(),
  charCount: z.number().int().nonnegative(),
  createdAt: z.number()
});
export type CustomResumeRecord = z.infer<typeof CustomResumeRecordSchema>;

const MatchAnalysisSchema = z.object({
  requirements: z.array(z.string()),
  matched: z.array(z.string()),
  missing: z.array(z.string()),
  lowMatch: z.boolean()
});

const GreetingHistoryItemSchema = z.object({
  /** 话术在本次生成里的序号，copiedIndexes 与它对应 */
  index: z.number().int().nonnegative(),
  style: z.enum(GREETING_STYLES),
  text: z.string(),
  edited: z.boolean()
});

/** 话术历史记录：一次生成一条，含当时的三条候选与对应 JD（PRD V0.5 增补 3.9） */
export const GreetingHistoryRecordSchema = z.object({
  id: z.string().min(1),
  /** 本次生成的会话标识，同一次生成只留一条记录 */
  sessionId: z.string().min(1),
  jdText: z.string(),
  items: z.array(GreetingHistoryItemSchema).max(3),
  analysis: MatchAnalysisSchema.nullable(),
  /** 复制过哪几条，回看时知道当时发的是哪条 */
  copiedIndexes: z.array(z.number().int().nonnegative()),
  createdAt: z.number(),
  elapsedMs: z.number().nullable()
});
export type GreetingHistoryRecord = z.infer<typeof GreetingHistoryRecordSchema>;

export type GreetingHistoryItem = z.infer<typeof GreetingHistoryItemSchema>;

/**
 * 历史是可丢弃的旁路数据：坏掉的单条丢掉、其余保留，不像简历那样整份回退
 * （技术方案 V0.5 增补 四）。
 */
const GreetingHistorySliceSchema = z.array(z.unknown()).transform((items) =>
  items
    .flatMap((item): GreetingHistoryRecord[] => {
      const parsed = GreetingHistoryRecordSchema.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    })
    .slice(0, MAX_GREETING_HISTORY)
);

const ResumeSliceSchema = z.object({
  text: z.string(),
  savedAt: z.number(),
  /** 未保存的编辑草稿，刷新页面后仍在（PRD 2.3.2） */
  draft: z.string().optional()
});

const JdSliceSchema = z.object({
  text: z.string(),
  updatedAt: z.number()
});

const UiSliceSchema = z.object({
  sidebarCollapsed: z.boolean()
});

const CustomResumesSliceSchema = z.array(CustomResumeRecordSchema).max(MAX_CUSTOM_RESUMES);
const EventsSliceSchema = z.array(TelemetryEventSchema);

/** persist 中间件保存的切片，字段名与 store 保持一致，合并时不需要额外映射 */
export interface PersistedSlice {
  resume: string;
  savedAt: number;
  resumeDraft: string;
  jd: string;
  jdUpdatedAt: number;
  archive: CustomResumeRecord[];
  greetingHistory: GreetingHistoryRecord[];
  events: TelemetryEvent[];
  sidebarCollapsed: boolean;
}

const EMPTY_SLICE: PersistedSlice = {
  resume: '',
  savedAt: 0,
  resumeDraft: '',
  jd: '',
  jdUpdatedAt: 0,
  archive: [],
  greetingHistory: [],
  events: [],
  sidebarCollapsed: false
};

/**
 * schema 用 `ZodTypeAny`：带 transform 的 schema 推断不出与 T 一致的输入输出类型，
 * 一致性由调用点与单测保证（见技术方案 V0.5 增补 四）。
 */
function readKey<T>(storage: Storage, key: string, schema: z.ZodTypeAny, fallback: T): T {
  const raw = storage.getItem(key);
  if (raw === null) return fallback;

  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data as T;
  } catch {
    /* 解析失败按校验失败处理 */
  }

  // 保留原始数据，便于事后排查或人工恢复
  try {
    storage.setItem(`${key}:invalid`, raw);
  } catch {
    /* 容量不足等场景下忽略 */
  }
  return fallback;
}

/** 读取本地状态；完全没有任何记录时返回 null，交给 store 使用默认值 */
export function readSlice(storage: Storage): PersistedSlice | null {
  const hasAny = Object.values(STORAGE_KEYS).some((key) => storage.getItem(key) !== null);
  if (!hasAny) return null;

  const resume = readKey(storage, STORAGE_KEYS.resume, ResumeSliceSchema, {
    text: '',
    savedAt: 0,
    draft: ''
  });
  const jd = readKey(storage, STORAGE_KEYS.jd, JdSliceSchema, { text: '', updatedAt: 0 });
  const archive = readKey(storage, STORAGE_KEYS.customResumes, CustomResumesSliceSchema, []);
  const greetingHistory = readKey(
    storage,
    STORAGE_KEYS.greetingHistory,
    GreetingHistorySliceSchema,
    []
  );
  const events = readKey(storage, STORAGE_KEYS.events, EventsSliceSchema, []);
  const ui = readKey(storage, STORAGE_KEYS.ui, UiSliceSchema, { sidebarCollapsed: false });

  return {
    resume: resume.text,
    savedAt: resume.savedAt,
    resumeDraft: resume.draft ?? '',
    jd: jd.text,
    jdUpdatedAt: jd.updatedAt,
    archive,
    greetingHistory,
    events: events.slice(-MAX_STORED_EVENTS),
    sidebarCollapsed: ui.sidebarCollapsed
  };
}

export function writeSlice(storage: Storage, slice: PersistedSlice): void {
  storage.setItem(
    STORAGE_KEYS.resume,
    JSON.stringify({ text: slice.resume, savedAt: slice.savedAt, draft: slice.resumeDraft })
  );
  storage.setItem(STORAGE_KEYS.jd, JSON.stringify({ text: slice.jd, updatedAt: slice.jdUpdatedAt }));
  storage.setItem(STORAGE_KEYS.customResumes, JSON.stringify(slice.archive));
  storage.setItem(STORAGE_KEYS.greetingHistory, JSON.stringify(slice.greetingHistory));
  storage.setItem(
    STORAGE_KEYS.events,
    JSON.stringify(slice.events.slice(-MAX_STORED_EVENTS))
  );
  storage.setItem(
    STORAGE_KEYS.ui,
    JSON.stringify({ sidebarCollapsed: slice.sidebarCollapsed })
  );
}

export function clearSlice(storage: Storage): void {
  Object.values(STORAGE_KEYS).forEach((key) => storage.removeItem(key));
}

/** 供 zustand persist 使用的存储适配器：把切片拆成文档约定的多个键 */
export function createAppStorage(storage: Storage) {
  return {
    getItem(): string | null {
      const slice = readSlice(storage);
      if (!slice) return null;
      return JSON.stringify({ state: slice, version: 1 });
    },
    setItem(_name: string, value: string): void {
      try {
        const parsed = JSON.parse(value) as { state?: Partial<PersistedSlice> };
        writeSlice(storage, { ...EMPTY_SLICE, ...(parsed.state ?? {}) });
      } catch {
        /* 忽略写入失败，例如隐私模式或容量不足 */
      }
    },
    removeItem(): void {
      clearSlice(storage);
    }
  };
}

export function getBrowserStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
