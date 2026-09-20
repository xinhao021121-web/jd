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

export interface LineChange {
  before: string;
  after: string;
}

/**
 * 从「原始简历」与「定制简历全文」反推被改动过的行（存档记录的导出用）。
 *
 * 合成只做行内替换、不增删行，所以逐行比较就够了。反过来，**行数不一致就意味着
 * 原始简历在存档之后被改过**，此时逐行对齐不再可信——硬比会把甲行的文字填到乙行，
 * 用户很难发现。这种静默错误比「这份记录暂时导不出来」严重得多，因此直接放弃。
 *
 * 行数一致时仍要求「该行文本在原文里唯一出现」，避免同文行被替换到别处。
 */
export function diffResumeLines(resume: string, content: string): LineChange[] {
  const source = (resume || '').split('\n');
  const target = (content || '').split('\n');
  if (source.length !== target.length) return [];

  const occurrences = new Map<string, number>();
  source.forEach((line) => occurrences.set(line, (occurrences.get(line) ?? 0) + 1));

  const changes: LineChange[] = [];

  for (let index = 0; index < source.length; index += 1) {
    const before = source[index] as string;
    const after = target[index] as string;
    if (before === after) continue;
    // 空行变化没有可回填的内容，也避免拿空字符串去定位
    if (!before.trim() || !after.trim()) continue;
    if (occurrences.get(before) !== 1) continue;
    changes.push({ before, after });
  }

  return changes;
}
