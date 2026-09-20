import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TelemetryEventSchema } from '@zhipin/shared';
import { SAMPLE_JD } from './fixtures';

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
const { STORAGE_KEYS } = await import('../apps/web/src/store/storage');
const { recognizeImage } = await import('../apps/web/src/api/vision');

const IMAGE = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
const JD_TEXT = '公司：某电商科技\n岗位：Java 开发';
const store = () => useAppStore.getState();

function resetStore(): void {
  storage.clear();
  useAppStore.setState({
    resume: '',
    savedAt: 0,
    resumeDraft: '',
    jd: '',
    jdUpdatedAt: 0,
    jdUndo: [],
    jdReviewPending: false,
    archive: [],
    selectedArchiveId: null,
    resumeTemplate: null,
    sidebarCollapsed: false,
    view: 'resume',
    events: []
  });
}

beforeEach(() => {
  resetStore();
  vi.restoreAllMocks();
});

describe('图片识别调用', () => {
  const ok = () =>
    new Response(JSON.stringify({ text: JD_TEXT, elapsedMs: 1200 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  it('首次失败自动重试一次，第二次成功即返回文本', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 'VISION_FAILED' }), { status: 502 }))
      .mockResolvedValueOnce(ok());

    const outcome = await recognizeImage(IMAGE);

    expect(outcome).toMatchObject({ status: 'ok', text: JD_TEXT });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ image: IMAGE });
  });

  it('两次都失败时返回错误码，交给界面提示改用粘贴', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ code: 'VISION_FAILED' }), { status: 502 }));

    await expect(recognizeImage(IMAGE)).resolves.toMatchObject({
      status: 'error',
      code: 'VISION_FAILED'
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('限流不重试：配额问题重试没有意义，直接把 429 文案交给界面', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ code: 'RATE_LIMITED' }), { status: 429 }));

    await expect(recognizeImage(IMAGE)).resolves.toMatchObject({
      status: 'error',
      code: 'RATE_LIMITED'
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('用户中途取消时返回 aborted，不再发起重试', async () => {
    const controller = new AbortController();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      controller.abort();
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    });

    await expect(recognizeImage(IMAGE, { signal: controller.signal })).resolves.toEqual({
      status: 'aborted'
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('请求没到服务端（断网或服务未启动）提示「图片识别暂不可用」', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(recognizeImage(IMAGE)).resolves.toMatchObject({
      status: 'error',
      code: 'VISION_UNAVAILABLE'
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('服务端返回未知错误码时按识别失败处理，不回显 undefined', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ code: 'NOT_FOUND' }), { status: 404 })
    );

    const outcome = await recognizeImage(IMAGE);
    expect(outcome).toMatchObject({ status: 'error', code: 'VISION_FAILED' });
  });
});

describe('JD 图片导入落点', () => {
  it('JD 为空时填入识别结果，并进入校对态', () => {
    store().appendJdImport(JD_TEXT);

    expect(store().jd).toBe(JD_TEXT);
    expect(store().jdReviewPending).toBe(true);
    expect(store().events.at(-1)).toMatchObject({
      type: 'jd_image_import',
      images: 1,
      chars: [...JD_TEXT].length
    });
  });

  it('JD 非空时按导入顺序追加，不覆盖既有内容', () => {
    store().setJd(SAMPLE_JD);
    store().appendJdImport('第二批识别结果');

    expect(store().jd.startsWith(SAMPLE_JD)).toBe(true);
    expect(store().jd.endsWith('第二批识别结果')).toBe(true);
    expect(store().jd).toContain('\n\n第二批识别结果');
  });

  it('支持连续撤销：每次都回到该次导入前的 JD 内容', () => {
    store().setJd(SAMPLE_JD);
    store().appendJdImport('第一批');
    store().appendJdImport('第二批');

    expect(store().undoJdImport()).toBe(true);
    expect(store().jd).toBe(`${SAMPLE_JD}\n\n第一批`);
    expect(store().jdReviewPending).toBe(true);

    expect(store().undoJdImport()).toBe(true);
    expect(store().jd).toBe(SAMPLE_JD);
    expect(store().jdReviewPending).toBe(false);

    expect(store().undoJdImport()).toBe(false);
  });

  it('用户手动编辑 JD 后校对提示自动消失', () => {
    store().appendJdImport('识别结果');
    expect(store().jdReviewPending).toBe(true);

    store().setJd('识别结果，我自己改了一处');
    expect(store().jdReviewPending).toBe(false);
  });

  it('导入相关状态不进本地存储，只留下可量化的行为记录', () => {
    store().appendJdImport('识别结果');
    store().record({ type: 'resume_import', at: 1, format: 'docx', chars: 320 });

    const jdSlice = JSON.parse(storage.getItem(STORAGE_KEYS.jd) ?? '{}');
    expect(Object.keys(jdSlice).sort()).toEqual(['text', 'updatedAt']);

    const events = JSON.parse(storage.getItem(STORAGE_KEYS.events) ?? '[]');
    expect(events.at(-1)).toMatchObject({ type: 'resume_import', format: 'docx', chars: 320 });
    expect(JSON.stringify(events)).not.toContain('识别结果');
  });

  it('导入事件的埋点字段在共享 schema 里合法', () => {
    expect(
      TelemetryEventSchema.safeParse({ type: 'jd_image_import', at: 1, images: 1, chars: 120 })
        .success
    ).toBe(true);
    expect(
      TelemetryEventSchema.safeParse({ type: 'resume_import', at: 1, format: 'pdf', chars: 120 })
        .success
    ).toBe(true);
  });
});

describe('Word 保真导出的本地边界', () => {
  it('原文件模板只留在内存，不写进本地存储，也不进行为记录', () => {
    store().setResumeTemplate({ bytes: new Uint8Array([1, 2, 3]), fileName: '我的简历.docx' });
    expect(store().resumeTemplate?.fileName).toBe('我的简历.docx');

    store().record({
      type: 'custom_export',
      at: Date.now(),
      format: 'docx',
      count: 2,
      skipped: 1
    });

    const stored = Object.values(STORAGE_KEYS)
      .map((key) => storage.getItem(key) ?? '')
      .join('\n');
    expect(stored).not.toContain('我的简历.docx');
    expect(stored).not.toContain('resumeTemplate');

    // 导出事件只记可量化属性，不记文件名与正文
    const events = JSON.parse(storage.getItem(STORAGE_KEYS.events) ?? '[]');
    expect(events.at(-1)).toMatchObject({ type: 'custom_export', format: 'docx', count: 2, skipped: 1 });
  });

  it('导出事件的埋点字段在共享 schema 里合法', () => {
    expect(
      TelemetryEventSchema.safeParse({
        type: 'custom_export',
        at: 1,
        format: 'docx',
        count: 2,
        skipped: 1
      }).success
    ).toBe(true);
  });
});
