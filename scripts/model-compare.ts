/**
 * 模型选型对比（差距诊断 G6）与单位经济性取数（G7）。
 *
 * 同一批样本、同一套提示词、同一份本地自检，跑多个模型，比较三件事：
 * 质量（自检违规数）、延迟（首字与完整）、成本（token 用量）。
 *
 * 运行（需要可用的模型端点）：
 *   pnpm model:compare
 *   pnpm model:compare -- --models=deepseek-flash,deepseek-v4-pro --samples=8
 *   pnpm model:compare -- --price-in=0.15 --price-out=0.6   # 两个单价都给才折算金额
 *
 * 单价不内置：价目是账单事实，应由使用者提供；不给单价时报告只报 token。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createLlmClient, type LlmClient } from '@zhipin/llm';
import { checkGreetings, checkSuggestions, parseResume, planSuggestions } from '@zhipin/core';
import type { OutputEvent } from '@zhipin/shared';
import { loadEnvFile } from '../apps/api/src/env';
import {
  costPerGeneration,
  parseModels,
  summarizeByModel,
  type CompareTask,
  type RunRecord
} from './model-compare-checks';

interface Sample {
  id: string;
  note: string;
  resume: string;
  jd: string;
}

const DEFAULT_MODELS = ['deepseek-flash', 'deepseek-v4-pro'];

function argValue(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function optionalNumber(name: string): number | null {
  const raw = argValue(name, '');
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function extractSuggestions(events: OutputEvent[]) {
  return events
    .filter(
      (event): event is Extract<OutputEvent, { kind: 'suggestion' }> =>
        event.type === 'item' && event.kind === 'suggestion'
    )
    .map((event) => ({
      section: event.section,
      before: event.before,
      after: event.after,
      reason: event.reason,
      suggestionType: event.suggestionType
    }));
}

async function runOne(
  client: LlmClient,
  model: string,
  sample: Sample,
  task: CompareTask
): Promise<RunRecord> {
  const events: OutputEvent[] = [];
  const result = await client.runTask(
    task,
    { resume: sample.resume, jd: sample.jd },
    { onEvent: (event) => void events.push(event) }
  );

  const violations =
    task === 'greeting'
      ? checkGreetings(sample.resume, events).length
      : checkSuggestions(sample.resume, extractSuggestions(events), sample.jd).length;

  return {
    model,
    sample: sample.id,
    task,
    violations,
    firstTokenMs: result.firstTokenMs,
    elapsedMs: result.elapsedMs,
    promptTokens: result.tokenUsage.promptTokens,
    completionTokens: result.tokenUsage.completionTokens
  };
}

async function main(): Promise<void> {
  loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));

  const apiKey = process.env.DEEPSEEK_API_KEY ?? '';
  if (!apiKey) {
    console.error('缺少 DEEPSEEK_API_KEY：模型对比需要可用的模型端点');
    process.exit(2);
  }

  const baseUrl = argValue('base-url', process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1');
  const models = parseModels(argValue('models', ''), DEFAULT_MODELS);
  const sampleLimit = Number(argValue('samples', '8'));
  const priceIn = optionalNumber('price-in');
  const priceOut = optionalNumber('price-out');
  const showCost = priceIn !== null && priceOut !== null;

  const samplesPath = new URL('../tests/samples/quality-samples.json', import.meta.url);
  const allSamples = JSON.parse(readFileSync(samplesPath, 'utf8')) as Sample[];
  const samples = allSamples.slice(0, sampleLimit);

  console.log(
    `模型：${models.join(' / ')}；样本 ${samples.length} 组；任务 2 个；预计 ${models.length * samples.length * 2} 次调用`
  );

  const records: RunRecord[] = [];

  for (const model of models) {
    const client = createLlmClient({ apiKey, baseUrl, model });
    for (const sample of samples) {
      for (const task of ['greeting', 'suggestions'] as CompareTask[]) {
        const record = await runOne(client, model, sample, task);
        records.push(record);
        console.log(
          `  ${model} · ${sample.id} · ${task}：${record.violations} 违规，${record.elapsedMs} ms，${record.promptTokens}+${record.completionTokens} tokens`
        );
      }
    }
  }

  const summaries = summarizeByModel(records);
  const reportDir = new URL('../reports/', import.meta.url);
  mkdirSync(reportDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
  const reportPath = new URL(`模型选型对比_${stamp}.md`, reportDir);

  const lines: string[] = [
    '# 模型选型对比',
    '',
    `- 运行时间：${new Date().toLocaleString('zh-CN')}`,
    `- 端点：${baseUrl}`,
    `- 样本：${samples.length} 组；每样本跑话术与改写建议两个任务`,
    `- 本地自检：话术与建议的判定函数与线上一致`,
    ''
  ];

  lines.push('## 汇总', '', '| 模型 | 运行次数 | 违规合计 | 平均首字 | 平均完整 | 平均 input | 平均 output |');
  lines.push('|------|---------|---------|---------|---------|-----------|------------|');
  summaries.forEach((summary) => {
    lines.push(
      `| ${summary.model} | ${summary.runs} | ${summary.violations} | ${
        summary.avgFirstTokenMs === null ? '—' : `${summary.avgFirstTokenMs} ms`
      } | ${summary.avgElapsedMs} ms | ${summary.avgPromptTokens} | ${summary.avgCompletionTokens} |`
    );
  });

  const usageAvailable = summaries.some((summary) => summary.usageAvailable);
  lines.push('', '## 一次完整生成（话术 + 改写建议）', '');

  if (usageAvailable) {
    lines.push(
      // 表头与分隔行必须相邻，中间夹空行会让 Markdown 表格断成两段
      '| 模型 | input tokens | output tokens | 合计耗时 |',
      '|------|-------------|--------------|---------|',
      ...summaries.map(
        (summary) =>
          `| ${summary.model} | ${summary.perGeneration.promptTokens} | ${summary.perGeneration.completionTokens} | ${summary.perGeneration.elapsedMs} ms |`
      )
    );

    if (showCost) {
      lines.push(
        '',
        `按 input $${priceIn}/M、output $${priceOut}/M 折算（单价由运行参数给出，非脚本内置）：`,
        '',
        '| 模型 | 单次完整生成成本（美元） | 1 万次生成的成本（美元） |',
        '|------|------------------------|------------------------|'
      );
      summaries.forEach((summary) => {
        const cost = costPerGeneration(summary, priceIn as number, priceOut as number);
        lines.push(`| ${summary.model} | ${cost} | ${(cost * 10000).toFixed(2)} |`);
      });
    } else {
      lines.push(
        '',
        '> 未提供单价参数，只报 token。补 `--price-in=` 与 `--price-out=` 可一并折算成本。'
      );
    }
  } else {
    lines.push('端点未返回 token 用量（`usage` 字段为空），成本无法折算。');
  }

  lines.push(
    '',
    '## 明细',
    '',
    '| 模型 | 样本 | 任务 | 违规 | 首字 | 完整 | input | output |',
    '|------|------|------|------|------|------|-------|--------|'
  );
  records.forEach((record) => {
    lines.push(
      `| ${record.model} | ${record.sample} | ${record.task} | ${record.violations} | ${
        record.firstTokenMs === null ? '—' : `${record.firstTokenMs} ms`
      } | ${record.elapsedMs} ms | ${record.promptTokens} | ${record.completionTokens} |`
    );
  });

  lines.push(
    '',
    '> 质量判定用的是线上同一套本地自检（`packages/core`），不是人工评分；',
    '> 结果是「合规性」对比，不是「好不好」对比——主观质量由外部盲测覆盖。'
  );

  writeFileSync(reportPath, lines.join('\n'), 'utf8');
  console.log(`\n报告已写入：${fileURLToPath(reportPath)}`);
}

void main();
