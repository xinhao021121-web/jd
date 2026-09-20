import type { GreetingHistoryRecord } from '../store/storage';
import { MAX_GREETING_HISTORY } from '@zhipin/shared';
import { copyText } from '../api/copy';
import { toast } from '../components/Toast';
import { Card, ChipRow, Notice, PageTitle } from '../components/ui';
import { historyTitle, useAppStore } from '../store/store';
import { countChars, formatTime } from '../utils/format';

/**
 * 话术历史（PRD V0.5 增补 3.9）：复制过的那次生成自动留档。
 * 布局沿用定制简历存档的「左列表 + 右详情」，降低认知与实现成本。
 */
export function HistoryView(): JSX.Element {
  const history = useAppStore((state) => state.greetingHistory);
  const selectedId = useAppStore((state) => state.selectedHistoryId);
  const selectHistory = useAppStore((state) => state.selectHistory);
  const removeGreetingRecord = useAppStore((state) => state.removeGreetingRecord);
  const clearGreetingHistory = useAppStore((state) => state.clearGreetingHistory);
  const setView = useAppStore((state) => state.setView);

  const selected = history.find((record) => record.id === selectedId) ?? history[0] ?? null;

  const confirmAndRemove = (record: GreetingHistoryRecord) => {
    const ok = window.confirm(`删除「${historyTitle(record)}」这条记录？删除后无法恢复。`);
    if (!ok) return;
    removeGreetingRecord(record.id);
    toast('已删除这条记录');
  };

  const confirmAndClear = () => {
    const ok = window.confirm(`清空全部 ${history.length} 条话术历史？删除后无法恢复。`);
    if (!ok) return;
    const count = clearGreetingHistory();
    toast(`已清空 ${count} 条记录`);
  };

  if (!history.length) {
    return (
      <div>
        <PageTitle
          title="话术历史"
          description="复制过的话术会自动保存到这里，只存在这台设备上。"
        />
        <Card>
          <div className="py-10 text-center">
            <p className="text-sm text-[#6b7688]">还没有历史记录</p>
            <p className="mt-2 text-xs text-[#98a2b6]">
              生成 3 条话术并复制其中任意一条，这次生成就会连同岗位 JD 一起留在这里；
              没有复制过的生成不会占用空间。
            </p>
            <button type="button" className="btn-primary mt-4" onClick={() => setView('generate')}>
              去生成话术
            </button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageTitle
        title="话术历史"
        description={`共 ${history.length} 条（上限 ${MAX_GREETING_HISTORY} 条）· 每条记录对应一次生成，只存在这台设备上。`}
      />

      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        <div className="space-y-2" id="historyList">
          {history.map((record) => (
            <div
              key={record.id}
              data-testid="history-item"
              className={`group relative cursor-pointer rounded-xl border p-3 transition ${
                record.id === selected?.id
                  ? 'border-primary bg-primary-soft/40'
                  : 'border-[#e5e9f2] bg-white hover:border-[#c9d3e8]'
              }`}
              onClick={() => selectHistory(record.id)}
            >
              <div className="truncate pr-6 text-sm font-medium" title={historyTitle(record)}>
                {historyTitle(record)}
              </div>
              <div className="mt-1 text-xs text-[#98a2b6]">
                {formatTime(record.createdAt)} · 复制 {record.copiedIndexes.length} 条 ·{' '}
                {record.items.length} 条候选
              </div>
              <div className="mt-1 truncate text-[11px] text-[#6b7688]">
                {record.items[0]?.text ?? ''}
              </div>
              <button
                type="button"
                title="删除这条"
                aria-label="删除这条"
                data-del={record.id}
                className="absolute right-2 top-2 hidden h-6 w-6 items-center justify-center rounded-lg text-[#98a2b6] transition hover:bg-[#fdeaea] hover:text-[#b42318] group-hover:flex"
                onClick={(event) => {
                  event.stopPropagation();
                  confirmAndRemove(record);
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        {selected && (
          <Card>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="truncate text-sm font-medium" title={historyTitle(selected)}>
                  {historyTitle(selected)}
                </h3>
                <p className="mt-1 text-xs text-[#98a2b6]">
                  {formatTime(selected.createdAt)}
                  {selected.elapsedMs !== null &&
                    ` · 当时用时 ${(selected.elapsedMs / 1000).toFixed(1)} 秒`}
                </p>
              </div>
              <button type="button" className="btn-ghost flex-none" onClick={confirmAndClear}>
                清空全部
              </button>
            </div>

            {selected.copiedIndexes.length > 0 && (
              <div className="mt-3">
                <Notice tone="info">
                  这次生成里你复制过第 {selected.copiedIndexes.map((index) => index + 1).join('、')} 条
                </Notice>
              </div>
            )}

            <div className="mt-4 space-y-3">
              {selected.items.map((item, position) => (
                <article key={item.index} className="rounded-xl border border-[#e5e9f2] p-3">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <span className="chip bg-primary-soft text-primary">{item.style}</span>
                    <span className="flex items-center gap-2 text-xs text-[#98a2b6]">
                      {selected.copiedIndexes.includes(item.index) && (
                        <span className="text-[#15a34a]">已复制</span>
                      )}
                      {item.edited && <span className="text-[#b45309]">已编辑</span>}
                      {countChars(item.text)} 字
                    </span>
                  </div>

                  <textarea
                    data-testid="history-body"
                    readOnly
                    className="field min-h-[120px] text-sm leading-6"
                    value={item.text}
                  />

                  <div className="mt-2">
                    <button
                      type="button"
                      className="btn-ghost"
                      data-copy={item.index}
                      // 从历史复制不计入 copy 埋点：它是「复述已采用的话术」，
                      // 与指标里的「本次生成有没有拿到敢发的话」不是同一件事
                      onClick={async () => {
                        const ok = await copyText(item.text);
                        toast(ok ? '已复制' : '复制失败，请手动选择');
                      }}
                    >
                      复制话术
                    </button>
                  </div>
                </article>
              ))}
            </div>

            {selected.analysis && (
              <div className="mt-4">
                <h3 className="mb-2 text-sm font-medium">当时的匹配分析</h3>
                <ChipRow label="JD 关键要求" items={selected.analysis.requirements} />
                <ChipRow label="简历已命中" items={selected.analysis.matched} tone="ok" />
                <ChipRow label="简历未覆盖" items={selected.analysis.missing} tone="warn" />
              </div>
            )}

            <div className="mt-4">
              <h3 className="mb-2 text-sm font-medium">对应岗位 JD</h3>
              <textarea
                id="historyJd"
                readOnly
                className="field min-h-[200px] text-xs leading-6"
                value={selected.jdText}
              />
            </div>

            <div className="mt-4">
              <button
                id="deleteHistory"
                type="button"
                className="btn-ghost text-[#b42318]"
                onClick={() => confirmAndRemove(selected)}
              >
                删除这条
              </button>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
