import { useMemo, useState } from 'react';
import {
  ABORTED_NOTICE,
  ERROR_MESSAGES,
  EXPORT_FALLBACK_NOTICE,
  EXPORT_TEMPLATE_NOTICE,
  LOCKED_NOTICE,
  MIN_TEXT_LENGTH,
  uncoveredNotice
} from '@zhipin/shared';
import type { Suggestion } from '@zhipin/core';
import { copyText } from '../api/copy';
import { JdField } from '../components/JdField';
import { toast } from '../components/Toast';
import { Card, Notice, PageTitle } from '../components/ui';
import {
  adoptedSuggestions,
  canGenerate,
  composePreview,
  useAppStore
} from '../store/store';
import { downloadBlob } from '../utils/download';
import { exportDocx, exportedFileName } from '../utils/export/docx';
import { countChars } from '../utils/format';

function SuggestionCard({ suggestion }: { suggestion: Suggestion }): JSX.Element {
  const toggleSuggestion = useAppStore((state) => state.toggleSuggestion);

  return (
    <div
      className={`rounded-xl border p-3 transition ${
        suggestion.adopted ? 'border-primary bg-primary-soft/40' : 'border-[#e5e9f2] bg-white'
      }`}
      data-testid="suggestion-card"
    >
      <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          className="h-4 w-4 accent-[#2f6bff]"
          checked={suggestion.adopted}
          onChange={() => toggleSuggestion(suggestion.id)}
        />
        采纳这条建议
        {suggestion.suggestionType && (
          <span className="chip bg-[#f2f4f9] text-[#6b7688]">{suggestion.suggestionType}</span>
        )}
      </label>

      <div className="mt-3 space-y-2 text-sm">
        <div className="flex gap-2">
          <span className="mt-0.5 flex-none rounded bg-[#fdeaea] px-1.5 py-0.5 text-[11px] text-[#b42318]">
            原
          </span>
          <span className="text-[#6b7688] line-through decoration-[#c3cbd9]">
            {suggestion.before}
          </span>
        </div>
        <div className="flex gap-2">
          <span className="mt-0.5 flex-none rounded bg-[#e9f8ef] px-1.5 py-0.5 text-[11px] text-[#15a34a]">
            改
          </span>
          <span className="text-[#1b2333]" data-testid="suggestion-after">
            {suggestion.after}
          </span>
        </div>
      </div>

      <p className="mt-2 text-xs text-[#98a2b6]">{suggestion.reason}</p>

      {suggestion.issues && suggestion.issues.length > 0 && (
        <p
          className="mt-2 rounded-lg bg-[#fdf3e3] px-2 py-1 text-xs text-[#b45309]"
          data-testid="suggestion-issues"
        >
          本地自检：{suggestion.issues.join('；')}
        </p>
      )}
    </div>
  );
}

/** 按 JD 改简历：逐条建议、逐条采纳、实时合成，锁定区块不参与改写（PRD 3.3） */
export function CustomizeView(): JSX.Element {
  const customization = useAppStore((state) => state.customization);
  const ready = useAppStore((state) => canGenerate(state));
  const generateSuggestions = useAppStore((state) => state.generateSuggestions);
  const abortGeneration = useAppStore((state) => state.abortGeneration);
  const resetCustomization = useAppStore((state) => state.resetCustomization);
  const saveCustomResume = useAppStore((state) => state.saveCustomResume);
  const preview = useAppStore((state) => composePreview(state));
  const template = useAppStore((state) => state.resumeTemplate);
  const record = useAppStore((state) => state.record);
  const adoptedCount = useAppStore(
    (state) => adoptedSuggestions(state.customization.suggestions).length
  );
  const [exporting, setExporting] = useState(false);

  const streaming = customization.status === 'streaming';
  const missing = customization.analysis?.missing ?? [];

  const groups = useMemo(() => {
    const map = new Map<string, Suggestion[]>();
    customization.suggestions.forEach((suggestion) => {
      const list = map.get(suggestion.section) ?? [];
      list.push(suggestion);
      map.set(suggestion.section, list);
    });
    return [...map.entries()];
  }, [customization.suggestions]);

  /** 导出：只把已采纳的建议写回原文件，版面与原件一致（PRD V0.4 增补 3.8） */
  const handleExport = async (): Promise<void> => {
    if (!template) return;
    setExporting(true);
    try {
      const result = await exportDocx(template, adoptedSuggestions(customization.suggestions));
      downloadBlob(exportedFileName(template.fileName), result.blob);
      record({
        type: 'custom_export',
        at: Date.now(),
        format: 'docx',
        count: result.applied,
        skipped: result.skipped,
        sessionId: customization.sessionId ?? undefined
      });
      toast(
        result.fallback
          ? EXPORT_FALLBACK_NOTICE
          : result.skipped > 0
            ? `已导出，其中 ${result.skipped} 条建议没能对应到原文件，已按原文保留`
            : '已导出与原文件排版一致的 Word'
      );
    } catch {
      toast('导出失败，可改用「复制全文」');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div>
      <PageTitle
        title="按 JD 改简历"
        description="针对当前 JD 生成逐条改写建议，勾选后实时合成定制简历；原始简历始终保持保存时的内容。"
      />

      <Card>
        <JdField id="jd2" />

        <div className="mt-3">
          <Notice tone="muted">{LOCKED_NOTICE}</Notice>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            id="makeSuggest"
            type="button"
            className="btn-primary"
            disabled={!ready || streaming}
            onClick={() => void generateSuggestions()}
          >
            {streaming ? '生成中…' : '生成改写建议'}
          </button>
          {streaming && (
            <button id="abortSuggest" type="button" className="btn-ghost" onClick={abortGeneration}>
              中止生成
            </button>
          )}
          {(customization.suggestions.length > 0 || customization.status !== 'idle') && !streaming && (
            <button type="button" className="btn-ghost" onClick={resetCustomization}>
              清空建议
            </button>
          )}
        </div>
      </Card>

      {/* 改写建议与预览始终一左一右：断点定在 768px，笔记本分屏与非全屏窗口也要分列 */}
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="space-y-3">
          {missing.length > 0 && <Notice tone="warn">{uncoveredNotice(missing)}</Notice>}

          {customization.droppedCount > 0 && (
            <Notice tone="muted">
              有 {customization.droppedCount} 条建议落在锁定区块或匹配不上原文，已自动丢弃
            </Notice>
          )}

          {customization.status === 'error' && customization.errorCode && (
            <Notice tone="error">{ERROR_MESSAGES[customization.errorCode]}</Notice>
          )}

          {customization.status === 'aborted' && <Notice tone="muted">{ABORTED_NOTICE}</Notice>}

          {customization.status === 'done' && customization.suggestions.length === 0 && (
            <Notice tone="muted">
              没有找到可以安全改写的点：可能是简历与岗位匹配度已经很高，或简历文本偏短。
            </Notice>
          )}

          {streaming && customization.suggestions.length === 0 && (
            <Card>
              <div className="animate-pulse space-y-3" data-testid="suggest-skeleton">
                <div className="h-3 w-1/2 rounded bg-[#eef1f7]" />
                <div className="h-3 w-3/4 rounded bg-[#eef1f7]" />
              </div>
            </Card>
          )}

          {groups.map(([section, list]) => (
            <div key={section} className="space-y-2">
              <h3 className="flex items-center gap-2 text-sm font-medium">
                {section}
                <span className="chip bg-[#f2f4f9] text-[#6b7688]">{list.length} 条建议</span>
              </h3>
              {list.map((suggestion) => (
                <SuggestionCard key={suggestion.id} suggestion={suggestion} />
              ))}
            </div>
          ))}
        </div>

        <div className="md:sticky md:top-6 md:self-start">
          <Card>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-medium">定制简历预览</h3>
              <span className="text-xs text-[#98a2b6]">已采纳 {adoptedCount} 条</span>
            </div>

            <textarea
              id="customPreview"
              readOnly
              className="field min-h-[360px] font-mono text-xs leading-6"
              placeholder="生成改写建议并勾选采纳后，这里会实时合成定制简历"
              value={preview}
            />

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                id="saveCustom"
                type="button"
                className="btn-primary"
                disabled={adoptedCount === 0}
                onClick={() => {
                  const record = saveCustomResume();
                  if (record) toast(`已保存到「定制简历」：${record.name}`);
                }}
              >
                保存为定制版本
              </button>
              <button
                id="copyCustom"
                type="button"
                className="btn-ghost"
                disabled={!preview}
                onClick={async () => {
                  const ok = await copyText(preview);
                  toast(ok ? '定制简历已复制' : '复制失败，请手动选择');
                }}
              >
                复制全文
              </button>
              <button
                id="exportDocx"
                type="button"
                className="btn-ghost"
                disabled={!template || exporting}
                onClick={() => void handleExport()}
              >
                {exporting ? '导出中…' : '导出 Word'}
              </button>
            </div>

            {!template && (
              <p className="mt-3 text-xs text-[#98a2b6]" data-testid="export-notice">
                {EXPORT_TEMPLATE_NOTICE}
              </p>
            )}

            <p className="mt-3 text-xs text-[#98a2b6]">
              当前字数 {countChars(preview)} · 未采纳任何建议时，预览与原始简历完全一致
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
