import { MIN_TEXT_LENGTH } from '@zhipin/shared';
import { toast } from '../components/Toast';
import { Card, Notice, PageTitle } from '../components/ui';
import { useAppStore } from '../store/store';
import { countChars, formatTime } from '../utils/format';

/** 我的简历：长期资产的唯一维护入口，显式保存、不做自动保存（PRD 3.1） */
export function ResumeView(): JSX.Element {
  const resume = useAppStore((state) => state.resume);
  const savedAt = useAppStore((state) => state.savedAt);
  const draft = useAppStore((state) => state.resumeDraft);
  const setResumeDraft = useAppStore((state) => state.setResumeDraft);
  const saveResume = useAppStore((state) => state.saveResume);
  const revertResumeDraft = useAppStore((state) => state.revertResumeDraft);

  const draftCount = countChars(draft);
  const changed = draft.trim() !== resume;
  const tooShort = draftCount < MIN_TEXT_LENGTH;
  const canSave = !tooShort && changed;

  return (
    <div>
      <PageTitle
        title="我的简历"
        description="维护唯一一份原始简历。之后每个岗位的生成都会自动读取它，任何定制都不会写回这里。"
      />

      <Card>
        <div className="mb-2 flex items-center justify-between">
          <label htmlFor="resumeEditor" className="text-sm font-medium">
            简历内容
          </label>
          <span id="resumeCount" className="text-xs text-[#98a2b6]">
            {draftCount} 字
          </span>
        </div>

        <textarea
          id="resumeEditor"
          className="field min-h-[320px]"
          placeholder="把简历文本粘贴到这里，建议保留「工作经历 / 项目经历 / 自我评价 / 专业技能 / 教育背景」这类小标题，便于按行识别可改写区块"
          value={draft}
          onChange={(event) => setResumeDraft(event.target.value)}
        />

        <div className="mt-2">
          {draftCount > 0 && tooShort ? (
            <Notice tone="warn">简历内容太短，至少 {MIN_TEXT_LENGTH} 字才能保存</Notice>
          ) : changed ? (
            <Notice tone="muted">有未保存的编辑，生成时只会读取已保存的内容</Notice>
          ) : resume ? (
            <Notice tone="info">
              已保存 · {formatTime(savedAt)} · {countChars(resume)} 字
            </Notice>
          ) : (
            <Notice tone="warn">尚未保存简历，填写后点击「保存简历」</Notice>
          )}
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button
            id="saveResume"
            type="button"
            className="btn-primary"
            disabled={!canSave}
            onClick={() => {
              if (saveResume()) toast('简历已保存，生成时会自动读取');
            }}
          >
            保存简历
          </button>
          <button
            id="revertResume"
            type="button"
            className="btn-ghost"
            disabled={!changed}
            onClick={() => {
              revertResumeDraft();
              toast('已还原为上次保存的内容');
            }}
          >
            还原为上次保存
          </button>
        </div>
      </Card>

      <Card className="mt-4">
        <h3 className="text-sm font-medium">当前已保存的简历</h3>
        {resume ? (
          <p className="mt-2 text-sm text-[#6b7688]">
            共 {countChars(resume)} 字 · 保存于 {formatTime(savedAt)}
          </p>
        ) : (
          <p className="mt-2 text-sm text-[#98a2b6]">还没有保存任何简历内容</p>
        )}
        <p className="mt-3 text-xs text-[#98a2b6]">
          简历只需要维护一次；换岗位时只要在「生成打招呼」或「按 JD 改简历」里粘贴新的 JD。
        </p>
      </Card>
    </div>
  );
}
