/**
 * 技能词典与匹配分析。
 * 纯函数，不依赖浏览器与网络：话术匹配分析、改写建议、未覆盖提示都基于这里。
 */
export interface SkillRule {
  name: string;
  keywords: string[];
}

export const SKILL_RULES: SkillRule[] = [
  { name: 'Java', keywords: ['java'] },
  { name: 'Spring Boot', keywords: ['spring boot', 'springboot', 'spring'] },
  { name: 'MySQL', keywords: ['mysql'] },
  { name: 'Redis', keywords: ['redis'] },
  { name: 'Kafka / 消息队列', keywords: ['kafka', 'rocketmq', '消息队列'] },
  { name: '微服务', keywords: ['微服务'] },
  { name: '高并发', keywords: ['高并发'] },
  { name: '分布式', keywords: ['分布式'] },
  { name: '性能优化', keywords: ['性能优化', '调优'] },
  { name: 'Docker / K8s', keywords: ['docker', 'kubernetes', 'k8s', '容器化', '容器'] },
  { name: 'Go', keywords: ['golang', 'go 语言', 'go语言'] },
  { name: 'Python', keywords: ['python'] },
  { name: '前端（Vue / React）', keywords: ['vue', 'react', '前端'] },
  { name: '数据分析', keywords: ['数据分析', 'bi 报表', '指标体系'] },
  { name: '产品设计', keywords: ['产品设计', '需求分析', '原型设计', '产品经理'] },
  { name: '项目管理', keywords: ['项目管理', '跨部门协作', '项目推进'] },
  { name: '用户研究', keywords: ['用户研究', '用户调研', '用户访谈'] },
  { name: '增长与转化', keywords: ['ab 测试', 'a/b 测试', '留存', '转化率', '增长'] }
];

/**
 * 英文关键词按词边界匹配，避免 "go" 命中 "golang" 之外的内容、"java" 命中 "javascript"；
 * 中文关键词直接按子串匹配。
 */
export function hasKeyword(text: string, keyword: string): boolean {
  const haystack = (text || '').toLowerCase();
  const needle = keyword.toLowerCase();
  if (/^[a-z0-9 +#./-]+$/.test(needle)) {
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(haystack);
  }
  return haystack.includes(needle);
}

export function extractSkills(text: string): string[] {
  return SKILL_RULES.filter((rule) => rule.keywords.some((kw) => hasKeyword(text, kw))).map(
    (rule) => rule.name
  );
}

export interface MatchAnalysis {
  /** JD 中出现的关键要求 */
  requirements: string[];
  /** 简历里能找到依据的要求 */
  matched: string[];
  /** 简历完全没有依据的要求 */
  missing: string[];
  /** 直接匹配点不足时为 true，话术转为可迁移能力表述（PRD 3.2） */
  lowMatch: boolean;
}

export function analyzeMatch(resume: string, jd: string): MatchAnalysis {
  const requirements = extractSkills(jd);
  const resumeSkills = extractSkills(resume);
  const matched = requirements.filter((skill) => resumeSkills.includes(skill));
  const missing = requirements.filter((skill) => !resumeSkills.includes(skill));
  return { requirements, matched, missing, lowMatch: matched.length === 0 };
}
