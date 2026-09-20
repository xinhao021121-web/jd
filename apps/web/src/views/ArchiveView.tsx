import { useState } from 'react';
import type { CustomResumeRecord } from '../store/storage';
import { diffResumeLines } from '@zhipin/core';
import { EXPORT_FALLBACK_NOTICE, EXPORT_TEMPLATE_NOTICE, MAX_TITLE_LENGTH } from '@zhipin/shared';
import { copyText } from '../api/copy';
import { toast } from '../components/Toast';
import { Card, Notice, PageTitle } from '../components/ui';
import { archiveTitle, useAppStore } from '../store/store';
import { downloadBlob } from '../utils/download';
import { exportDocx, safeFileName } from '../utils/export/docx';
import { formatTime } from '../utils/format';

/** 定制简历存档：按岗位归类，可改名、复制、导出、删除，删除不影响原始简历（PRD 3.4） */
export function ArchiveView(): JSX.Element {
  const archive = useAppStore((state) => state.archive);
  const selectedId = useAppStore((state) => state.selectedArchiveId);
  const selectArchive = useAppStore((state) => state.selectArchive);
  const renameArchive = useAppStore((state) => state.renameArchive);
  const removeArchive = useAppStore((state) => state.removeArchive);
  const setView = useAppStore((state) => state.setView);
  const resume = useAppStore((state) => state.resume);
  const template = useAppStore((state) => state.resumeTemplate);
  const logEvent = useAppStore((state) => state.record);
  const [exporting, setExporting] = useState(false);

  const selected =
    archive.find((record) => record.id === selectedId) ?? archive[0] ?? null;

  /**
   * 存档里只留了定制简历全文，没有保留建议列表，所以导出时用行级比对反推被改过的行
   * （PRD V0.4 增补 3.8）。行对不上就不导，避免把内容填错行。
   */
  const exportRecord = async (record: CustomResumeRecord): Promise<void> => {
    if (!template) return;

    const changes = diffResumeLines(resume, record.content);
    if (!changes.length) {
      toast('原始简历在这份记录之后改动过，行位置对不上，建议重新生成后再导出');
      return;
    }

    setExporting(true);
    try {
      const result = await exportDocx(template, changes);
      downloadBlob(`${safeFileName(archiveTitle(record))}_定制.docx`, result.blob);
      logEvent({
        type: 'custom_export',
        at: Date.now(),
        format: 'docx',
        count: result.applied,
        skipped: result.skipped
      });
      toast(
        result.fallback
          ? EXPORT_FALLBACK_NOTICE
          : result.skipped > 0
            ? `已导出，其中 ${result.skipped} 处改动没能对应到原文件，已按原文保留`
            : '已导出与原文件排版一致的 Word'
      );
    } catch {
      toast('导出失败，可改用「复制全文」');
    } finally {
      setExporting(false);
    }
  };

  const confirmAndRemove = (record: CustomResumeRecord) => {
    const ok = window.confirm(
      `删除「${archiveTitle(record)}」？删除后无法恢复，原始简历不受影响。`
    );
    if (ok) {
      removeArchive(record.id);
      toast('已删除这份定制简历，原始简历未受影响');
    }
  };

  if (!archive.length) {
    return (
      <div>
        <PageTitle
          title="定制简历"
          description="每份定制简历都绑定它对应的岗位 JD，投递时一眼看出是哪家公司哪个岗位。"
        />
        <Card>
          <div className="py-10 text-center">
            <p className="text-sm text-[#6b7688]">还没有定制简历</p>
            <p className="mt-2 text-xs text-[#98a2b6]">
              到「按 JD 改简历」生成建议并采纳至少 1 条，即可保存成这个岗位的定制版本。
            </p>
            <button
              type="button"
              className="btn-primary mt-4"
              onClick={() => setView('custom')}
            >
              去改简历
            </button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageTitle
        title="定制简历"
        description={`共 ${archive.length} 份 · 每份都只适用于它对应的岗位，删除不影响原始简历。`}
      />

      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        <div className="space-y-2" id="archiveList">
          {archive.map((record) => (
            <div
              key={record.id}
              data-testid="archive-item"
              className={`group relative cursor-pointer rounded-xl border p-3 transition ${
                record.id === selected?.id
                  ? 'border-primary bg-primary-soft/40'
                  : 'border-[#e5e9f2] bg-white hover:border-[#c9d3e8]'
              }`}
              onClick={() => selectArchive(record.id)}
            >
              <div className="truncate pr-6 text-sm font-medium" title={archiveTitle(record)}>
                {archiveTitle(record)}
              </div>
              <div className="mt-1 text-xs text-[#98a2b6]">
                {formatTime(record.createdAt)} · 采纳 {record.adoptedCount} 条 ·{' '}
                {record.charCount} 字
              </div>
              <div className="mt-1 text-[11px] text-[#b45309]">
                仅适用于该岗位，投递其他岗位请重新生成
              </div>
              <button
                type="button"
                title="删除这份"
                aria-label="删除这份"
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
            <label htmlFor="archiveTitle" className="text-xs text-[#98a2b6]">
              记录名称（留空则回退为从 JD 解析出的名称）
            </label>
            <input
              id="archiveTitle"
              className="field mt-1"
              maxLength={MAX_TITLE_LENGTH}
              value={selected.name}
              placeholder={archiveTitle(selected)}
              onChange={(event) => renameArchive(selected.id, event.target.value)}
              onBlur={(event) => {
                if (!event.target.value.trim()) renameArchive(selected.id, '');
              }}
            />

            <div className="mt-4">
              <h3 className="mb-2 text-sm font-medium">定制简历全文</h3>
              <textarea
                id="archiveText"
                readOnly
                className="field min-h-[420px] font-mono text-xs leading-6"
                value={selected.content}
              />
            </div>

            <div className="mt-4">
              <h3 className="mb-2 text-sm font-medium">对应岗位 JD</h3>
              <textarea
                id="archiveJd"
                readOnly
                className="field min-h-[220px] text-xs leading-6"
                value={selected.jdText}
              />
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                id="exportArchive"
                type="button"
                className="btn-ghost"
                disabled={!template || exporting}
                onClick={() => void exportRecord(selected)}
              >
                {exporting ? '导出中…' : '导出 Word'}
              </button>
              <button
                id="copyArchive"
                type="button"
                className="btn-ghost"
                onClick={async () => {
                  const ok = await copyText(selected.content);
                  toast(ok ? '定制简历已复制' : '复制失败，请手动选择');
                }}
              >
                复制全文
              </button>
              <button
                id="deleteArchive"
                type="button"
                className="btn-ghost text-[#b42318]"
                onClick={() => confirmAndRemove(selected)}
              >
                删除这份
              </button>
            </div>

            {!template && (
              <p className="mt-3 text-xs text-[#98a2b6]" data-testid="archive-export-notice">
                {EXPORT_TEMPLATE_NOTICE}
              </p>
            )}

            <div className="mt-3">
              <Notice tone="muted">
                这份简历只针对「{archiveTitle(selected)}」生成，投递其他岗位建议重新生成，
                以免内容与岗位不匹配。
              </Notice>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
