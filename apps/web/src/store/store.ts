/**
 * 全局状态（技术方案 5.4）：resume / jd / suggestions / archive / ui 五个切片，
 * 其中简历、JD、定制简历存档、行为记录与侧边栏状态写入 localStorage。
 * 生成结果不持久化：刷新后回到未生成状态，但输入与存档都在。
 */
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  composeCustomResume,
  extractJdTitle,
  parseResume,
  planSuggestions,
  type MatchAnalysis,
  type Suggestion
} from '@zhipin/core';
import {
  MAX_CUSTOM_RESUMES,
  MAX_TITLE_LENGTH,
  MIN_TEXT_LENGTH,
  type ErrorCode,
  type GreetingStyle,
  type StreamEvent,
  type TelemetryEvent
} from '@zhipin/shared';
import { streamTask } from '../api/llm';
import { createAppStorage, getBrowserStorage, type CustomResumeRecord } from './storage';

export const VIEW_NAMES = ['resume', 'custom', 'archive', 'generate'] as const;
export type ViewName = (typeof VIEW_NAMES)[number];

export type StreamStatus = 'idle' | 'streaming' | 'done' | 'error' | 'aborted';

export interface GreetingItem {
  index: number;
  style: GreetingStyle;
  text: string;
  edited: boolean;
}

interface StreamState {
  status: StreamStatus;
  errorCode: ErrorCode | null;
  elapsedMs: number | null;
  analysis: MatchAnalysis | null;
}

export interface GreetingState extends StreamState {
  items: GreetingItem[];
}

export interface CustomizationState extends StreamState {
  suggestions: Suggestion[];
  droppedCount: number;
}

export interface AppStore {
  // 我的简历：已保存内容与编辑草稿分离，生成只读取已保存内容
  resume: string;
  savedAt: number;
  resumeDraft: string;
  // 当前 JD：生成打招呼与按 JD 改简历共用
  jd: string;
  jdUpdatedAt: number;
  // 结果
  greeting: GreetingState;
  customization: CustomizationState;
  // 存档
  archive: CustomResumeRecord[];
  selectedArchiveId: string | null;
  // 界面
  view: ViewName;
  sidebarCollapsed: boolean;
  // 行为记录
  events: TelemetryEvent[];

  setView: (view: ViewName) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setResumeDraft: (text: string) => void;
  saveResume: () => boolean;
  revertResumeDraft: () => void;
  setJd: (text: string) => void;
  generateGreeting: (options?: { regenerate?: boolean }) => Promise<void>;
  generateSuggestions: () => Promise<void>;
  abortGeneration: () => void;
  updateGreetingItem: (index: number, text: string) => void;
  resetCustomization: () => void;
  toggleSuggestion: (id: string) => void;
  saveCustomResume: () => CustomResumeRecord | null;
  selectArchive: (id: string | null) => void;
  renameArchive: (id: string, name: string) => void;
  removeArchive: (id: string) => boolean;
  record: (event: TelemetryEvent) => void;
}

const IDLE_GREETING: GreetingState = {
  items: [],
  status: 'idle',
  errorCode: null,
  elapsedMs: null,
  analysis: null
};

const IDLE_CUSTOMIZATION: CustomizationState = {
  suggestions: [],
  droppedCount: 0,
  status: 'idle',
  errorCode: null,
  elapsedMs: null,
  analysis: null
};

/** 单次只允许一个进行中的生成，用户中止或发起新生成时旧请求会被取消 */
let activeController: AbortController | null = null;

export function canGenerate(state: { resume: string; jd: string }): boolean {
  return state.resume.trim().length >= MIN_TEXT_LENGTH && state.jd.trim().length >= MIN_TEXT_LENGTH;
}

/** 记录名称：用户手动改过就用用户的，留空则回退到从 JD 解析出的「公司 · 岗位」 */
export function archiveTitle(record: CustomResumeRecord): string {
  return record.name.trim() || extractJdTitle(record.jdText);
}

export function adoptedSuggestions(suggestions: Suggestion[]): Suggestion[] {
  return suggestions.filter((suggestion) => suggestion.adopted);
}

export function composePreview(state: {
  resume: string;
  customization: CustomizationState;
}): string {
  if (!state.customization.suggestions.length) return '';
  return composeCustomResume(state.resume, adoptedSuggestions(state.customization.suggestions));
}

export const useAppStore = create<AppStore>()(
  persist(
    (set, get) => ({
      resume: '',
      savedAt: 0,
      resumeDraft: '',
      jd: '',
      jdUpdatedAt: 0,
      greeting: IDLE_GREETING,
      customization: IDLE_CUSTOMIZATION,
      archive: [],
      selectedArchiveId: null,
      view: 'resume',
      sidebarCollapsed: false,
      events: [],

      setView: (view) => set({ view }),

      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),

      setResumeDraft: (text) => set({ resumeDraft: text }),

      saveResume: () => {
        const text = get().resumeDraft.trim();
        if (text.length < MIN_TEXT_LENGTH) return false;
        if (text === get().resume) return false;
        set({ resume: text, savedAt: Date.now() });
        return true;
      },

      revertResumeDraft: () => set({ resumeDraft: get().resume }),

      setJd: (text) => set({ jd: text, jdUpdatedAt: Date.now() }),

      record: (event) => set({ events: [...get().events, event].slice(-500) }),

      generateGreeting: async (options = {}) => {
        const state = get();
        if (!canGenerate(state)) return;

        activeController?.abort();
        const controller = new AbortController();
        activeController = controller;

        set({
          greeting: { ...IDLE_GREETING, status: 'streaming' },
          view: 'generate'
        });

        if (options.regenerate) {
          state.record({ type: 'regenerate', at: Date.now(), count: 1 });
        }

        const startedAt = Date.now();
        const outcome = await streamTask(
          'greeting',
          { resume: state.resume, jd: state.jd },
          {
            signal: controller.signal,
            onEvent: (event) => applyGreetingEvent(event, set, get)
          }
        );

        if (activeController !== controller) return;
        activeController = null;

        if (outcome.status === 'done') {
          set({ greeting: { ...get().greeting, status: 'done' } });
          get().record({
            type: 'generate',
            at: Date.now(),
            jdLength: state.jd.length,
            elapsedMs: Date.now() - startedAt
          });
        } else if (outcome.status === 'aborted') {
          set({ greeting: { ...get().greeting, status: 'aborted' } });
        } else {
          set({ greeting: { ...get().greeting, status: 'error', errorCode: outcome.code } });
          get().record({ type: 'error', at: Date.now(), errorType: outcome.code });
        }
      },

      generateSuggestions: async () => {
        const state = get();
        if (!canGenerate(state)) return;

        activeController?.abort();
        const controller = new AbortController();
        activeController = controller;

        const blocks = parseResume(state.resume);
        set({ customization: { ...IDLE_CUSTOMIZATION, status: 'streaming' } });

        const outcome = await streamTask(
          'suggestions',
          { resume: state.resume, jd: state.jd },
          {
            signal: controller.signal,
            onEvent: (event) => applySuggestionEvent(event, blocks, set, get)
          }
        );

        if (activeController !== controller) return;
        activeController = null;

        if (outcome.status === 'done') {
          set({ customization: { ...get().customization, status: 'done' } });
        } else if (outcome.status === 'aborted') {
          set({ customization: { ...get().customization, status: 'aborted' } });
        } else {
          set({
            customization: { ...get().customization, status: 'error', errorCode: outcome.code }
          });
          get().record({ type: 'error', at: Date.now(), errorType: outcome.code });
        }
      },

      abortGeneration: () => {
        activeController?.abort();
      },

      updateGreetingItem: (index, text) =>
        set({
          greeting: {
            ...get().greeting,
            items: get().greeting.items.map((item) =>
              item.index === index ? { ...item, text, edited: true } : item
            )
          }
        }),

      resetCustomization: () => set({ customization: IDLE_CUSTOMIZATION }),

      toggleSuggestion: (id) => {
        const suggestions = get().customization.suggestions.map((suggestion) =>
          suggestion.id === id ? { ...suggestion, adopted: !suggestion.adopted } : suggestion
        );
        const target = suggestions.find((suggestion) => suggestion.id === id);

        set({ customization: { ...get().customization, suggestions } });

        if (target) {
          get().record({
            type: 'suggest_adopt',
            at: Date.now(),
            section: target.section,
            count: target.adopted ? 1 : -1
          });
        }
      },

      saveCustomResume: () => {
        const state = get();
        const adopted = adoptedSuggestions(state.customization.suggestions);
        if (!adopted.length || !state.resume) return null;

        const content = composeCustomResume(state.resume, adopted);
        const record: CustomResumeRecord = {
          id: `c${Date.now()}${Math.floor(Math.random() * 10_000)}`,
          name: extractJdTitle(state.jd),
          nameEdited: false,
          jdText: state.jd,
          content,
          adoptedCount: adopted.length,
          charCount: [...content].length,
          createdAt: Date.now()
        };

        // 容量上限：超出后移除最早的一份（PRD 3.4）
        const archive = [record, ...state.archive].slice(0, MAX_CUSTOM_RESUMES);
        set({ archive, selectedArchiveId: record.id });
        state.record({ type: 'custom_save', at: Date.now(), count: adopted.length });
        return record;
      },

      selectArchive: (id) => set({ selectedArchiveId: id }),

      renameArchive: (id, name) => {
        const trimmed = name.trim().slice(0, MAX_TITLE_LENGTH);
        set({
          archive: get().archive.map((record) =>
            record.id === id
              ? { ...record, name: trimmed, nameEdited: trimmed.length > 0 }
              : record
          )
        });
      },

      removeArchive: (id) => {
        const before = get().archive;
        const archive = before.filter((record) => record.id !== id);
        if (archive.length === before.length) return false;

        set({
          archive,
          selectedArchiveId:
            get().selectedArchiveId === id ? (archive[0]?.id ?? null) : get().selectedArchiveId
        });
        return true;
      }
    }),
    {
      name: 'zhipin-assistant',
      version: 1,
      storage: createJSONStorage(() => {
        const storage = getBrowserStorage();
        if (!storage) {
          // 无 localStorage（如 SSR 或隐私模式）时退化为内存存储
          const memory = new Map<string, string>();
          return {
            getItem: (key: string) => memory.get(key) ?? null,
            setItem: (key: string, value: string) => void memory.set(key, value),
            removeItem: (key: string) => void memory.delete(key)
          };
        }
        return createAppStorage(storage);
      }),
      partialize: (state) => ({
        resume: state.resume,
        savedAt: state.savedAt,
        resumeDraft: state.resumeDraft,
        jd: state.jd,
        jdUpdatedAt: state.jdUpdatedAt,
        archive: state.archive,
        events: state.events,
        sidebarCollapsed: state.sidebarCollapsed
      })
    }
  )
);

/** 把 SSE 事件写入 store：分析置顶，话术逐条追加 */
function applyGreetingEvent(
  event: StreamEvent,
  set: (partial: Partial<AppStore>) => void,
  get: () => AppStore
): void {
  const greeting = get().greeting;

  if (event.type === 'analysis') {
    set({
      greeting: {
        ...greeting,
        analysis: {
          requirements: event.requirements,
          matched: event.matched,
          missing: event.missing,
          lowMatch: event.lowMatch
        }
      }
    });
    return;
  }

  if (event.type === 'item' && event.kind === 'greeting') {
    set({
      greeting: {
        ...get().greeting,
        items: [
          ...get().greeting.items,
          { index: event.index, style: event.style, text: event.text, edited: false }
        ]
      }
    });
    return;
  }

  if (event.type === 'done') {
    set({ greeting: { ...get().greeting, elapsedMs: event.elapsedMs } });
  }
}

/** 改写建议：只保留能锚定到可改写区块的条目，其余计入 droppedCount */
function applySuggestionEvent(
  event: StreamEvent,
  blocks: ReturnType<typeof parseResume>,
  set: (partial: Partial<AppStore>) => void,
  get: () => AppStore
): void {
  if (event.type === 'analysis') {
    set({
      customization: {
        ...get().customization,
        analysis: {
          requirements: event.requirements,
          matched: event.matched,
          missing: event.missing,
          lowMatch: event.lowMatch
        }
      }
    });
    return;
  }

  if (event.type === 'done') {
    set({ customization: { ...get().customization, elapsedMs: event.elapsedMs } });
    return;
  }

  if (event.type !== 'item' || event.kind !== 'suggestion') return;

  const { suggestions, dropped } = planSuggestions(blocks, [
    {
      section: event.section,
      before: event.before,
      after: event.after,
      reason: event.reason,
      suggestionType: event.suggestionType
    }
  ]);

  const current = get().customization;

  if (!suggestions.length) {
    set({ customization: { ...current, droppedCount: current.droppedCount + dropped.length } });
    return;
  }

  const accepted = suggestions[0] as Suggestion;
  const duplicated = current.suggestions.some(
    (item) => item.before === accepted.before && item.after === accepted.after
  );
  if (duplicated) return;

  set({
    customization: {
      ...current,
      suggestions: [...current.suggestions, { ...accepted, id: `s${current.suggestions.length}` }]
    }
  });
}
