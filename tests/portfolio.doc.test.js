/**
 * 作品集主文档检查：它是「三分钟读完」的整合层入口，
 * 因此只钉住两类容易失真的东西——文件索引必须指向真实文件、新增能力必须写到。
 * 运行方式：node --test tests/portfolio.doc.test.js
 */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert');

const ROOT = path.join(__dirname, '..');
const DOC_PATH = path.join(ROOT, 'docs', '作品集主文档_V1.3.md');
const doc = fs.readFileSync(DOC_PATH, 'utf8');

test('标注版本，并保留三类信息的阅读约定', () => {
  assert.ok(/版本号：V1\.\d/.test(doc), '应标注版本号');
  assert.ok(doc.includes('2026/09/21'), '应记录当前修订时间');

  ['**实测**', '**已上线**', '**[待验证]**'].forEach((mark) => {
    assert.ok(doc.includes(mark), '应保留三类信息标注：' + mark);
  });
});

test('四条关键决策齐全', () => {
  assert.ok(doc.includes('## 二、四条关键决策'), '章节标题应随决策数量更新');

  [1, 2, 3, 4].forEach((index) => {
    assert.ok(doc.includes(`### ${index}. `), `应保留第 ${index} 条关键决策`);
  });
  ['锁定区块', '先建评测', '会话级', '原地回填'].forEach((keyword) => {
    assert.ok(doc.includes(keyword), '关键决策应包含：' + keyword);
  });
});

test('补入了导入、保真导出与话术历史三条能力', () => {
  ['Word 保真导出', '话术历史', '导入'].forEach((keyword) => {
    assert.ok(doc.includes(keyword), '文档应提到能力：' + keyword);
  });

  assert.ok(doc.includes('只替换被采纳建议所在的那几行文字'), '应写明保真导出的做法');
  assert.ok(doc.includes('只支持 Word 来源'), '应写明保真导出的边界');
  assert.ok(doc.includes('复制过的话术自动进入'), '应写明话术历史的触发点');
});

test('文件索引里的每个路径都真实存在', () => {
  const index = doc.split('## 附：对应仓库文件')[1] ?? '';
  const files = [...index.matchAll(/[\w\u4e00-\u9fff][\w\u4e00-\u9fff.\-/]*\.md/g)].map(
    (match) => match[0]
  );

  assert.ok(files.length >= 8, '文件索引应覆盖各层文档，实际 ' + files.length + ' 条');
  files.forEach((file) => {
    assert.ok(fs.existsSync(path.join(ROOT, file)), '索引里的文件应存在：' + file);
  });
});

test('已完成的能力都有对应证据行，没有实测数据的标为待验证', () => {
  ['自动化测试', 'Word 往返一致性', '改写长度口径'].forEach((row) => {
    assert.ok(doc.includes(row), '评测体系应包含：' + row);
  });
  assert.ok(doc.includes('[待验证]'), '没有实测数据的能力应标为待验证');

  // AI 体验的边界设计：三条边界要么有实现，要么写明没做与原因
  const boundary = doc.split('### AI 体验的边界设计')[1]?.split('## 四、')[0] ?? '';
  assert.ok(boundary.length > 0, '应有「AI 体验的边界设计」一节');
  ['bad case', '降级', '成本'].forEach((key) => {
    assert.ok(boundary.includes(key), '边界设计应覆盖：' + key);
  });
  assert.ok(boundary.includes('没做') && boundary.includes('原因'), '没做的部分必须写明原因');
  assert.ok(boundary.includes('代价'), '不提供降级路径的代价要写明');

  // 人评一侧：必须说明它是方法演示，而不是用户评价
  assert.ok(doc.includes('主观质量（人评）'), '评测体系应有人评一格');
  assert.ok(doc.includes('主观质量评分_V1.1.md'), '人评一格应指向评分标准文档');
  assert.ok(
    doc.includes('不是外部证据') || doc.includes('方法演示'),
    '人评不得被写成用户评价'
  );

  // 评分结果本身：均分、最低分与「与产品承诺冲突」这条都要写出来
  const scoring = fs.readFileSync(path.join(__dirname, '..', 'docs', '主观质量评分_V1.1.md'), 'utf8');
  assert.ok(scoring.includes('3.46 / 5'), '评分结果应写明总均分');
  assert.ok(scoring.includes('3.00') && scoring.includes('3.75'), '应写明各维度均分');
  assert.ok(scoring.includes('最低分'), '应指出最低分样本');
  assert.ok(scoring.includes('不是外部证据'), '应标明它不是外部证据');
  assert.ok(scoring.includes('不做二次加工'), '评分者给的原始输入要原样记录');
  assert.ok(scoring.includes('更正记录'), '作废过的那一版必须留痕，不能悄悄抹掉');
  assert.ok(scoring.includes('自证倾向'), '评分者即产品作者这条偏见必须写明');
});

test('我的角色已有认领记录，且每条认领都配了追问准备', () => {
  const section = doc.split('## 八、我的角色')[1] ?? '';

  // 只数「你的确认」列里被认领的行（行尾就是加粗的三个字），不含填写指引里的示例
  const claimed = (section.match(/\| \*\*本人决定\*\* \|$/gm) ?? []).length;
  assert.ok(claimed >= 4, '应至少有四条本人认领，实际 ' + claimed + ' 条');
  assert.ok(section.includes('已认领的四条：追问准备'), '认领之后应给出追问准备');
  assert.ok(section.includes('放弃了什么'), '追问准备应覆盖「放弃了什么」');
});

