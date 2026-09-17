import { useMemo } from 'react';
import {
  ABORTED_NOTICE,
  ERROR_MESSAGES,
  LOW_MATCH_NOTICE,
  MIN_TEXT_LENGTH
} from '@zhipin/shared';
import { calcMetrics } from '@zhipin/core';
import { copyText } from '../api/copy';
import { JdField } from '../components/JdField';
import { toast } from '../components/Toast';
import { Card, ChipRow, Notice, PageTitle } from '../components/ui';
import { canGenerate, useAppStore, type GreetingItem } from '../store/store';
import { countChars } from '../utils/format';

function GreetingCard({ item }: { item: GreetingItem }): JSX.Element {
  const updateGreetingItem = useAppStore((state) => state.updateGreetingItem);
  const record = useAppStore((state) => state.record);

  const onCopy = async () => {
    const ok = await copyText(item.text);
    if (!ok) {
      toast('浏览器拒绝了剪贴板权限，请手动选择复制');
      return;
    }
    record({
      type: 'copy',
      at: Date.now(),
      index: item.index,
      edited: item.edited,
      count: countChars(item.text)
    });
    toast('已复制');
  };

  return (
    <article className="card p-4" data-testid="greeting-card">
      <div className="mb-2 flex items-center justify-between">
        <span className="chip bg-primary-soft text-primary">{item.style}</span>
        <span className="flex items-center gap-2 text-xs text-[#98a2b6]">
          {item.edited && <span className="text-[#b45309]">已编辑</span>}
          {countChars(item.text)} 字
        </span>
      </div>

      <textarea
        data-testid="greeting-body"
        className="w-full resize-none rounded-xl border border-transparent bg-transparent p-2 text-sm leading-6 outline-none transition hover:border-[#e5e9f2] focus:border-primary focus:bg-white"
        rows={5}
        spellCheck={false}
        value={item.text}
        onChange={(event) => updateGreetingItem(item.index, event.target.value)}
      />

      <div className="mt-2">
        <button type="button" className="btn-ghost" onClick={onCopy}>
          复制话术
        </button>
      </div>
    </article>
  );
}

/** 生成打招呼：一次调用返回匹配分析与 3 条话术，流式渲染、可中止（PRD 3.2） */
export function GenerateView(): JSX.Element {
  const greeting = useAppStore((state) => state.greeting);
  const generateGreeting = useAppStore((state) => state.generateGreeting);
  const abortGeneration = useAppStore((state) => state.abortGeneration);
  const ready = useAppStore((state) => canGenerate(state));
  const hasResume = useAppStore((state) => state.resume.length >= MIN_TEXT_LENGTH);
  // 指标是派生值，必须用 useMemo 而不是选择器：选择器每次返回新对象会导致无限重渲染
  const events = useAppStore((state) => state.events);
  const metrics = useMemo(() => calcMetrics(events), [events]);

  const streaming = greeting.status === 'streaming';
  const analysis = greeting.analysis;

  return (
    <div>
      <PageTitle
        title="生成打招呼"
        description="粘贴岗位 JD，基于已保存的简历生成 3 条可直接发送的话术：技能匹配型 / 经历相关型 / 简短直接型。"
      />

      <Card>
        <JdField id="jd" />

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            id="generate"
            type="button"
            className="btn-primary"
            disabled={!ready || streaming}
            onClick={() => void generateGreeting({ regenerate: greeting.items.length > 0 })}
          >
            {streaming ? '生成中…' : greeting.items.length ? '重新生成 3 条话术' : '生成 3 条话术'}
          </button>

          {streaming && (
            <button id="abort" type="button" className="btn-ghost" onClick={abortGeneration}>
              中止生成
            </button>
          )}

          {!hasResume && (
            <span className="text-xs text-[#b45309]">
              还没有保存简历，先到「我的简历」填写并保存
            </span>
          )}
        </div>
      </Card>

      <div className="mt-4 space-y-4">
        {streaming && !greeting.items.length && (
          <Card>
            <div className="animate-pulse space-y-3" data-testid="skeleton">
              <div className="h-3 w-1/3 rounded bg-[#eef1f7]" />
              <div className="h-3 w-2/3 rounded bg-[#eef1f7]" />
              <div className="h-3 w-1/2 rounded bg-[#eef1f7]" />
            </div>
          </Card>
        )}

        {analysis && (
          <Card>
            <h3 className="mb-2 text-sm font-medium">匹配分析</h3>
            <ChipRow label="JD 关键要求" items={analysis.requirements} />
            <ChipRow label="简历已命中" items={analysis.matched} tone="ok" />
            <ChipRow label="简历未覆盖" items={analysis.missing} tone="warn" />
            {analysis.lowMatch && (
              <div className="mt-3">
                <Notice tone="warn">{LOW_MATCH_NOTICE}</Notice>
              </div>
            )}
          </Card>
        )}

        {greeting.items.map((item) => (
          <GreetingCard key={item.index} item={item} />
        ))}

        {greeting.status === 'error' && greeting.errorCode && (
          <Notice tone="error">{ERROR_MESSAGES[greeting.errorCode]}</Notice>
        )}

        {greeting.status === 'aborted' && <Notice tone="muted">{ABORTED_NOTICE}</Notice>}

        {greeting.status === 'done' && greeting.items.length > 0 && greeting.elapsedMs !== null && (
          <p className="text-xs text-[#98a2b6]">
            生成完成 · 用时 {(greeting.elapsedMs / 1000).toFixed(1)} 秒 · 直接复制可发送，也可以先按自己
            习惯改一改
          </p>
        )}

        {metrics.generateCount > 0 && (
          <p className="text-xs text-[#98a2b6]" data-testid="metrics">
            本地统计（只保存在这台设备）· 生成 {metrics.generateCount} 次 · 复制 {metrics.copyCount}{' '}
            次 · 零修改直接复制率
            {metrics.copyCount ? ` ${Math.round(metrics.cleanCopyRate * 100)}%` : ' —'}
          </p>
        )}
      </div>
    </div>
  );
}
