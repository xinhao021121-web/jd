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
  greetingStyleFor,
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
import type { ResumeTemplate } from '../utils/import';
import { createAppStorage, getBrowserStorage, type CustomResumeRecord } from './storage';

export const VIEW_NAMES = ['resume', 'custom', 'archive', 'generate'] as const;
export type ViewName = (typeof VIEW_NAMES)[number];

export type StreamStatus = 'idle' | 'streaming' | 'done' | 'error' | 'aborted';

export interface GreetingItem {
  index: number;
  style: GreetingStyle;
  text: string;
  edited: boolean;
  /** 本地自检命中的问题（服务端回填），只提示不阻断 */
  issues: string[];
}

interface StreamState {
  status: StreamStatus;
  errorCode: ErrorCode | null;
  elapsedMs: number | null;
  analysis: MatchAnalysis | null;
  /** 本次生成的会话标识，供行为记录归属用 */
  sessionId: string | null;
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
  // 图片导入：撤销栈与校对态都是瞬时状态，不进 localStorage（技术方案增补 二）
  jdUndo: string[];
  jdReviewPending: boolean;
  /** 保真导出用的原文件：只在内存里留存于当次会话，刷新即失效（PRD V0.4 增补 3.8） */
  resumeTemplate: ResumeTemplate | null;
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
  appendJdImport: (text: string) => void;
  undoJdImport: () => boolean;
  setResumeTemplate: (template: ResumeTemplate | null) => void;
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
  analysis: null,
  sessionId: null
};

const IDLE_CUSTOMIZATION: CustomizationState = {
  suggestions: [],
  droppedCount: 0,
  status: 'idle',
  errorCode: null,
  elapsedMs: null,
  analysis: null,
  sessionId: null
};

/** 单次只允许一个进行中的生成，用户中止或发起新生成时旧请求会被取消 */
let activeController: AbortController | null = null;

/** 会话标识：把复制、采纳这类行为归属到产生它的那次生成 */
let sessionSeq = 0;
function createSessionId(prefix: 'g' | 's'): string {
  sessionSeq += 1;
  return `${prefix}${Date.now().toString(36)}-${sessionSeq}`;
}

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
      jdUndo: [],
      jdReviewPending: false,
      resumeTemplate: null,
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

      setResumeTemplate: (template) => set({ resumeTemplate: template }),

      saveResume: () => {
        const text = get().resumeDraft.trim();
        if (text.length < MIN_TEXT_LENGTH) return false;
        if (text === get().resume) return false;
        set({ resume: text, savedAt: Date.now() });
        return true;
      },

      revertResumeDraft: () => set({ resumeDraft: get().resume }),

      // 用户手动编辑 JD 即退出识别校对态（PRD 增补 3.7）
      setJd: (text) => set({ jd: text, jdUpdatedAt: Date.now(), jdReviewPending: false }),

      /** 识别结果只追加不覆盖：JD 为空时填入，非空时按导入顺序接在后面 */
      appendJdImport: (text) => {
        const current = get().jd;
        const appended = current.trim() ? `${current.replace(/\s+$/, '')}\n\n${text}` : text;

        set({
          jd: appended,
          jdUpdatedAt: Date.now(),
          jdUndo: [...get().jdUndo, current],
          jdReviewPending: true
        });
        // 只记可量化属性，不记文件名、图片内容与识别文本（PRD 增补 4.2）
        get().record({ type: 'jd_image_import', at: Date.now(), images: 1, chars: text.length });
      },

      /** 支持连续撤销：每次回退到本次导入前的 JD 内容 */
      undoJdImport: () => {
        const stack = get().jdUndo;
        if (!stack.length) return false;

        set({
          jd: stack[stack.length - 1] ?? '',
          jdUpdatedAt: Date.now(),
          jdUndo: stack.slice(0, -1),
          jdReviewPending: stack.length > 1
        });
        return true;
      },

      record: (event) => set({ events: [...get().events, event].slice(-500) }),

      generateGreeting: async (options = {}) => {
        const state = get();
        if (!canGenerate(state)) return;

        activeController?.abort();
        const controller = new AbortController();
        activeController = controller;
        const sessionId = createSessionId('g');

        set({
          greeting: { ...IDLE_GREETING, status: 'streaming', sessionId },
          view: 'generate'
        });

        if (options.regenerate) {
          state.record({ type: 'regenerate', at: Date.now(), count: 1, sessionId });
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
            elapsedMs: Date.now() - startedAt,
            sessionId
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
        const sessionId = createSessionId('s');
        set({ customization: { ...IDLE_CUSTOMIZATION, status: 'streaming', sessionId } });

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
          // 采纳率的分母：本机发起过几次改写建议生成，每次给出多少条可采纳建议
          get().record({
            type: 'suggest_generate',
            at: Date.now(),
            count: get().customization.suggestions.length,
            sessionId
          });
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
            count: target.adopted ? 1 : -1,
            sessionId: get().customization.sessionId ?? undefined
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
        state.record({
          type: 'custom_save',
          at: Date.now(),
          count: adopted.length,
          sessionId: state.customization.sessionId ?? undefined
        });
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
    const items = get().greeting.items;
    set({
      greeting: {
        ...get().greeting,
        items: [
          ...items,
          {
            // index 与 style 按到达顺序本地赋值：模型不输出或标错都不影响展示
            index: event.index ?? items.length,
            style: event.style ?? greetingStyleFor(items.length),
            text: event.text,
            issues: event.issues ?? [],
            edited: false
          }
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
      suggestions: [
        ...current.suggestions,
        { ...accepted, id: `s${current.suggestions.length}`, issues: event.issues ?? [] }
      ]
    }
  });
}
