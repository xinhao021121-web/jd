/**
 * JD 图片导入（PRD 增补 3.7）：入口是 JD 输入框下方的整行虚线按钮，也可把图片拖到按钮上、
 * 或直接粘贴截图。识别结果只追加不覆盖，回填后进入校对态。
 */
import { useRef, useState, type DragEvent } from 'react';
import { ERROR_MESSAGES, MAX_IMAGE_BYTES, MAX_IMAGE_COUNT } from '@zhipin/shared';
import { recognizeImage } from '../api/vision';
import { useAppStore } from '../store/store';
import { ImportError, assertJdImage, compressImage } from '../utils/import';
import { Notice } from './ui';

const ACCEPT = 'image/png,image/jpeg,image/webp';
const MAX_MB = Math.round(MAX_IMAGE_BYTES / 1024 / 1024);

export type JdImportStage = 'idle' | 'compressing' | 'recognizing';

export interface JdImageImportState {
  stage: JdImportStage;
  error: string | null;
  dragging: boolean;
  importFiles: (files: File[]) => void;
  cancel: () => void;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDragLeave: () => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
}

export function useJdImageImport(): JdImageImportState {
  const appendJdImport = useAppStore((state) => state.appendJdImport);
  const [stage, setStage] = useState<JdImportStage>('idle');
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  const importFiles = (files: File[]) => {
    if (!files.length) return;

    // 单次最多 3 张，可连续导入多批（PRD 增补 3.7）
    const selected = files.slice(0, MAX_IMAGE_COUNT);
    setError(
      files.length > MAX_IMAGE_COUNT
        ? `单次最多导入 ${MAX_IMAGE_COUNT} 张，已保留前 ${MAX_IMAGE_COUNT} 张`
        : null
    );

    const controller = new AbortController();
    controllerRef.current = controller;

    void (async () => {
      try {
        // 逐张处理：便于逐张显示进度，单张失败可单独重试
        for (const file of selected) {
          setStage('compressing');
          assertJdImage(file);
          const dataUrl = await compressImage(file);

          setStage('recognizing');
          const outcome = await recognizeImage(dataUrl, { signal: controller.signal });

          if (outcome.status === 'aborted') return;
          if (outcome.status === 'error') {
            setError(ERROR_MESSAGES[outcome.code]);
            return;
          }
          if (!outcome.text.trim()) {
            setError(ERROR_MESSAGES.VISION_EMPTY);
            return;
          }

          appendJdImport(outcome.text);
        }
      } catch (caught) {
        setError(caught instanceof ImportError ? caught.message : ERROR_MESSAGES.VISION_FAILED);
      } finally {
        setStage('idle');
        controllerRef.current = null;
      }
    })();
  };

  return {
    stage,
    error,
    dragging,
    importFiles,
    /** 用户中途取消：中止请求，JD 保持原样 */
    cancel: () => controllerRef.current?.abort(),
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

export function JdImageImportButton({
  id,
  state
}: {
  id: string;
  state: JdImageImportState;
}): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = state.stage !== 'idle';

  return (
    <div>
      <button
        id={id}
        type="button"
        className={`w-full rounded-xl border border-dashed px-4 py-2.5 text-left text-xs leading-5 transition disabled:opacity-60 ${
          state.dragging
            ? 'border-primary bg-primary-soft/40 text-[#1f52d6]'
            : 'border-[#c3cbd9] bg-white text-[#6b7688] hover:border-primary hover:text-primary'
        }`}
        disabled={busy}
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
        {state.stage === 'compressing'
          ? '正在压缩图片…'
          : state.stage === 'recognizing'
            ? '识别中…'
            : `导入 JD 截图（PNG / JPG / WebP，单张 ≤ ${MAX_MB}MB，单次最多 ${MAX_IMAGE_COUNT} 张）`}
      </button>

      <input
        ref={inputRef}
        id={`${id}File`}
        type="file"
        accept={ACCEPT}
        multiple
        className="hidden"
        onChange={(event) => {
          state.importFiles(Array.from(event.target.files ?? []));
          // 清空选择，允许连续导入同一张截图
          event.target.value = '';
        }}
      />

      {busy && (
        <div className="mt-2 flex items-center justify-between gap-3 rounded-xl bg-[#f6f8fc] px-3 py-2 text-xs text-[#6b7688]">
          <span>
            图片只在本次请求内转发，由同一模型服务商（DeepSeek）识别，服务端不保存；识别结果需要你核对后再生成
          </span>
          <button type="button" className="btn-link flex-none" onClick={state.cancel}>
            取消
          </button>
        </div>
      )}

      {state.error && (
        <div className="mt-2" data-testid="jd-import-error">
          <Notice tone="warn">{state.error}</Notice>
        </div>
      )}
    </div>
  );
}
