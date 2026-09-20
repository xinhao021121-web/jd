/**
 * 外部盲测工具（评审标准六：3–5 人外部盲测，不告知作者身份，1–5 分评三项）。
 *   pnpm blind-test:kit     生成发给测试者的评分表与邀请话术
 *   pnpm blind-test:report  汇总回收的评分并输出报告
 *
 * 评分表是自包含的 HTML，测试者不需要注册任何服务；导出结果贴回即可。
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  BLIND_TEST_MAX_TESTERS,
  BLIND_TEST_MIN_TESTERS,
  BLIND_TEST_THRESHOLD,
  parseResultJson,
  summarize
} from './blind-test-checks';

interface KitSample {
  id: string;
  note: string;
  resume: string;
  jd: string;
}

const reportsDir = new URL('../reports/blind-test/', import.meta.url);
const resultsDir = new URL('results/', reportsDir);

function argValue(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function buildKit(): void {
  const defaultSamples = fileURLToPath(
    new URL('../tests/samples/quality-samples.json', import.meta.url)
  );
  const samplesPath = argValue('samples', defaultSamples);
  // 默认 8 组：对齐差距诊断 G5 的「≥3 名评分者 × ≥8 组样本」口径
  const count = Number(argValue('count', '8'));
  const url = argValue(
    'url',
    process.env.BLIND_TEST_URL ?? 'https://zhipin.xinhao02.ccwu.cc'
  );

  const all = JSON.parse(readFileSync(samplesPath, 'utf8')) as KitSample[];
  const samples = all.slice(0, count).map((sample) => ({
    id: sample.id,
    note: sample.note,
    resume: sample.resume,
    jd: sample.jd
  }));

  const template = readFileSync(new URL('./blind-test-kit.html', import.meta.url), 'utf8');
  // 内联进 <script> 的 JSON 不能出现裸的 "<"，否则样本里一旦有 </script> 就会截断脚本
  const data = JSON.stringify({ url, samples }).replace(/</g, '\\u003c');
  const html = template
    .replaceAll('__URL__', url)
    .replace('__DATA__', data);

  mkdirSync(reportsDir, { recursive: true });
  mkdirSync(resultsDir, { recursive: true });

  const kitPath = new URL('评分表.html', reportsDir);
  writeFileSync(kitPath, html, 'utf8');

  const notePath = new URL('发给测试者的话.md', reportsDir);
  writeFileSync(
    notePath,
    [
      '# 发给测试者的话（可直接复制）',
      '',
      `> 我把一个求职小工具做出来了，想请你帮我打个分，大概 ${samples.length * 2} 分钟。`,
      '>',
      `> 需要你做的事：打开附件里的 \`评分表.html\`，按上面的步骤操作（里面有 ${samples.length} 组现成的简历和岗位 JD，复制粘贴就行），`,
      '> 然后在评分表里给结果打 1–5 分，点「生成结果」，把导出的那段文字发回给我。',
      '>',
      '> 随便挑毛病，不用客气——我需要的是真实评价，不是鼓励。',
      '>',
      `> 体验地址：${url}`,
      '',
      '## 回收方式',
      '',
      '把测试者发回的那段 JSON 存成 `reports/blind-test/results/<代号>.json`，然后运行：',
      '',
      '```bash',
      'pnpm blind-test:report',
      '```',
      '',
      '## 三条纪律（评审标准六）',
      '',
      '1. 不告知作者身份，测试者只评输出本身；',
      `2. 至少 ${BLIND_TEST_MIN_TESTERS} 人，最多 ${BLIND_TEST_MAX_TESTERS} 人；`,
      `3. 均分 ≥ ${BLIND_TEST_THRESHOLD} 才算通过，人数不足或均分不足都判不通过。`
    ].join('\n'),
    'utf8'
  );

  console.log(`评分表已生成：${fileURLToPath(kitPath)}`);
  console.log(`邀请话术已生成：${fileURLToPath(notePath)}`);
  console.log(`样本数：${samples.length}，体验地址：${url}`);
  console.log(
    `把它发给 ${BLIND_TEST_MIN_TESTERS}–${BLIND_TEST_MAX_TESTERS} 位测试者，回收的 JSON 存进 reports/blind-test/results/ 后再跑 blind-test:report。`
  );
}

function buildReport(): void {
  mkdirSync(resultsDir, { recursive: true });
  const files = readdirSync(resultsDir).filter((name) => name.endsWith('.json'));

  const results = files.flatMap((name) => {
    const content = readFileSync(new URL(name, resultsDir), 'utf8');
    const parsed = parseResultJson(content, name.replace(/\.json$/, ''));
    return parsed ? [parsed] : [];
  });

  const summary = summarize(results);
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
  const reportPath = new URL(`../盲测报告_${stamp}.md`, reportsDir);

  const lines: string[] = [
    '# 外部盲测结论',
    '',
    `- 运行时间：${new Date().toLocaleString('zh-CN')}`,
    `- 回收结果文件：${files.length} 个，有效 ${results.length} 份`,
    `- 测试者：${summary.testers} 人，评分数：${summary.ratings} 条`,
    `- 判定门槛：${BLIND_TEST_MIN_TESTERS}–${BLIND_TEST_MAX_TESTERS} 人，均分 ≥ ${BLIND_TEST_THRESHOLD}`,
    '',
    '## 结论',
    '',
    `**${summary.passed ? '通过' : '未通过'}**：${summary.reason}`,
    '',
    '## 维度均分（1–5）',
    '',
    '| 维度 | 均分 |',
    '|------|------|',
    `| 像不像真人写的 | ${summary.dimensions.humanLike} |`,
    `| 敢不敢直接发送 | ${summary.dimensions.sendable} |`,
    `| 有没有夸大或编造 | ${summary.dimensions.truthful} |`,
    `| **总均分** | **${summary.overall}** |`
  ];

  lines.push('', '## 评分者一致率', '');
  if (summary.agreement.cells) {
    lines.push(
      `- 统计单元格：${summary.agreement.cells} 个（样本 × 维度，且该样本至少有 2 位评分者）`,
      `- 分数极差 ≤1 的比例：${(summary.agreement.withinOneRate * 100).toFixed(0)}%`,
      `- 各维度平均极差：像真人 ${summary.agreement.avgRange.humanLike} / 敢发送 ${summary.agreement.avgRange.sendable} / 无夸大 ${summary.agreement.avgRange.truthful}`,
      '',
      '> 极差越小说明评分者越一致。一致率低意味着该维度的结论依赖具体评分者，不能当成稳定信号——',
      '> 这时应当先统一评分口径（例如补锚点示例）再补人，而不是直接采信均分。'
    );
  } else {
    lines.push(
      '每位样本的评分者都不足 2 人，无法计算一致率：至少要有两位测试者评过同一组样本，主观结论才谈得上可靠。'
    );
  }

  if (results.length) {
    lines.push(
      '',
      '## 明细',
      '',
      '| 测试者 | 样本 | 像真人 | 敢发送 | 无夸大 |',
      '|--------|------|--------|--------|--------|'
    );
    results.forEach((result) => {
      result.ratings.forEach((rating) => {
        lines.push(
          `| ${result.tester} | ${rating.sample} | ${rating.humanLike} | ${rating.sendable} | ${rating.truthful} |`
        );
      });
    });
  }

  lines.push(
    '',
    '> 说明：测试者未被告知作者身份，评分来自实际使用体验；本报告由 `pnpm blind-test:report` 自动汇总，未做人工调整。'
  );

  writeFileSync(reportPath, lines.join('\n'), 'utf8');
  console.log(`报告已写入：${fileURLToPath(reportPath)}`);
  console.log(`${summary.passed ? '通过' : '未通过'}：${summary.reason}`);
  process.exit(summary.passed ? 0 : 1);
}

function main(): void {
  const mode = process.argv[2];
  if (mode === 'kit') return buildKit();
  if (mode === 'report') return buildReport();
  console.error('用法：tsx scripts/blind-test.ts kit|report');
  process.exit(2);
}

void main();
