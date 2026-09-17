import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_CUSTOM_RESUMES } from '@zhipin/shared';
import { DESIGNER_RESUME, SAMPLE_JD, SAMPLE_RESUME } from './fixtures';

/** 最小可用的 localStorage 桩，便于在 node 环境测试持久化逻辑 */
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

const { useAppStore, archiveTitle, composePreview } = await import(
  '../apps/web/src/store/store'
);
const { STORAGE_KEYS } = await import('../apps/web/src/store/storage');

const store = () => useAppStore.getState();

function sseStream(events: unknown[]): Response {
  const body = events
    .map((event) => `event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n\n`)
    .join('');
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(body));
        controller.close();
      }
    }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
  );
}

const analysisEvent = {
  type: 'analysis',
  requirements: ['Java', 'Redis'],
  matched: ['Java'],
  missing: ['Redis'],
  lowMatch: false
};

const greetingItems = [0, 1, 2].map((index) => ({
  type: 'item',
  kind: 'greeting',
  index,
  style: ['技能匹配型', '经历相关型', '简短直接型'][index],
  text: `第 ${index + 1} 条话术：负责订单中心核心链路开发，使用 Java 与 Redis 优化查询性能。`
}));

function resetStore(): void {
  storage.clear();
  useAppStore.setState({
    resume: '',
    savedAt: 0,
    resumeDraft: '',
    jd: '',
    jdUpdatedAt: 0,
    archive: [],
    selectedArchiveId: null,
    sidebarCollapsed: false,
    view: 'resume',
    events: [],
    greeting: { items: [], status: 'idle', errorCode: null, elapsedMs: null, analysis: null },
    customization: {
      suggestions: [],
      droppedCount: 0,
      status: 'idle',
      errorCode: null,
      elapsedMs: null,
      analysis: null
    }
  });
}

function saveResume(text = SAMPLE_RESUME): void {
  store().setResumeDraft(text);
  store().saveResume();
}

beforeEach(() => {
  resetStore();
  vi.restoreAllMocks();
});

describe('我的简历', () => {
  it('少于 20 字拒绝保存，内容未变化时保存不生效', () => {
    store().setResumeDraft('太短了');
    expect(store().saveResume()).toBe(false);
    expect(store().resume).toBe('');

    saveResume();
    const savedAt = store().savedAt;
    expect(store().resume).toBe(SAMPLE_RESUME);

    // 内容未变化：不应刷新保存时间
    expect(store().saveResume()).toBe(false);
    expect(store().savedAt).toBe(savedAt);
  });

  it('还原会丢弃未保存的编辑', () => {
    saveResume();
    store().setResumeDraft(DESIGNER_RESUME);
    store().revertResumeDraft();
    expect(store().resumeDraft).toBe(SAMPLE_RESUME);
  });
});

describe('生成打招呼', () => {
  it('只读取已保存简历：未保存的草稿不参与生成', async () => {
    saveResume();
    store().setResumeDraft(DESIGNER_RESUME);
    store().setJd(SAMPLE_JD);

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(sseStream([analysisEvent, ...greetingItems, { type: 'done', elapsedMs: 900 }]));

    await store().generateGreeting();

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.resume).toBe(SAMPLE_RESUME);
    expect(body.task).toBe('greeting');
    expect(body.resume).not.toContain('平面设计师');
  });

  it('流式事件逐条落地：先分析后话术，结束后记录生成事件', async () => {
    saveResume();
    store().setJd(SAMPLE_JD);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      sseStream([analysisEvent, ...greetingItems, { type: 'done', elapsedMs: 1234 }])
    );

    await store().generateGreeting();

    expect(store().greeting.status).toBe('done');
    expect(store().greeting.items).toHaveLength(3);
    expect(store().greeting.analysis?.matched).toEqual(['Java']);
    expect(store().greeting.elapsedMs).toBe(1234);
    expect(store().events.at(-1)?.type).toBe('generate');
  });

  it('没有保存简历时不发起请求', async () => {
    store().setJd(SAMPLE_JD);
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    await store().generateGreeting();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(store().greeting.status).toBe('idle');
  });

  it('服务端返回限流时记录错误码与错误事件', async () => {
    saveResume();
    store().setJd(SAMPLE_JD);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ code: 'RATE_LIMITED' }), { status: 429 })
    );

    await store().generateGreeting();

    expect(store().greeting.status).toBe('error');
    expect(store().greeting.errorCode).toBe('RATE_LIMITED');
    expect(store().events.at(-1)?.errorType).toBe('RATE_LIMITED');
  });

  it('编辑话术后再复制会被标记为已编辑，用于区分零修改直接复制率', async () => {
    saveResume();
    store().setJd(SAMPLE_JD);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      sseStream([analysisEvent, ...greetingItems, { type: 'done', elapsedMs: 100 }])
    );
    await store().generateGreeting();

    store().updateGreetingItem(0, '我自己改过的话术');
    const item = store().greeting.items[0];
    expect(item?.edited).toBe(true);
    expect(item?.text).toBe('我自己改过的话术');
  });
});

describe('按 JD 改简历', () => {
  const suggestionEvent = {
    type: 'item',
    kind: 'suggestion',
    index: 0,
    section: '工作经历',
    before: '主导订单查询接口性能优化，通过 Redis 缓存与 SQL 优化将 P99 响应时间从 800ms 降到 180ms',
    after:
      '主导订单查询接口性能优化，通过 Redis 缓存与 SQL 优化将 P99 响应时间从 800ms 降到 180ms（高并发场景）',
    reason: '补上岗位关注的术语标签，不改变事实',
    suggestionType: '术语对齐'
  };

  const lockedSuggestionEvent = {
    type: 'item',
    kind: 'suggestion',
    index: 1,
    section: '教育背景',
    before: '某某大学  计算机科学与技术  本科  2021 届',
    after: '某某大学  计算机科学与技术  本科  2021 届（重点院校）',
    reason: '越界示例',
    suggestionType: '关键词补充'
  };

  async function generate(): Promise<void> {
    saveResume();
    store().setJd(SAMPLE_JD);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      sseStream([analysisEvent, suggestionEvent, lockedSuggestionEvent, { type: 'done', elapsedMs: 800 }])
    );
    await store().generateSuggestions();
  }

  it('建议绑定到可改写区块，越界建议被丢弃并计数', async () => {
    await generate();

    expect(store().customization.suggestions).toHaveLength(1);
    expect(store().customization.suggestions[0]?.section).toBe('工作经历');
    expect(store().customization.droppedCount).toBe(1);
  });

  it('未采纳任何建议时预览与原件一致，采纳后只替换锚点', async () => {
    await generate();
    expect(composeFromStore()).toBe(SAMPLE_RESUME);

    const id = store().customization.suggestions[0]!.id;
    store().toggleSuggestion(id);

    const composed = composeFromStore();
    expect(composed).toContain('（高并发场景）');
    expect(composed).toContain('教育背景');
    expect(composed).toContain('某某大学  计算机科学与技术  本科  2021 届');
    expect(composed).not.toContain('重点院校');
  });

  it('取消采纳后重新回到与原件一致', async () => {
    await generate();
    const id = store().customization.suggestions[0]!.id;
    store().toggleSuggestion(id);
    store().toggleSuggestion(id);
    expect(composeFromStore()).toBe(SAMPLE_RESUME);
  });

  it('保存定制简历：绑定 JD、名称取自 JD、不写回原始简历，可改名与删除', async () => {
    await generate();
    store().toggleSuggestion(store().customization.suggestions[0]!.id);

    const record = store().saveCustomResume();
    expect(record).not.toBeNull();
    expect(store().resume).toBe(SAMPLE_RESUME);
    expect(store().archive).toHaveLength(1);
    expect(store().archive[0]?.jdText).toBe(SAMPLE_JD);
    expect(store().archive[0]?.adoptedCount).toBe(1);
    expect(archiveTitle(store().archive[0]!)).toBe('某电商科技有限公司 · Java 后端开发工程师');

    const id = store().archive[0]!.id;
    store().renameArchive(id, '  我的目标岗位  ');
    expect(store().archive[0]?.name).toBe('我的目标岗位');
    expect(store().archive[0]?.nameEdited).toBe(true);

    store().renameArchive(id, '   ');
    expect(archiveTitle(store().archive[0]!)).toContain('Java 后端开发工程师');

    expect(store().removeArchive(id)).toBe(true);
    expect(store().archive).toHaveLength(0);
    expect(store().removeArchive('不存在')).toBe(false);
    expect(store().resume).toBe(SAMPLE_RESUME);
  });

  it('未采纳任何建议时不能保存定制版本', async () => {
    await generate();
    expect(store().saveCustomResume()).toBeNull();
    expect(store().archive).toHaveLength(0);
  });

  it('存档容量上限为 20 份，超出后移除最早的一份', async () => {
    const now = Date.now();
    useAppStore.setState({
      resume: SAMPLE_RESUME,
      archive: Array.from({ length: MAX_CUSTOM_RESUMES }, (_, index) => ({
        id: `old-${index}`,
        name: `旧记录 ${index}`,
        nameEdited: true,
        jdText: SAMPLE_JD,
        content: `内容 ${index}`,
        adoptedCount: 1,
        charCount: 3,
        createdAt: now - index
      }))
    });

    await generate();
    store().toggleSuggestion(store().customization.suggestions[0]!.id);
    store().saveCustomResume();

    expect(store().archive).toHaveLength(MAX_CUSTOM_RESUMES);
    expect(store().archive[0]?.nameEdited).toBe(false);
    expect(store().archive.some((record) => record.id === `old-${MAX_CUSTOM_RESUMES - 1}`)).toBe(
      false
    );
    expect(store().events.at(-1)?.type).toBe('custom_save');
  });
});

describe('本地存储', () => {
  it('简历、JD、存档、行为记录与侧边栏状态分别写入文档约定的键', () => {
    saveResume();
    store().setJd(SAMPLE_JD);
    store().setSidebarCollapsed(true);
    store().record({ type: 'generate', at: 1, jdLength: SAMPLE_JD.length });

    expect(JSON.parse(storage.getItem(STORAGE_KEYS.resume) ?? '{}')).toMatchObject({
      text: SAMPLE_RESUME
    });
    expect(JSON.parse(storage.getItem(STORAGE_KEYS.jd) ?? '{}')).toMatchObject({
      text: SAMPLE_JD
    });
    expect(JSON.parse(storage.getItem(STORAGE_KEYS.ui) ?? '{}')).toEqual({
      sidebarCollapsed: true
    });
    expect(JSON.parse(storage.getItem(STORAGE_KEYS.events) ?? '[]')).toHaveLength(1);
  });

  it('键损坏时回退默认值并保留原始数据，不影响其它键', async () => {
    saveResume();
    store().setJd(SAMPLE_JD);
    storage.setItem(STORAGE_KEYS.customResumes, '{ 这不是合法 JSON');

    const { readSlice } = await import('../apps/web/src/store/storage');
    const slice = readSlice(storage);

    expect(slice?.resume).toBe(SAMPLE_RESUME);
    expect(slice?.jd).toBe(SAMPLE_JD);
    expect(slice?.archive).toEqual([]);
    expect(storage.getItem(`${STORAGE_KEYS.customResumes}:invalid`)).toBe('{ 这不是合法 JSON');
  });
});

function composeFromStore(): string {
  return composePreview(store());
}
