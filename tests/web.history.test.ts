import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_GREETING_HISTORY } from '@zhipin/shared';
import { SAMPLE_JD } from './fixtures';
import type { GreetingHistoryRecord } from '../apps/web/src/store/storage';

/** 最小可用的 localStorage 桩，与 web.store.test.ts 保持同一套写法 */
function createMemoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, String(value)),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
    key: (index: number) => [...map.keys()][index] ?? null,
    get length() {
      return map.size;
    }
  } satisfies Storage;
}

const storage = createMemoryStorage();
Object.defineProperty(globalThis, 'localStorage', {
  value: storage,
  configurable: true,
  writable: true
});

const { useAppStore } = await import('../apps/web/src/store/store');
const { STORAGE_KEYS, createAppStorage, readSlice } = await import(
  '../apps/web/src/store/storage'
);

const store = () => useAppStore.getState();

const TEXTS = ['第一条话术正文内容', '第二条话术正文内容', '第三条话术正文内容'];

/** 直接摆出一次生成完成后的状态，模拟「用户已经拿到 3 条话术」 */
function finishGeneration(sessionId: string, texts = TEXTS): void {
  useAppStore.setState({
    jd: SAMPLE_JD,
    greeting: {
      status: 'done',
      errorCode: null,
      elapsedMs: 1900,
      analysis: {
        requirements: ['Java'],
        matched: ['Java'],
        missing: ['Kubernetes'],
        lowMatch: false
      },
      sessionId,
      items: texts.map((text, index) => ({
        index,
        style: '技能匹配型',
        text,
        edited: false,
        issues: []
      }))
    }
  });
}

beforeEach(() => {
  storage.clear();
  useAppStore.setState({
    resume: '',
    resumeDraft: '',
    jd: '',
    greetingHistory: [],
    selectedHistoryId: null,
    greeting: {
      items: [],
      status: 'idle',
      errorCode: null,
      elapsedMs: null,
      analysis: null,
      sessionId: null
    }
  });
});

describe('复制即入历史', () => {
  it('首次复制新建一条记录，含三条候选、匹配分析与该岗位 JD', () => {
    finishGeneration('g1');
    const record = store().saveGreetingToHistory(0);

    expect(record).not.toBeNull();
    expect(store().greetingHistory).toHaveLength(1);
    expect(record).toMatchObject({ sessionId: 'g1', jdText: SAMPLE_JD, copiedIndexes: [0] });
    expect(record?.items).toHaveLength(3);
    expect(record?.items[1]?.text).toBe(TEXTS[1]);
    expect(record?.analysis?.matched).toEqual(['Java']);
  });

  it('同一次生成再次复制只合并标记与内容，不新增记录', () => {
    finishGeneration('g1');
    store().saveGreetingToHistory(0);

    // 用户先改了第二条再复制：历史里存的应是改后的文本
    store().updateGreetingItem(1, '编辑过的第二条');
    store().saveGreetingToHistory(1);

    expect(store().greetingHistory).toHaveLength(1);
    expect(store().greetingHistory[0]?.copiedIndexes).toEqual([0, 1]);
    expect(store().greetingHistory[0]?.items[1]?.text).toBe('编辑过的第二条');
    expect(store().greetingHistory[0]?.items[1]?.edited).toBe(true);
  });

  it('重新生成后复制属于新的一次生成，记为新记录', () => {
    finishGeneration('g1');
    store().saveGreetingToHistory(0);
    finishGeneration('g2', ['重新生成的第一条', '重新生成的第二条', '重新生成的第三条']);
    store().saveGreetingToHistory(2);

    expect(store().greetingHistory).toHaveLength(2);
    expect(store().greetingHistory.map((record) => record.sessionId)).toEqual(['g2', 'g1']);
  });

  it('同一会话重复复制同一条不会重复记录序号', () => {
    finishGeneration('g1');
    store().saveGreetingToHistory(0);
    store().saveGreetingToHistory(0);

    expect(store().greetingHistory[0]?.copiedIndexes).toEqual([0]);
  });

  it('没有生成结果时不写空记录', () => {
    expect(store().saveGreetingToHistory(0)).toBeNull();
    expect(store().greetingHistory).toEqual([]);

    // 有结果但没有会话标识（异常路径）同样不写
    finishGeneration('g1');
    useAppStore.setState({ greeting: { ...store().greeting, sessionId: null } });
    expect(store().saveGreetingToHistory(0)).toBeNull();
    expect(store().greetingHistory).toEqual([]);
  });

  it('超过 20 条时移除最早的一条', () => {
    for (let index = 0; index < MAX_GREETING_HISTORY + 3; index += 1) {
      finishGeneration(`g${index}`);
      store().saveGreetingToHistory(0);
    }

    expect(store().greetingHistory).toHaveLength(MAX_GREETING_HISTORY);
    expect(store().greetingHistory[0]?.sessionId).toBe(`g${MAX_GREETING_HISTORY + 2}`);
    expect(store().greetingHistory.at(-1)?.sessionId).toBe('g3');
  });
});

describe('历史的查看与清理', () => {
  it('删除单条只影响那一条，并自动选中剩下最新的一条', () => {
    finishGeneration('g1');
    const first = store().saveGreetingToHistory(0);
    finishGeneration('g2');
    const second = store().saveGreetingToHistory(0);

    expect(store().removeGreetingRecord(second?.id as string)).toBe(true);
    expect(store().greetingHistory.map((record) => record.id)).toEqual([first?.id]);
    expect(store().selectedHistoryId).toBe(first?.id);
    expect(store().removeGreetingRecord('不存在的 id')).toBe(false);
  });

  it('清空全部返回被清掉的条数', () => {
    finishGeneration('g1');
    store().saveGreetingToHistory(0);
    finishGeneration('g2');
    store().saveGreetingToHistory(0);

    expect(store().clearGreetingHistory()).toBe(2);
    expect(store().greetingHistory).toEqual([]);
    expect(store().selectedHistoryId).toBeNull();
  });
});

describe('历史进入本地存储', () => {
  const validRecord: GreetingHistoryRecord = {
    id: 'h1',
    sessionId: 'g1',
    jdText: SAMPLE_JD,
    items: [{ index: 0, style: '技能匹配型', text: '一条话术', edited: false }],
    analysis: null,
    copiedIndexes: [0],
    createdAt: 1,
    elapsedMs: 1900
  };

  it('写入后能原样读回，刷新不会丢历史', () => {
    const appStorage = createAppStorage(storage);
    appStorage.setItem('zhipin-assistant', JSON.stringify({ state: { greetingHistory: [validRecord] }, version: 1 }));

    const slice = readSlice(storage);
    expect(slice?.greetingHistory).toEqual([validRecord]);
  });

  it('单条损坏只丢那一条，其余记录保留', () => {
    storage.setItem(
      STORAGE_KEYS.greetingHistory,
      JSON.stringify([validRecord, { id: '坏掉的记录' }, 42])
    );

    const slice = readSlice(storage);
    expect(slice?.greetingHistory).toEqual([validRecord]);
    // 坏数据的原样保留在旁路键里，便于排查
    expect(storage.getItem(`${STORAGE_KEYS.greetingHistory}:invalid`)).toBeNull();
  });

  it('整份不是数组时回退为空，并保留原始数据备查', () => {
    storage.setItem(STORAGE_KEYS.greetingHistory, JSON.stringify({ oops: true }));

    const slice = readSlice(storage);
    expect(slice?.greetingHistory).toEqual([]);
    expect(storage.getItem(`${STORAGE_KEYS.greetingHistory}:invalid`)).toBe(
      JSON.stringify({ oops: true })
    );
  });

  it('读取时按容量上限截断', () => {
    const many = Array.from({ length: MAX_GREETING_HISTORY + 5 }, (_, index) => ({
      ...validRecord,
      id: `h${index}`,
      sessionId: `g${index}`
    }));
    storage.setItem(STORAGE_KEYS.greetingHistory, JSON.stringify(many));

    expect(readSlice(storage)?.greetingHistory).toHaveLength(MAX_GREETING_HISTORY);
  });
});
