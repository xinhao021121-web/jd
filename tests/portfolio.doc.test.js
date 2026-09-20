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
const DOC_PATH = path.join(ROOT, 'docs', '作品集主文档_V1.2.md');
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
});
