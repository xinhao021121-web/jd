import { MIN_TEXT_LENGTH } from '@zhipin/shared';
import { useAppStore } from '../store/store';
import { countChars } from '../utils/format';
import { Notice } from './ui';

/** JD 输入框：生成打招呼与按 JD 改简历共用同一份内容（PRD 3.5） */
export function JdField({ id = 'jd' }: { id?: string }): JSX.Element {
  const jd = useAppStore((state) => state.jd);
  const resume = useAppStore((state) => state.resume);
  const setJd = useAppStore((state) => state.setJd);
  const setView = useAppStore((state) => state.setView);

  const jdCount = countChars(jd);
  const hasResume = resume.length >= MIN_TEXT_LENGTH;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <label htmlFor={id} className="text-sm font-medium">
          岗位 JD
        </label>
        <span className="text-xs text-[#98a2b6]">{jdCount} 字</span>
      </div>

      <textarea
        id={id}
        className="field min-h-[180px]"
        placeholder="把招聘平台上的岗位 JD 粘贴到这里（岗位职责 + 任职要求）"
        value={jd}
        onChange={(event) => setJd(event.target.value)}
      />

      <div className="mt-2">
        {!hasResume ? (
          <Notice tone="warn">
            还没有保存简历，先到
            <button
              type="button"
              className="btn-link px-1 font-medium"
              onClick={() => setView('resume')}
            >
              我的简历
            </button>
            填写并保存
          </Notice>
        ) : jdCount < MIN_TEXT_LENGTH ? (
          <Notice tone="muted">粘贴岗位 JD 后即可生成（至少 {MIN_TEXT_LENGTH} 字）</Notice>
        ) : (
          <Notice tone="info">内容已就绪，简历与这个 JD 会一起交给模型生成</Notice>
        )}
      </div>
    </div>
  );
}
