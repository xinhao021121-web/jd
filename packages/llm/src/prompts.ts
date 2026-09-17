/**
 * 两种任务的提示词模板。
 * 产品规则（区块锁定、长度、事实溯源、禁用套话）写进系统提示，
 * 但真正的兜底在本地确定性代码：任何越界建议都会被 planSuggestions 丢弃。
 */
import { EDITABLE_TITLES, analyzeMatch, parseResume } from '@zhipin/core';
import {
  GREETING_LENGTH,
  GREETING_STYLES,
  type TaskKind
} from '@zhipin/shared';

export interface LlmMessage {
  role: 'system' | 'user';
  content: string;
}

export interface PromptInput {
  resume: string;
  jd: string;
}

const OUTPUT_CONTRACT = [
  '输出协议（必须严格遵守）：',
  '- 只输出 NDJSON：一行一个完整 JSON 对象，行与行之间用换行分隔；',
  '- 不要输出 Markdown 代码块、标题、解释文字或多余空行；',
  '- 不要输出 analysis 事件，匹配分析由本地代码计算；',
  '- 所有字符串值内部不得出现换行符。'
].join('\n');

const GREETING_SYSTEM = [
  '你是一名资深中文求职助理，为求职者撰写招聘平台上的打招呼话术。',
  '硬性规则：',
  '1. 事实溯源：话术里出现的每一段经历、技能、数字都必须能在简历原文找到依据，禁止编造或推测简历中没有的内容；',
  '2. 结构：身份定位（年限 + 方向）→ 1~2 个与岗位强相关的匹配证据 → 明确意向；',
  `3. 长度：每条 ${GREETING_LENGTH.min}~${GREETING_LENGTH.max} 个汉字，2~4 句；`,
  '4. 风格：不出现「贵公司」「非常感兴趣」「期待您的青睐」「希望得到您的回复」这类套话，不堆砌表情符号，读起来像真人手写；',
  `5. 共输出 3 条互不重复的话术，style 依次为「${GREETING_STYLES.join('」「')}」；`,
  '6. 简历与岗位直接匹配点很少时，不要冒认技能，改为可迁移能力表述，并说明方向差异；',
  OUTPUT_CONTRACT,
  '每行形如：{"type":"item","kind":"greeting","index":0,"style":"技能匹配型","text":"..."}'
].join('\n');

const SUGGESTIONS_SYSTEM = [
  '你是一名资深中文简历顾问，帮求职者把简历改得更贴合某个岗位。',
  '硬性规则：',
  `1. 只允许改写这些区块：${EDITABLE_TITLES.join('、')}；个人信息、教育经历以及其他未识别的小标题一律不许改动，也不要为它们生成建议；`,
  '2. before 必须是简历原文中真实存在的一段连续文字，且位于同一行内，不得跨行、不得跨区块；',
  '3. after 不得新增原简历中不存在的事实、技能、数字或经历，只允许三类改写：术语对齐（已有量化结果的句子补上岗位关注的术语标签）、技能补充（简历正文里有依据但未列进技能清单的技能）、关键词补充（自我评价中补充已具备的岗位关键词）；',
  '4. reason 用一句面向求职者的话说明为什么改，不写空话；',
  '5. 岗位要求但简历完全没有依据的能力，不要生成建议；',
  '6. 优先给出 2~6 条最有价值的建议，宁少勿滥；',
  OUTPUT_CONTRACT,
  '每行形如：{"type":"item","kind":"suggestion","index":0,"section":"工作经历","before":"...","after":"...","reason":"...","suggestionType":"术语对齐"}'
].join('\n');

function editableBlockDigest(resume: string): string {
  return parseResume(resume)
    .filter((block) => block.kind === 'editable')
    .map((block) => {
      const body = block.lines
        .filter((line) => line.trim() && line.trim() !== block.title)
        .map((line) => `  ${line.trim()}`)
        .join('\n');
      return `【${block.title}】\n${body}`;
    })
    .join('\n');
}

function matchDigest(resume: string, jd: string): string {
  const analysis = analyzeMatch(resume, jd);
  return [
    `JD 关键要求：${analysis.requirements.join('、') || '无明显技能关键词'}`,
    `简历已命中：${analysis.matched.join('、') || '无'}`,
    `简历未覆盖：${analysis.missing.join('、') || '无'}`,
    `是否低匹配：${analysis.lowMatch ? '是（不要冒认技能，改为可迁移能力表述）' : '否'}`
  ].join('\n');
}

export function buildMessages(task: TaskKind, input: PromptInput): LlmMessage[] {
  const { resume, jd } = input;

  if (task === 'greeting') {
    return [
      { role: 'system', content: GREETING_SYSTEM },
      {
        role: 'user',
        content: [
          '【简历原文】',
          resume,
          '',
          '【岗位 JD】',
          jd,
          '',
          '【本地匹配分析，仅供你参考，不要输出】',
          matchDigest(resume, jd),
          '',
          '请输出 3 行 NDJSON，分别对应技能匹配型、经历相关型、简短直接型。'
        ].join('\n')
      }
    ];
  }

  return [
    { role: 'system', content: SUGGESTIONS_SYSTEM },
    {
      role: 'user',
      content: [
        '【简历原文】',
        resume,
        '',
        '【岗位 JD】',
        jd,
        '',
        '【本地匹配分析，仅供你参考，不要输出】',
        matchDigest(resume, jd),
        '',
        '【允许改写的区块（section 只能取这些标题，before 必须是下列行里的原文片段）】',
        editableBlockDigest(resume) || '（没有识别到可改写区块，请不要输出任何建议）',
        '',
        '请输出 2~6 行 NDJSON，每行一条改写建议。'
      ].join('\n')
    }
  ];
}
