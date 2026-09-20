/**
 * 文档里的测试条数校验（技术方案 V0.4 增补 六、项目评审标准第五节的落地）。
 *
 * 作品集主文档与项目评审标准都写死了「单测 N + 文档一致性 N + 端到端 N」，
 * 每加一批用例就会集体过期，而且没有任何测试会拦住这种过期——已经发生过两次。
 * 这里用**列举模式**（不真正执行测试）重算一遍再比对，不一致就让 CI 失败。
 *
 * 运行：pnpm test:counts
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

function run(command: string): string {
  return execSync(command, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}

/** vitest：每行一条「文件 > 用例」 */
function countUnit(): number {
  const output = run('pnpm exec vitest list');
  return output.split('\n').filter((line) => /\.test\.ts > /.test(line)).length;
}

/** Playwright：结尾是「Total: N tests in M files」 */
function countE2e(): number {
  const output = run('pnpm exec playwright test --list');
  const matched = output.match(/Total:\s+(\d+)\s+tests?/);
  if (!matched?.[1]) throw new Error('未能从 playwright --list 的输出里解析出用例数');
  return Number(matched[1]);
}

/** node:test：TAP 汇总里的「# tests N」，顺带保证文档测试本身是绿的 */
function countDocs(): number {
  const output = run('node --test --test-reporter=tap "tests/*.test.js"');
  const failed = output.match(/^# fail (\d+)$/m);
  if (failed?.[1] && Number(failed[1]) > 0) {
    throw new Error(`文档一致性测试有 ${failed[1]} 条失败，先修测试再看条数`);
  }
  const matched = output.match(/^# tests (\d+)$/m);
  if (!matched?.[1]) throw new Error('未能从 node:test 的 TAP 输出里解析出用例数');
  return Number(matched[1]);
}

interface Counts {
  unit: number;
  docs: number;
  e2e: number;
  /** 文档里写的合计数；没有写合计的文档为 undefined */
  total?: number;
}

/** 文档里写死的数字：两处引用必须一起更新，因此在这里集中比对 */
const targets: { file: string; pattern: RegExp; pick: (m: RegExpMatchArray) => Counts }[] = [
  {
    file: 'docs/作品集主文档_V1.3.md',
    pattern: /自动化测试 \| (\d+) 项（单测与集成 (\d+) \+ 文档一致性 (\d+) \+ 端到端 (\d+)）/,
    pick: (m) => ({
      total: Number(m[1]),
      unit: Number(m[2]),
      docs: Number(m[3]),
      e2e: Number(m[4])
    })
  },
  {
    file: 'docs/项目评审标准_V0.2.md',
    pattern: /单测 (\d+)、文档一致性 (\d+)、端到端 (\d+)/,
    pick: (m) => ({ unit: Number(m[1]), docs: Number(m[2]), e2e: Number(m[3]) })
  },
  {
    file: 'docs/评审记录_V1.0.md',
    pattern: /单测 (\d+)、文档一致性 (\d+)、端到端 (\d+)/,
    pick: (m) => ({ unit: Number(m[1]), docs: Number(m[2]), e2e: Number(m[3]) })
  }
];

const actual: Counts = { unit: countUnit(), docs: countDocs(), e2e: countE2e() };
const problems: string[] = [];

targets.forEach((target) => {
  const text = readFileSync(new URL(target.file, new URL('..', import.meta.url)), 'utf8');
  const matched = text.match(target.pattern);

  if (!matched) {
    problems.push(`${target.file}：找不到写测试条数的那一行（表述被改动了？）`);
    return;
  }

  const documented = target.pick(matched);
  (
    [
      ['单测', documented.unit, actual.unit],
      ['文档一致性', documented.docs, actual.docs],
      ['端到端', documented.e2e, actual.e2e]
    ] as const
  ).forEach(([label, doc, real]) => {
    if (doc !== real) {
      problems.push(`${target.file}：${label}写的是 ${doc}，实际 ${real}`);
    }
  });

  // 合计也要对：分项对了但合计没跟着改，同样是过期数字
  const sum = actual.unit + actual.docs + actual.e2e;
  if (documented.total !== undefined && documented.total !== sum) {
    problems.push(`${target.file}：合计数写的是 ${documented.total}，实际 ${sum}`);
  }
});

if (problems.length) {
  console.error('文档里的测试条数与实际不符：');
  problems.forEach((line) => console.error(`  - ${line}`));
  console.error(`\n实际：单测 ${actual.unit} + 文档一致性 ${actual.docs} + 端到端 ${actual.e2e} = ${actual.unit + actual.docs + actual.e2e}`);
  console.error('请同步作品集主文档与项目评审标准里的数字。');
  process.exit(1);
}

console.log(
  `测试条数与文档一致：单测 ${actual.unit} + 文档一致性 ${actual.docs} + 端到端 ${actual.e2e} = ${actual.unit + actual.docs + actual.e2e}`
);
