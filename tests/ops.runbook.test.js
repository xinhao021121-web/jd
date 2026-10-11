/**
 * 运维手册与评审记录的一致性检查：这两份文件是发布留档，最容易「写的时候对、改的时候忘」。
 * 运行方式：node --test tests/ops.runbook.test.js
 */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const runbook = read('docs/运维与回滚_V1.0.md');
const record = read('docs/评审记录_V1.0.md');
const wrangler = read('apps/api/wrangler.toml');
const pkg = JSON.parse(read('package.json'));

test('运维手册的配额数字与 wrangler.toml 同源', () => {
  const alert = wrangler.match(/DAILY_CALL_ALERT = "(\d+)"/)?.[1];
  const cap = wrangler.match(/DAILY_CALL_CAP = "(\d+)"/)?.[1];

  assert.ok(alert && cap, 'wrangler.toml 应有告警阈值与硬上限');
  assert.ok(runbook.includes(alert), `运维手册应写出告警阈值 ${alert}`);
  assert.ok(runbook.includes(cap), `运维手册应写出硬上限 ${cap}`);
  assert.ok(runbook.includes('每分钟 10 次 / 每日 100 次'), '运维手册应写出按 IP 的限流口径');
});

test('运维手册给出可执行的回滚步骤与演练记录', () => {
  assert.ok(runbook.includes('wrangler@4.134.0 rollback'), '应写出回滚命令');
  assert.ok(runbook.includes('deployments list'), '应写出查看版本的命令');
  assert.ok(runbook.includes('index-YsoFx2Ce.js'), '演练记录应写出回滚前后的静态产物 hash');
  assert.ok(runbook.includes('index-BtcSOYvN.js'), '演练记录应写出回滚后的静态产物 hash');
  assert.ok(runbook.includes('回滚可用'), '应给出演练结论');

  // 演练记录会随之后的发布过期，因此必须另有一段「现行状态」作为回滚验收的基线
  const current = runbook.split('### 现行状态')[1] ?? '';
  assert.ok(current, '应记录现行状态，否则回滚验收会拿旧 hash 当基线');
  assert.ok(/\/assets\/index-[\w-]+\.js/.test(current), '现行状态应写出首页引用的静态产物 hash');
});

test('监控一节写明日志字段与不落正文的边界', () => {
  ['ipHash', 'usage_alert', 'rate_limited', '不含简历与 JD 正文'].forEach((keyword) => {
    assert.ok(runbook.includes(keyword), '监控一节应包含：' + keyword);
  });
  assert.ok(runbook.includes('count'), '日志字段表应含有当日累计调用数 count');
  assert.ok(runbook.includes('当日累计调用数'), '应写明 count 的含义，避免被当成耗时读');
  assert.ok(runbook.includes('tail.developers.workers.dev'), '应记录实时日志在本机网络不可用这一实测结论');
});

test('运维手册里的复现命令都真实存在', () => {
  ['loadtest', 'coverage', 'smoke:prod'].forEach((script) => {
    assert.ok(pkg.scripts[script], `package.json 应有脚本：${script}`);
    assert.ok(runbook.includes(`pnpm ${script}`), `运维手册应给出：pnpm ${script}`);
  });
  assert.ok(runbook.includes('pnpm deploy:cf'), '应给出部署命令');
});

test('评审记录具备发布留档的必备段落', () => {
  assert.ok(/版本号：V1\.\d/.test(record), '应标注版本号');
  ['一票否决', '结论', '行动项', '已知问题'].forEach((keyword) => {
    assert.ok(record.includes(keyword), '评审记录应包含：' + keyword);
  });
  assert.ok(record.includes('直聘打招呼助手_PRD_V0.2.md'), '应写明对应的 PRD 版本');
  assert.ok(record.includes('docs/技术方案_V0.1.md'), '应写明对应的技术方案版本');
});

test('评审记录引用的小时级证据文件与文档都真实存在', () => {
  ['docs/运维与回滚_V1.0.md', 'docs/项目评审标准_V0.2.md', 'docs/质量回归_V0.2.md', 'docs/作品集主文档_V1.3.md'].forEach(
    (file) => {
      assert.ok(record.includes(file), `评审记录应引用：${file}`);
      assert.ok(fs.existsSync(path.join(ROOT, file)), `被引用的文件应存在：${file}`);
    }
  );
  assert.ok(pkg.scripts['test:counts'], '测试条数校验脚本应存在');
});

test('默认线上地址统一为境内可达域名，不再使用被阻断的旧域名', () => {
  const legacy = 'zhipin.xinhao02.ccwu.cc';
  const current = 'zhipin.rainylli02xin11hao21.dpdns.org';
  const files = [
    'docs/运维与回滚_V1.0.md',
    'docs/评审记录_V1.0.md',
    'docs/作品集主文档_V1.3.md',
    'docs/作品集差距诊断_V2.0.md',
    'scripts/prod-smoke.ts',
    'scripts/blind-test.ts',
    'scripts/record-demo.ts'
  ];

  files.forEach((file) => {
    const content = read(file);
    assert.ok(!content.includes(legacy), file + ' 不应再出现被阻断的旧域名');
    assert.ok(content.includes(current), file + ' 应写出现行可用的线上地址');
  });

  // wrangler.toml 里保留旧域名的路由绑定是配置事实，不属于「默认地址」
  assert.ok(wrangler.includes(legacy), 'wrangler.toml 的域名路由不受这条约束');
});