/**
 * localStorage 读写层（技术方案 5.4 / 5.5）。
 * 键名统一前缀与版本号；读取时用 Zod 校验，校验失败回退默认值并保留原始数据，
 * 避免一次解析失败就把用户长期维护的简历清空。
 */
import { z } from 'zod';
import {
  MAX_CUSTOM_RESUMES,
  TelemetryEventSchema,
  type TelemetryEvent
} from '@zhipin/shared';

export const STORAGE_KEYS = {
  resume: 'zhipin-assistant:v1:resume',
  jd: 'zhipin-assistant:v1:jd',
  customResumes: 'zhipin-assistant:v1:customResumes',
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
  events: [],
  sidebarCollapsed: false
};

function readKey<T>(storage: Storage, key: string, schema: z.ZodType<T>, fallback: T): T {
  const raw = storage.getItem(key);
  if (raw === null) return fallback;

  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
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
  const events = readKey(storage, STORAGE_KEYS.events, EventsSliceSchema, []);
  const ui = readKey(storage, STORAGE_KEYS.ui, UiSliceSchema, { sidebarCollapsed: false });

  return {
    resume: resume.text,
    savedAt: resume.savedAt,
    resumeDraft: resume.draft ?? '',
    jd: jd.text,
    jdUpdatedAt: jd.updatedAt,
    archive,
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
