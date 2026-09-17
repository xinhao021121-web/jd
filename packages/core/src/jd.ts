/**
 * 从 JD 解析「公司 · 岗位」作为定制简历记录名称（PRD 3.4 命名规则四级回退）。
 */
const COMPANY_FIELD_RE = /(?:公司名称|所属公司|公司|企业)\s*[:：]\s*([^\n，,。;；]{2,40})/;
const ROLE_FIELD_RE = /(?:职位名称|招聘岗位|岗位名称|岗位|职位)\s*[:：]\s*([^\n，,。;；]{2,40})/;
const COMPANY_WORD_RE = /(有限公司|集团|科技|网络|信息|软件|数据|智能|银行|证券|研究院|工作室)/;
const ROLE_WORD_RE = /(工程师|经理|专员|设计师|主管|总监|架构师|开发|运营|分析师|研究员)/;
const TRAILING_PAREN_RE = /[（(].*?[)）]\s*$/;

const MAX_PART_LENGTH = 22;

function trimPart(text: string): string {
  return text.trim().replace(TRAILING_PAREN_RE, '').slice(0, MAX_PART_LENGTH);
}

export function extractJdTitle(jd: string): string {
  const lines = (jd || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const pickField = (pattern: RegExp): string => {
    for (const line of lines) {
      const matched = line.match(pattern);
      if (matched && matched[1]) return trimPart(matched[1]);
    }
    return '';
  };

  let company = pickField(COMPANY_FIELD_RE);
  let role = pickField(ROLE_FIELD_RE);

  if (!company) {
    const hit = lines.slice(0, 6).find((line) => COMPANY_WORD_RE.test(line) && line.length <= 26);
    if (hit) company = trimPart(hit);
  }
  if (!role) {
    const hit = lines
      .slice(0, 8)
      .find((line) => ROLE_WORD_RE.test(line) && !COMPANY_WORD_RE.test(line) && line.length <= 26);
    if (hit) role = trimPart(hit);
  }

  const parts = [company, role].filter(Boolean);
  if (parts.length) return parts.join(' · ');
  return (lines[0] || '未命名岗位').slice(0, 26);
}
