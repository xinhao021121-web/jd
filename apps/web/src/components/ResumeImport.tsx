/**
 * 简历文件导入（PRD 增补 3.6）：入口是简历输入框上方的整行虚线按钮，也可把文件拖到按钮或输入框。
 * 文件只在本机解析，解析结果先进草稿；解析中 / 报错 / 预览都是瞬时状态，不进 localStorage。
 */
import { useRef, useState, type DragEvent } from 'react';
import { ERROR_MESSAGES, MAX_RESUME_FILE_BYTES } from '@zhipin/shared';
import { useAppStore } from '../store/store';
import { ImportError, fileExtension, parseResumeFile } from '../utils/import';
import { toast } from './Toast';
import { Notice } from './ui';

const ACCEPT = '.txt,.md,.markdown,.docx,.pdf';
const MAX_MB = Math.round(MAX_RESUME_FILE_BYTES / 1024 / 1024);

export interface ResumeImportInfo {
  /** 文件名只用于当次提示，不写入本地存储与行为记录 */
  fileName: string;
  chars: number;
}

export interface ResumeImportState {
  busy: boolean;
  error: string | null;
  info: ResumeImportInfo | null;
  dragging: boolean;
  importFiles: (files: File[]) => void;
  reset: () => void;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDragLeave: () => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
}

export function useResumeImport(): ResumeImportState {
  const draft = useAppStore((state) => state.resumeDraft);
  const setResumeDraft = useAppStore((state) => state.setResumeDraft);
  const record = useAppStore((state) => state.record);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<ResumeImportInfo | null>(null);
  const [dragging, setDragging] = useState(false);

  const importFiles = (files: File[]) => {
    const file = files[0];
    if (!file) return;

    setError(null);
    setBusy(true);

    void (async () => {
      try {
        const text = await parseResumeFile(file);
        // 草稿已有内容时先二次确认，取消则草稿保持原样（PRD 增补 3.6）
        const confirmed =
          !draft.trim() ||
          window.confirm(
            `导入「${file.name}」会覆盖草稿里已有的内容。覆盖后未保存前，仍可用「还原为上次保存」恢复。`
          );
        if (!confirmed) return;

        setResumeDraft(text);
        const chars = [...text].length;
        setInfo({ fileName: file.name, chars });
        record({ type: 'resume_import', at: Date.now(), format: fileExtension(file.name), chars });
        toast('解析完成，记得点「保存简历」');
      } catch (caught) {
        setError(caught instanceof ImportError ? caught.message : ERROR_MESSAGES.PARSE_EMPTY);
      } finally {
        setBusy(false);
      }
    })();
  };

  return {
    busy,
    error,
    info,
    dragging,
    importFiles,
    reset: () => setInfo(null),
    onDragOver: (event) => {
      event.preventDefault();
      setDragging(true);
    },
    onDragLeave: () => setDragging(false),
    onDrop: (event) => {
      event.preventDefault();
      setDragging(false);
      importFiles(Array.from(event.dataTransfer?.files ?? []));
    }
  };
}

export function ResumeImportButton({ state }: { state: ResumeImportState }): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="mb-2">
      <button
        id="importResume"
        type="button"
        className={`w-full rounded-xl border border-dashed px-4 py-3 text-left transition disabled:opacity-60 ${
          state.dragging
            ? 'border-primary bg-primary-soft/40'
            : 'border-[#c3cbd9] bg-white hover:border-primary'
        }`}
        disabled={state.busy}
        onClick={() => {
          const input = inputRef.current;
          if (!input) return;
          input.value = '';
          input.click();
        }}
        onDragOver={state.onDragOver}
        onDragLeave={state.onDragLeave}
        onDrop={state.onDrop}
      >
        <span className="text-sm font-medium text-[#1b2333]">
          {state.busy ? '正在本机解析…' : '导入简历文件'}
        </span>
        <span className="mt-1 block text-xs leading-5 text-[#98a2b6]">
          支持 TXT / Markdown / Word / 文本层 PDF，单个文件 ≤ {MAX_MB}MB；文件只在本机解析、不上传，
          导入结果先进入草稿，需点「保存简历」才生效
        </span>
      </button>

      <input
        ref={inputRef}
        id="resumeFile"
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(event) => {
          state.importFiles(Array.from(event.target.files ?? []));
          // 清空选择，允许连续导入同一个文件（例如改完再看一遍）
          event.target.value = '';
        }}
      />

      {state.error && (
        <div className="mt-2" data-testid="resume-import-error">
          <Notice tone="warn">{state.error}</Notice>
        </div>
      )}
    </div>
  );
}
