/**
 * 简历区块切分与锁定判定（PRD 3.3）。
 * 未识别的小标题一律按锁定处理：宁可少改也不越界。
 */

export const EDITABLE_TITLES = [
  '项目经历',
  '项目经验',
  '工作经历',
  '实习经历',
  '实习经验',
  '自我评价',
  '个人优势',
  '专业技能',
  '技能特长',
  '技能清单'
] as const;

export const LOCKED_TITLES = ['个人信息', '基本信息', '教育经历', '教育背景', '学历'] as const;

/** 简历开头部分（姓名、目标岗位、年限）没有小标题，单独成块并锁定 */
export const RESUME_HEAD_TITLE = '（简历开头）';

const HEADING_PATTERN = [
  ...LOCKED_TITLES,
  ...EDITABLE_TITLES
].join('|');

export const HEADING_RE = new RegExp(
  `^\\s*[【\\[]?\\s*(${HEADING_PATTERN})\\s*[】\\]]?\\s*[:：]?\\s*$`
);

export type BlockKind = 'editable' | 'locked';

export interface ResumeBlock {
  title: string;
  kind: BlockKind;
  /** 含标题行在内的原始行，保持原文与顺序 */
  lines: string[];
}

export function classifyBlock(title: string): BlockKind {
  return (EDITABLE_TITLES as readonly string[]).includes(title) ? 'editable' : 'locked';
}

export function isHeading(line: string): boolean {
  return HEADING_RE.test(line);
}

export function parseResume(text: string): ResumeBlock[] {
  const head: ResumeBlock = { title: RESUME_HEAD_TITLE, kind: 'locked', lines: [] };
  const blocks: ResumeBlock[] = [head];
  let current = head;

  (text || '').split('\n').forEach((line) => {
    const matched = line.match(HEADING_RE);
    if (matched && matched[1]) {
      current = { title: matched[1], kind: classifyBlock(matched[1]), lines: [line] };
      blocks.push(current);
      return;
    }
    current.lines.push(line);
  });

  return blocks;
}

export function joinBlocks(blocks: ResumeBlock[]): string {
  return blocks.map((block) => block.lines.join('\n')).join('\n');
}
