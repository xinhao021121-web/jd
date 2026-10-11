/**
 * 作品集页面检查（差距诊断 G9）：它是给前台读者看的那一页，
 * 因此钉住三件事——六个部分齐全、引用的素材真实存在、页面上的数字与主文档同源。
 * 数字同源这条最重要：页面上写死的数字最容易在后续迭代里过期，而它恰好是说服力的来源。
 * 运行方式：node --test tests/portfolio.page.test.js
 */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert');

const ROOT = path.join(__dirname, '..');
const DOCS_DIR = path.join(ROOT, 'docs');
const page = fs.readFileSync(path.join(ROOT, '作品集_CaseStudy_V1.0.html'), 'utf8');
const master = fs.readFileSync(path.join(DOCS_DIR, '作品集主文档_V1.3.md'), 'utf8');

test('七个部分齐全，按问题 → 判断 → 取舍 → 验证 → 结果 → 定位 → 复盘组织', () => {
  [
    '一、问题与目标用户',
    '二、四条关键判断',
    '三、被放弃的方案',
    '四、评测体系',
    '五、结果',
    '六、定位与边界',
    '七、复盘'
  ].forEach((heading) => {
    assert.ok(page.includes(heading), '页面应保留小节：' + heading);
  });
});

test('主动回应「加重招聘方负担」的质疑，而不是等面试官提出来', () => {
  assert.ok(page.includes('这个质疑有一半成立'), '应承认质疑的合理部分');
  assert.ok(page.includes('不自动发送'), '应给出硬约束');
  assert.ok(page.includes('技能匹配型写一条仍要 1–2 分钟用于审核') || page.includes('这不是零成本群发'), '应给出使用成本层面的观察');
  assert.ok(page.includes('没有验证的部分'), '应标注哪部分还没有数据');
});

test('证据边界做成独立区块，紧跟数字条之后', () => {
  assert.ok(page.includes('证据边界'), '应有证据边界区块');
  assert.ok(page.includes('不计入用户证据'), '应写明自访谈不计入用户证据');
  assert.ok(page.includes('仍然没有第三方证据'), '应明说用户需求这一层还没有第三方证据');
  assert.ok(page.includes('不是「这类人都这么用」'), '应说明自身场景不能外推到其他人');
  assert.ok(page.includes('补齐计划'), '应写明补齐计划');

  // 位置：数字条之后、正文第一节之前
  const facts = page.indexOf('class="facts"');
  const evidence = page.indexOf('class="evidence"');
  const firstSection = page.indexOf('一、问题与目标用户');
  assert.ok(facts > 0 && evidence > facts, '证据边界应排在数字条之后');
  assert.ok(firstSection > evidence, '证据边界应排在正文第一节之前');
});

test('原依据强度标注仍然保留在第一节', () => {
  assert.ok(page.includes('依据强度'), '第一节应保留依据强度标注');
  assert.ok(page.includes('第三方用户证据仍为零'), '应写明第三方用户证据为零');
});

test('「我的角色」显示认领进度：13 行认领完毕 + 四件事已作答 + 未参与部分照实写明', () => {
  assert.ok(page.includes('八、我的角色'), '应有我的角色一节');
  assert.ok(page.includes('13 行也已逐条认领'), '应写明两张表的 13 行已认领');
  assert.ok(page.includes('8 行本人决定'), '应写明本人决定的行数');
  assert.ok(page.includes('5 行我认可这个建议'), '应写明接受建议的行数，而不是全部写成本人决定');
  assert.ok(page.includes('补上了此前空着的四件事'), '应写明四件事已作答，而不是还挂着待补');
  assert.ok(!page.includes('仍待补全的四件事'), '四件事已作答，不应再写「仍待补全」');
  assert.ok(page.includes('照实写成协作产出'), '未参与的部分仍要照实声明，不假装完整');
  assert.ok(page.includes('每日额度不是本人决定的'), '未参与的那一项要写清楚');
});

test('页面交代了 AI 出错时用户看到什么，且写清没做的部分', () => {
  assert.ok(page.includes('出问题的时候，用户看到什么'), '页面应有 AI 体验的边界');
  assert.ok(page.includes('没做的部分与原因'), '每条边界都要写清没做的原因');
  assert.ok(page.includes('限制次数'), '成本取舍要写明控成本靠限次而不是降质');
  assert.ok(page.includes('生成超时'), '失败路径要写清用户实际看到什么');
});

test('引用的图片与视频都真实存在', () => {
  const assets = [...page.matchAll(/src="([^"]+)"/g)]
    .map((match) => match[1])
    .filter((value) => !value.startsWith('http'));

  assert.ok(assets.length >= 3, '应引用录屏与两张界面图，实际 ' + assets.length + ' 条');
  assets.forEach((asset) => {
    assert.ok(fs.existsSync(path.join(ROOT, asset)), '素材应存在：' + asset);
  });

  assert.ok(page.includes('demo-flow.webm'), '应嵌入主流程录屏');

  // 录屏时长必须与实测值一致，且三处口径不能互相矛盾（N7）
  const secondsInPage = [...page.matchAll(/(\d+) 秒(?:主流程|录屏)/g)].map((m) => m[1]);
  assert.ok(secondsInPage.length >= 1, '页面应写明录屏时长');
  assert.ok(
    new Set(secondsInPage).size === 1,
    '同一页里的录屏时长必须一致，实际出现：' + [...new Set(secondsInPage)].join(' / ')
  );
  assert.equal(secondsInPage[0], '67', '实测时长为 67.24 秒，页面应写 67 秒');

  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const secondsInReadme = [...readme.matchAll(/(\d+) 秒(?:主流程|录屏)/g)].map((m) => m[1]);
  assert.ok(secondsInReadme.length >= 1, 'README 应写明录屏时长');
  assert.equal(
    secondsInReadme[0],
    secondsInPage[0],
    'README 与作品集页的录屏时长口径必须一致'
  );
});

test('页面上的测试条数与覆盖率与主文档同源', () => {
  const total = master.match(/(\d+) 项（单测与集成/);
  const coverage = master.match(/整体 ([\d.]+)%/);

  assert.ok(total, '主文档应写出测试总条数');
  assert.ok(coverage, '主文档应写出整体覆盖率');
  assert.ok(page.includes(`${total[1]} 项`), `页面应写出与主文档一致的测试条数 ${total[1]} 项`);
  assert.ok(page.includes(`${coverage[1]}%`), `页面应写出与主文档一致的覆盖率 ${coverage[1]}%`);
});

test('如实标注外部盲测与主观质量是决定不做，而不是写成「待回收」', () => {
  assert.ok(page.includes('未做，且不计划做'), '应写清是决定不做，不是待做');
  assert.ok(!page.includes('待回收'), '不应留下「还在等」的印象');
  assert.ok(page.includes('合规率'), '应使用合规率而不是合格率');
  assert.ok(!page.includes('合格率'), '页面不应再出现「合格率」');
});

test('对外给出的在线地址是境内可达域名，不是已阻断的 ccwu.cc', () => {
  assert.ok(!page.includes('ccwu.cc'), 'ccwu.cc 在境内被整体阻断，不应作为对外给出的在线地址');
  assert.ok(
    page.includes('zhipin.rainylli02xin11hao21.dpdns.org'),
    '应给出境内实测可达的线上地址'
  );
});