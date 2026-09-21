/**
 * 假设库与模拟推演材料的边界检查。
 *
 * 这两个文件都存在被误用的风险：假设库可能被当结论，模拟访谈可能被当证据。
 * 所以测试钉住的不是内容质量，而是**使用边界有没有写死在纸面上**。
 * 运行方式：node --test tests/hypothesis.test.js
 */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert');

const ROOT = path.join(__dirname, '..');
const DOCS_DIR = path.join(ROOT, 'docs');
const pool = fs.readFileSync(path.join(DOCS_DIR, '待验证假设_V0.1.md'), 'utf8');
const mock = fs.readFileSync(path.join(DOCS_DIR, '模拟访谈推演_非证据_V0.1.md'), 'utf8');

test('假设库声明自己是假设而不是证据', () => {
  assert.ok(/版本号：V0\.\d/.test(pool), '应标注版本号');
  assert.ok(pool.includes('这是假设库，不是证据'), '应显式声明性质');
  assert.ok(pool.includes('不得写进'), '应禁止写进主文档结论区');
  assert.ok(pool.includes('也不得在面试里当结论讲'), '应限制面试中的使用方式');
});

test('两个来源分清用途，且不把模拟推演当交叉验证', () => {
  assert.ok(pool.includes('不能作为任何结论的依据'), '应写明模拟推演的用途边界');
  assert.ok(pool.includes('不是独立证据源'), '应点明模拟推演不是独立证据源');
  assert.ok(pool.includes('不构成交叉验证'), '应禁止把两者一致当成互证');
});

test('新增假设 H7–H11 齐全，每条都标了来源与影响', () => {
  for (let index = 7; index <= 11; index += 1) {
    assert.ok(pool.includes('| H' + index + ' |'), '应包含假设 H' + index);
  }
  assert.ok(pool.includes('若成立，对产品意味着什么'), '应写明假设成立后的产品含义');
  assert.ok(pool.includes('H7 最值得先验'), '应给出优先级判断');
});

test('提纲改进建议是可执行的具体条目，不依赖数据来源', () => {
  assert.ok(pool.includes('不依赖数据来源'), '应说明这些改进不依赖数据来源');
  assert.ok(pool.includes('渠道筛选题'), '应包含渠道筛选题建议');
  assert.ok(pool.includes('把「联系方式」与「作品／项目信息」分开问'), '应包含 Q8 的拆分建议');
  assert.ok(pool.includes('升到 V1.1'), '应写明落实方式');
});

test('定向追问可直接问出口，覆盖 H7 与 H11', () => {
  assert.ok(pool.includes('你有没有因为某个岗位写着'), '应给出 H7 的定向追问');
  assert.ok(pool.includes('你更在意联系方式被存下来'), '应给出 H11 的定向追问');
});

test('假设库有自我清空的机制，避免只进不出', () => {
  assert.ok(pool.includes('假设库要能变空'), '应要求验证后划掉假设');
});

test('模拟推演文件本身带「非证据」标注，且指向假设库', () => {
  assert.ok(mock.includes('这不是用户证据'), '模拟材料应带非证据标注');
  assert.ok(mock.includes('不得作为「用户访谈结论」引用'), '应禁止作为访谈结论引用');
  assert.ok(mock.includes('待验证假设_V0.1.md'), '应指向提炼后的假设库');
  assert.ok(mock.includes('真实访谈目前只有 1 份'), '应指向当前的真实证据量');
});

test('引用的仓库路径都真实存在', () => {
  [pool, mock].forEach((doc) => {
    const targets = [...doc.matchAll(/\]\(([^)\s]+\.md)\)/g)].map((match) => match[1]);
    targets.forEach((target) => {
      assert.ok(
        fs.existsSync(path.resolve(DOCS_DIR, target)),
        '引用路径应存在（相对 docs/）：' + target
      );
    });
  });
});
