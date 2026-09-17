/**
 * 质量回归脚本（技术方案 八）：用 8~10 组真实简历 + JD 跑真实模型，断言
 * 数字与技能可溯源、无套话黑名单词、话术长度与条数达标、改写建议不越界，
 * 并把逐条结论写进 reports/ 留档。
 *
 * 运行（需要可用的模型端点）：
 *   $env:DEEPSEEK_API_KEY="sk-..."; pnpm quality:samples
 * 也可以指向本地 mock 验证脚本本身：
 *   $env:DEEPSEEK_BASE_URL="http://127.0.0.1:8788/v1"; $env:DEEPSEEK_API_KEY="sk-local"; pnpm quality:samples
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createLlmClient } from '@zhipin/llm';
import { planSuggestions } from '@zhipin/core';
import { parseResume } from '@zhipin/core';
import type { OutputEvent } from '@zhipin/shared';
import { checkGreetings, checkSuggestions, type Violation } from './quality-checks';

interface Sample {
  id: string;
  note: string;
  resume: string;
  jd: string;
}

interface SampleResult {
  id: string;
  note: string;
  greetingViolations: Violation[];
  suggestionViolations: Violation[];
  greetingCount: number;
  suggestionCount: number;
  elapsedMs: number;
}

const samplesPath = new URL('../tests/samples/quality-samples.json', import.meta.url);
const samples = JSON.parse(readFileSync(samplesPath, 'utf8')) as Sample[];

const apiKey = process.env.DEEPSEEK_API_KEY ?? '';
if (!apiKey) {
  console.error('缺少 DEEPSEEK_API_KEY：质量回归需要可用的模型端点');
  process.exit(2);
}

const client = createLlmClient({
  apiKey,
  baseUrl: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1',
  model: process.env.DEEPSEEK_MODEL ?? 'deepseek-chat'
});

async function runSample(sample: Sample): Promise<SampleResult> {
  const greetingEvents: OutputEvent[] = [];
  const greetingStarted = Date.now();
  await client.runTask('greeting', { resume: sample.resume, jd: sample.jd }, {
    onEvent: (event) => void greetingEvents.push(event)
  });
  const elapsedMs = Date.now() - greetingStarted;

  const suggestionEvents: OutputEvent[] = [];
  await client.runTask('suggestions', { resume: sample.resume, jd: sample.jd }, {
    onEvent: (event) => void suggestionEvents.push(event)
  });

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

  const blocks = parseResume(sample.resume);

  return {
    id: sample.id,
    note: sample.note,
    greetingViolations: checkGreetings(sample.resume, greetingEvents),
    suggestionViolations: checkSuggestions(sample.resume, rawSuggestions, sample.jd),
    greetingCount: greetingEvents.filter(
      (event) => event.type === 'item' && event.kind === 'greeting'
    ).length,
    suggestionCount: planSuggestions(blocks, rawSuggestions).suggestions.length,
    elapsedMs
  };
}

async function main(): Promise<void> {
  const results: SampleResult[] = [];
  for (const sample of samples) {
    process.stdout.write(`运行样本 ${sample.id}（${sample.note}）… `);
    const result = await runSample(sample);
    results.push(result);
    const violations = result.greetingViolations.length + result.suggestionViolations.length;
    console.log(violations ? `发现 ${violations} 处问题` : '通过');
  }

  const totalViolations = results.reduce(
    (sum, result) => sum + result.greetingViolations.length + result.suggestionViolations.length,
    0
  );
  const passed = results.filter(
    (result) => !result.greetingViolations.length && !result.suggestionViolations.length
  ).length;
  const avgElapsed = Math.round(results.reduce((sum, r) => sum + r.elapsedMs, 0) / results.length);

  const reportDir = new URL('../reports/', import.meta.url);
  mkdirSync(reportDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
  const reportPath = new URL(`质量回归_${stamp}.md`, reportDir);

  const lines: string[] = [
    '# 质量回归结论',
    '',
    `- 运行时间：${new Date().toLocaleString('zh-CN')}`,
    `- 模型端点：${client.endpoint}`,
    `- 样本数：${results.length}，通过 ${passed}，违规项合计 ${totalViolations}`,
    `- 平均话术生成耗时：${avgElapsed} ms（PRD 4.3 要求完整结果 ≤30 秒）`,
    '',
    '| 样本 | 场景 | 话术条数 | 采纳建议数 | 话术耗时 | 结论 |',
    '|------|------|---------|-----------|---------|------|'
  ];

  results.forEach((result) => {
    const ok = !result.greetingViolations.length && !result.suggestionViolations.length;
    lines.push(
      `| ${result.id} | ${result.note} | ${result.greetingCount} | ${result.suggestionCount} | ${result.elapsedMs} ms | ${
        ok ? '通过' : '需人工复核'
      } |`
    );
  });

  const violations = results.flatMap((result) => [
    ...result.greetingViolations.map((item) => `${result.id} · 话术 · ${item.rule}：${item.detail}`),
    ...result.suggestionViolations.map((item) => `${result.id} · 建议 · ${item.rule}：${item.detail}`)
  ]);

  if (violations.length) {
    lines.push('', '## 违规明细', '', ...violations.map((item) => `- ${item}`));
  } else {
    lines.push('', '全部样本通过：数字与技能均可溯源，无套话黑名单词，建议未越界。');
  }

  writeFileSync(reportPath, lines.join('\n'), 'utf8');
  console.log(`\n报告已写入：${decodeURIComponent(reportPath.pathname)}`);
  process.exit(violations.length ? 1 : 0);
}

void main();
