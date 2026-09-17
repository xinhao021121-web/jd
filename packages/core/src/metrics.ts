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
  /** 零修改直接复制率，0–1 */
  cleanCopyRate: number;
  /** 被采纳过的建议条数 */
  adoptedSuggestionCount: number;
  customResumeCount: number;
  errorCount: number;
}

export function calcMetrics(events: TelemetryEvent[]): Metrics {
  const metrics: Metrics = {
    generateCount: 0,
    regenerateCount: 0,
    copyCount: 0,
    cleanCopyCount: 0,
    cleanCopyRate: 0,
    adoptedSuggestionCount: 0,
    customResumeCount: 0,
    errorCount: 0
  };

  events.forEach((event) => {
    switch (event.type) {
      case 'generate':
        metrics.generateCount += 1;
        break;
      case 'regenerate':
        metrics.regenerateCount += 1;
        break;
      case 'copy':
        metrics.copyCount += 1;
        if (!event.edited) metrics.cleanCopyCount += 1;
        break;
      case 'suggest_adopt':
        metrics.adoptedSuggestionCount += event.count ?? 1;
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
  return metrics;
}
