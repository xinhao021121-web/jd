/**
 * 由本地行为记录计算验证指标（PRD 1.1.3 / 4.2）。
 * 纯函数：输入事件数组，输出指标，便于单测。
 */
import type { TelemetryEvent } from '@zhipin/shared';

export interface Metrics {
  generateCount: number;
  regenerateCount: number;
  copyCount: number;
  /** 未经编辑直接复制的话术条数 */
  cleanCopyCount: number;
  /** 条级零修改直接复制率（辅助指标），0–1 */
  cleanCopyRate: number;
  /** 会话级：至少有一条未编辑话术被复制的生成次数 */
  cleanCopySessionCount: number;
  /**
   * 会话级零修改直接复制率（PRD 1.1.3 主指标），0–1。
   * 分母是成功产出话术的生成次数，分子是其中至少复制过一条未编辑话术的次数。
   */
  cleanCopySessionRate: number;
  /** 生成改写建议的次数（采纳率的分母） */
  suggestGenerateCount: number;
  /** 至少采纳过 1 条建议的会话数 */
  adoptedSessionCount: number;
  /** 至少采纳 1 条建议的比例（PRD 1.1.3），0–1 */
  adoptionRate: number;
  /** 每次生成的平均可采纳建议数（PRD 维度 6 下限 2 条） */
  suggestionsPerSession: number;
  /** 被采纳过的建议条数 */
  adoptedSuggestionCount: number;
  customResumeCount: number;
  errorCount: number;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

export function calcMetrics(events: TelemetryEvent[]): Metrics {
  const metrics: Metrics = {
    generateCount: 0,
    regenerateCount: 0,
    copyCount: 0,
    cleanCopyCount: 0,
    cleanCopyRate: 0,
    cleanCopySessionCount: 0,
    cleanCopySessionRate: 0,
    suggestGenerateCount: 0,
    adoptedSessionCount: 0,
    adoptionRate: 0,
    suggestionsPerSession: 0,
    adoptedSuggestionCount: 0,
    customResumeCount: 0,
    errorCount: 0
  };

  // 会话聚合：事件里的 sessionId 缺失时（旧记录）只计入总量，不计入会话口径
  const greetingSessions = new Set<string>();
  const cleanCopySessions = new Set<string>();
  const suggestionSessions = new Set<string>();
  const adoptedBySession = new Map<string, number>();
  let suggestionSupply = 0;

  events.forEach((event) => {
    switch (event.type) {
      case 'generate':
        metrics.generateCount += 1;
        if (event.sessionId) greetingSessions.add(event.sessionId);
        break;
      case 'regenerate':
        metrics.regenerateCount += 1;
        break;
      case 'copy':
        metrics.copyCount += 1;
        if (!event.edited) {
          metrics.cleanCopyCount += 1;
          if (event.sessionId) cleanCopySessions.add(event.sessionId);
        }
        break;
      case 'suggest_generate':
        metrics.suggestGenerateCount += 1;
        suggestionSupply += event.count ?? 0;
        if (event.sessionId) suggestionSessions.add(event.sessionId);
        break;
      case 'suggest_adopt':
        metrics.adoptedSuggestionCount += event.count ?? 1;
        if (event.sessionId) {
          adoptedBySession.set(
            event.sessionId,
            (adoptedBySession.get(event.sessionId) ?? 0) + (event.count ?? 1)
          );
        }
        break;
      case 'custom_save':
        metrics.customResumeCount += 1;
        break;
      case 'error':
        metrics.errorCount += 1;
        break;
      default:
        break;
    }
  });

  metrics.cleanCopyRate = metrics.copyCount ? metrics.cleanCopyCount / metrics.copyCount : 0;

  metrics.cleanCopySessionCount = [...cleanCopySessions].filter((id) =>
    greetingSessions.has(id)
  ).length;
  metrics.cleanCopySessionRate = greetingSessions.size
    ? metrics.cleanCopySessionCount / greetingSessions.size
    : 0;

  metrics.adoptedSessionCount = [...adoptedBySession.entries()].filter(
    ([id, net]) => net > 0 && suggestionSessions.has(id)
  ).length;
  metrics.adoptionRate = suggestionSessions.size
    ? metrics.adoptedSessionCount / suggestionSessions.size
    : 0;
  metrics.suggestionsPerSession = suggestionSessions.size
    ? round2(suggestionSupply / suggestionSessions.size)
    : 0;

  return metrics;
}
