/**
 * 纯规则基线 vs 模型（差距诊断 G11）。
 *
 * 同一批样本、同一套本地自检，一边跑「关键词匹配 + 模板」，一边跑真实模型，
 * 比较四件事：合规违规数、跨样本话术相似度、重复句比例、改写理由的重复度。
 *
 * 运行：
 *   pnpm baseline:compare                      # 两版都跑（会真实调用模型）
 *   pnpm baseline:compare -- --skip-model      # 只跑模板版，零成本验证脚本
 *   pnpm baseline:compare -- --samples=4
 *
 * 报告写在 reports/，该目录默认不入库。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createLlmClient } from '@zhipin/llm';
import { checkGreetings, checkSuggestions } from '@zhipin/core';
import type { OutputEvent } from '@zhipin/shared';
import { loadEnvFile } from '../apps/api/src/env';
import {
  crossSampleSimilarity,
  reasonSimilarity,
  repeatedSentenceRate,
  runTemplate,
  type BaselineRun
} from './baseline-checks';

interface Sample {
  id: string;
  note: string;
  resume: string;
  jd: string;
}

function argValue(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

async function runModel(
  model: string,
  apiKey: string,
  baseUrl: string,
  sample: Sample
): Promise<BaselineRun & { elapsedMs: number; promptTokens: number; completionTokens: number }> {
  const client = createLlmClient({ apiKey, baseUrl, model });

  const greetingEvents: OutputEvent[] = [];
  const greeting = await client.runTask(
    'greeting',
    { resume: sample.resume, jd: sample.jd },
    { onEvent: (event) => void greetingEvents.push(event) }
  );

  const suggestionEvents: OutputEvent[] = [];
  const suggestions = await client.runTask(
    'suggestions',
    { resume: sample.resume, jd: sample.jd },
    { onEvent: (event) => void suggestionEvents.push(event) }
  );

  const rawSuggestions = suggestionEvents
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

  return {
    sample: sample.id,
    greetingTexts: greetingEvents
      .filter((event): event is Extract<OutputEvent, { kind: 'greeting' }> =>
        event.type === 'item' && event.kind === 'greeting'
      )
      .map((event) => event.text),
    suggestionReasons: rawSuggestions.map((item) => item.reason),
    violations: [
      ...checkGreetings(sample.resume, greetingEvents),
      ...checkSuggestions(sample.resume, rawSuggestions, sample.jd)
    ],
    elapsedMs: greeting.elapsedMs + suggestions.elapsedMs,
    promptTokens: greeting.tokenUsage.promptTokens + suggestions.tokenUsage.promptTokens,
    completionTokens: greeting.tokenUsage.completionTokens + suggestions.tokenUsage.completionTokens
  };
}

async function main(): Promise<void> {
  loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));

  const samplesPath = new URL('../tests/samples/quality-samples.json', import.meta.url);
  const all = JSON.parse(readFileSync(samplesPath, 'utf8')) as Sample[];
  const samples = all.slice(0, Number(argValue('samples', '8')));
  const skipModel = process.argv.includes('--skip-model');
  const model = argValue('models', process.env.DEEPSEEK_MODEL ?? 'deepseek-chat');
  const baseUrl = argValue('base-url', process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1');
  const apiKey = process.env.DEEPSEEK_API_KEY ?? '';

  console.log(`样本 ${samples.length} 组；${skipModel ? '只跑模板版' : `模板版 vs ${model}`}`);

  const templateRuns = samples.map((sample) => runTemplate(sample.resume, sample.jd, sample.id));
  console.log(`模板版完成：违规 ${templateRuns.reduce((sum, run) => sum + run.violations.length, 0)} 处`);

  let modelRuns: Awaited<ReturnType<typeof runModel>>[] = [];
  if (!skipModel) {
    if (!apiKey) {
      console.error('缺少 DEEPSEEK_API_KEY：要么配好密钥，要么加 --skip-model 只跑模板版');
      process.exit(2);
    }
    for (const sample of samples) {
      const run = await runModel(model, apiKey, baseUrl, sample);
      modelRuns.push(run);
      console.log(`  模型版 ${sample.id}：违规 ${run.violations.length} 处，${run.elapsedMs} ms`);
    }
  }

  const metrics = (runs: BaselineRun[]) => ({
    violations: runs.reduce((sum, run) => sum + run.violations.length, 0),
    similarity: crossSampleSimilarity(runs),
    repeatedSentences: repeatedSentenceRate(runs),
    reasonSimilarity: reasonSimilarity(runs)
  });

  const templateMetrics = metrics(templateRuns);
  const modelMetrics = modelRuns.length ? metrics(modelRuns) : null;
  const modelElapsed = modelRuns.length
    ? Math.round(modelRuns.reduce((sum, run) => sum + run.elapsedMs, 0) / modelRuns.length)
    : 0;
  const modelTokens = modelRuns.length
    ? {
        prompt: Math.round(
          modelRuns.reduce((sum, run) => sum + run.promptTokens, 0) / modelRuns.length
        ),
        completion: Math.round(
          modelRuns.reduce((sum, run) => sum + run.completionTokens, 0) / modelRuns.length
        )
      }
    : null;

  const reportDir = new URL('../reports/', import.meta.url);
  mkdirSync(reportDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
  const reportPath = new URL(`规则基线与模型对比_${stamp}.md`, reportDir);

  const lines: string[] = [
    '# 纯规则基线 vs 模型',
    '',
    `- 运行时间：${new Date().toLocaleString('zh-CN')}`,
    `- 样本：${samples.length} 组（与质量回归、模型选型同一批）`,
    `- 模型：${skipModel ? '未跑（--skip-model）' : model}`,
    '- 判定：两侧都用产品自己的本地自检（`packages/core`），规则完全一致',
    '- 规则版口径：关键词匹配 + 模板，只填简历原文里存在的技能与数字，不编造',
    '',
    '## 对比',
    '',
    '| 指标 | 规则版 | 模型版 | 含义 |',
    '|------|-------|-------|------|',
    `| 合规违规数 | ${templateMetrics.violations} | ${modelMetrics ? modelMetrics.violations : '—'} | 数字溯源 / 套话 / 长度 / 锁定区块，同一套判定 |`,
    `| 跨样本话术相似度 | ${templateMetrics.similarity} | ${modelMetrics ? modelMetrics.similarity : '—'} | 换一个岗位，产出有多像（3-gram Jaccard） |`,
    `| 重复句比例 | ${templateMetrics.repeatedSentences} | ${modelMetrics ? modelMetrics.repeatedSentences : '—'} | 有多少句子是原样复用的 |`,
    `| 改写理由相似度 | ${templateMetrics.reasonSimilarity} | ${modelMetrics ? modelMetrics.reasonSimilarity : '—'} | 1 表示所有理由都是同一句 |`,
    `| 每样本耗时 | 约 0 ms | ${modelMetrics ? `${modelElapsed} ms` : '—'} | 规则版无网络与推理开销 |`,
    `| 每样本 token | 0 | ${modelTokens ? `${modelTokens.prompt} 输入 + ${modelTokens.completion} 输出` : '—'} | 规则版的成本为零 |`
  ];

  lines.push(
    '',
    '## 每条明细（规则版）',
    '',
    '| 样本 | 话术条数 | 建议条数 | 违规 |',
    '|------|---------|---------|------|',
    ...templateRuns.map(
      (run) =>
        `| ${run.sample} | ${run.greetingTexts.length} | ${run.suggestionReasons.length} | ${run.violations.length} |`
    )
  );

  const templateViolations = templateRuns.flatMap((run) =>
    run.violations.map((violation) => `${run.sample} · ${violation.rule}：${violation.detail}`)
  );
  if (templateViolations.length) {
    lines.push(
      '',
      '## 规则版的违规明细',
      '',
      ...templateViolations.map((item) => `- ${item}`)
    );
  }

  if (modelRuns.length) {
    lines.push(
      '',
      '## 每条明细（模型版）',
      '',
      '| 样本 | 话术条数 | 建议条数 | 违规 |',
      '|------|---------|---------|------|',
      ...modelRuns.map(
        (run) =>
          `| ${run.sample} | ${run.greetingTexts.length} | ${run.suggestionReasons.length} | ${run.violations.length} |`
      )
    );

    const modelViolations = modelRuns.flatMap((run) =>
      run.violations.map((violation) => `${run.sample} · ${violation.rule}：${violation.detail}`)
    );
    if (modelViolations.length) {
      lines.push('', '## 模型版的违规明细', '', ...modelViolations.map((item) => `- ${item}`));
    }
  }

  lines.push(
    '',
    '## 一个具体例子（同一样本、同一任务）',
    '',
    '规则版话术：',
    '',
    ...templateRuns[0]!.greetingTexts.map((text) => `> ${text}`),
    '',
    modelRuns.length ? '模型版话术：' : '模型版：本次未跑（--skip-model）',
    ...(modelRuns[0]?.greetingTexts ?? []).map((text) => `> ${text}`),
    '',
    '> 规则版的合规性不靠「模型自觉」也能达标，它输掉对比的地方在别处——',
    '> 看重复句比例与改写理由相似度这两行，它们量的是「换一个岗位，产出变不变」。'
  );

  writeFileSync(reportPath, lines.join('\n'), 'utf8');
  console.log(`\n报告已写入：${fileURLToPath(reportPath)}`);
}

void main();
