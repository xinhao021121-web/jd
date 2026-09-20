/**
 * 模型选型对比的纯逻辑（差距诊断 G6 / G7）：把逐次运行记录汇总成模型级指标。
 * 与 CLI 脚本分开，便于单测——真实调用要花钱，纯逻辑不该靠真实调用验证。
 */

export type CompareTask = 'greeting' | 'suggestions';

export interface RunRecord {
  model: string;
  sample: string;
  task: CompareTask;
  /** 本地自检命中的违规条数 */
  violations: number;
  firstTokenMs: number | null;
  elapsedMs: number;
  promptTokens: number;
  completionTokens: number;
}

export interface ModelSummary {
  model: string;
  runs: number;
  samples: number;
  violations: number;
  /** 端点未返回用量时全为 0 */
  usageAvailable: boolean;
  avgFirstTokenMs: number | null;
  avgElapsedMs: number;
  avgPromptTokens: number;
  avgCompletionTokens: number;
  /** 一个样本跑完话术 + 建议的合计，即 G7 口径的「一次完整生成」 */
  perGeneration: {
    promptTokens: number;
    completionTokens: number;
    elapsedMs: number;
  };
}

const round1 = (value: number): number => Math.round(value * 10) / 10;

const mean = (values: number[]): number =>
  values.length ? round1(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;

export function parseModels(raw: string | undefined, fallback: string[]): string[] {
  const list = (raw ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return list.length ? list : fallback;
}

/** 每个模型一行汇总；样本级合计再平均，避免任务数不等时把均值拉偏 */
export function summarizeByModel(records: RunRecord[]): ModelSummary[] {
  const models = [...new Set(records.map((record) => record.model))];

  return models.map((model) => {
    const own = records.filter((record) => record.model === model);
    const samples = [...new Set(own.map((record) => record.sample))];

    const perSample = samples.map((sample) => {
      const runs = own.filter((record) => record.sample === sample);
      return {
        promptTokens: runs.reduce((sum, run) => sum + run.promptTokens, 0),
        completionTokens: runs.reduce((sum, run) => sum + run.completionTokens, 0),
        elapsedMs: runs.reduce((sum, run) => sum + run.elapsedMs, 0)
      };
    });

    const firstTokens = own
      .map((record) => record.firstTokenMs)
      .filter((value): value is number => value !== null);

    return {
      model,
      runs: own.length,
      samples: samples.length,
      violations: own.reduce((sum, record) => sum + record.violations, 0),
      usageAvailable: own.some((record) => record.promptTokens > 0),
      avgFirstTokenMs: firstTokens.length ? mean(firstTokens) : null,
      avgElapsedMs: mean(own.map((record) => record.elapsedMs)),
      avgPromptTokens: mean(own.map((record) => record.promptTokens)),
      avgCompletionTokens: mean(own.map((record) => record.completionTokens)),
      perGeneration: {
        promptTokens: mean(perSample.map((item) => item.promptTokens)),
        completionTokens: mean(perSample.map((item) => item.completionTokens)),
        elapsedMs: mean(perSample.map((item) => item.elapsedMs))
      }
    };
  });
}

/**
 * 按「输入 $x / 百万 token、输出 $y / 百万 token」折算一次完整生成的成本。
 * 单价由调用方给出，脚本不内置任何价目——单价是账单事实，不该由代码猜。
 */
export function costPerGeneration(
  summary: ModelSummary,
  pricePerMillionInput: number,
  pricePerMillionOutput: number
): number {
  return Number(
    (
      (summary.perGeneration.promptTokens / 1_000_000) * pricePerMillionInput +
      (summary.perGeneration.completionTokens / 1_000_000) * pricePerMillionOutput
    ).toFixed(6)
  );
}
