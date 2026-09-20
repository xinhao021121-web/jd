import { describe, expect, it } from 'vitest';
import {
  decodeXmlText,
  encodeXmlText,
  fillDocxTemplate,
  normalizeLineWithSpans,
  suggestionLengthLimit
} from '@zhipin/core';

const NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const documentXml = (body: string, prefix = 'w'): string => {
  const tag = (name: string): string => (prefix ? `${prefix}:${name}` : name);
  const declaration = prefix ? `xmlns:${prefix}="${NS}"` : `xmlns="${NS}"`;
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<${tag('document')} ${declaration}><${tag('body')}>${body}</${tag('body')}></${tag('document')}>`
  );
};

const paragraph = (runs: string): string => `<w:p>${runs}</w:p>`;
const run = (text: string): string => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;

/** 改造前 import.ts 里的实现，作为规整规则「行为不变」的参照 */
const legacyNormalize = (line: string): string =>
  line
    .replace(/[\u00a0\u3000]/g, ' ')
    .replace(/^\s*[•·▪◦●○‣∙※*]\s*/, '- ')
    .replace(/^(\d{1,2})\s*[.、．)）]\s*(?=\S)/, '$1. ')
    .replace(/[ \t]+/g, ' ')
    .trim();

describe('normalizeLineWithSpans', () => {
  const samples = [
    '',
    '负责订单系统开发',
    '• 负责订单系统开发',
    '· 负责订单系统',
    '1、负责订单系统',
    '1) 负责订单系统',
    '12.负责订单系统',
    '  首尾有空格的内容  ',
    '连续    空格\t混合\u00a0全角\u3000空格',
    '  • 带缩进的项目符号  ',
    '技能：Java、MySQL',
    '2022、2023 两届',
    '\u00a0\u3000',
    '3、4 月完成'
  ];

  it('规整结果与改造前的实现逐条一致', () => {
    samples.forEach((sample) => {
      expect(normalizeLineWithSpans(sample).text).toBe(legacyNormalize(sample));
    });
  });

  it('每个字符都能回溯到原文区间，且区间不越界', () => {
    samples.forEach((sample) => {
      const { text, spans } = normalizeLineWithSpans(sample);
      expect(spans).toHaveLength(text.length);

      spans.forEach((span) => {
        expect(span[0]).toBeGreaterThanOrEqual(0);
        expect(span[1]).toBeLessThanOrEqual(sample.length);
        expect(span[0]).toBeLessThan(span[1]);
      });

      // 起点必须单调不减：替换区间由首尾字符的区间端点决定，顺序乱了就会取错范围
      spans.forEach((span, index) => {
        const previous = spans[index - 1];
        if (previous) expect(span[0]).toBeGreaterThanOrEqual(previous[0]);
      });
    });
  });

  it('项目符号替换出的「- 」带上被替代区间的坐标', () => {
    const { text, spans } = normalizeLineWithSpans('• 负责订单');

    expect(text).toBe('- 负责订单');
    expect(spans[0]).toEqual([0, 2]);
    expect(spans[1]).toEqual([0, 2]);
    expect(spans[2]).toEqual([2, 3]);
    expect(spans[spans.length - 1]).toEqual([5, 6]);
  });

  it('编号替换后数字与顿号一起落在同一区间', () => {
    const { text, spans } = normalizeLineWithSpans('1、负责订单');

    expect(text).toBe('1. 负责订单');
    expect(spans[0]).toEqual([0, 2]);
    expect(spans[2]).toEqual([0, 2]);
    expect(spans[3]).toEqual([2, 3]);
  });

  it('连续空格与全角空格都映射回被压缩掉的原始区间', () => {
    const { text, spans } = normalizeLineWithSpans('A\u00a0\u3000\u3000B');

    expect(text).toBe('A B');
    expect(spans[1]).toEqual([1, 4]);
    expect(spans[2]).toEqual([4, 5]);
  });
});

describe('XML 文本编解码', () => {
  it('解码命名实体与数字字符引用', () => {
    expect(decodeXmlText('Java &amp; Go &#39;x&#x27; &lt;b&gt;')).toBe("Java & Go 'x' <b>");
  });

  it('未知实体保持原样，不做猜测', () => {
    expect(decodeXmlText('&unknown; &amp;')).toBe('&unknown; &');
  });

  it('编码只转义文本节点里有语义的三个字符', () => {
    expect(encodeXmlText('a & b < c > d')).toBe('a &amp; b &lt; c &gt; d');
  });
});

describe('fillDocxTemplate', () => {
  it('没有建议时逐字返回原文，保证「未采纳即与原件一致」', () => {
    const xml = documentXml(paragraph(run('负责订单系统开发')));
    const result = fillDocxTemplate(xml, []);

    expect(result.xml).toBe(xml);
    expect(result).toMatchObject({ applied: 0, skipped: 0, fallback: false });
  });

  it('在单个文本片段内原地替换，其余字节不动', () => {
    const xml = documentXml(
      `<w:p><w:pPr><w:jc w:val="center"/></w:pPr>${run('负责订单系统开发')}</w:p>`
    );
    const result = fillDocxTemplate(xml, [
      { before: '负责订单系统开发', after: '负责订单系统的开发与性能优化' }
    ]);

    expect(result).toMatchObject({ applied: 1, skipped: 0, fallback: false });
    expect(result.xml).toContain('负责订单系统的开发与性能优化');
    expect(result.xml).not.toContain('负责订单系统开发<');
    expect(result.xml).toContain('<w:pPr><w:jc w:val="center"/></w:pPr>');
  });

  it('替换跨片段时清空中间片段，并把改写写进首个受影响片段', () => {
    const xml = documentXml(paragraph(`${run('负责订单')}${run('系统')}${run('开发')}`));
    const result = fillDocxTemplate(xml, [{ before: '负责订单系统开发', after: '主导订单中台建设' }]);

    expect(result.applied).toBe(1);
    expect(result.xml).toContain('<w:t xml:space="preserve">主导订单中台建设</w:t>');
    expect(result.xml).toContain('<w:t xml:space="preserve"></w:t>');
  });

  it('替换区间落在片段边界中间时保留前后缀', () => {
    const xml = documentXml(paragraph(`${run('负责订单')}${run('系统开发工作')}`));
    const result = fillDocxTemplate(xml, [{ before: '订单系统', after: '订单中台' }]);

    expect(result.applied).toBe(1);
    expect(result.xml).toContain('负责订单中台');
    expect(result.xml).toContain('开发工作');
  });

  it('模型看到的规整写法能定位回文件里的项目符号原文', () => {
    const xml = documentXml(paragraph(run('• 负责订单系统')));
    const result = fillDocxTemplate(xml, [
      { before: '- 负责订单系统', after: '- 负责订单系统与对账链路' }
    ]);

    expect(result.applied).toBe(1);
    expect(result.xml).toContain('>- 负责订单系统与对账链路<');
    expect(result.xml).not.toContain('•');
  });

  it('编号写法被规整后仍能定位回原文', () => {
    const xml = documentXml(paragraph(run('1、负责订单系统')));
    const result = fillDocxTemplate(xml, [
      { before: '1. 负责订单系统', after: '1. 负责订单系统中台' }
    ]);

    expect(result.applied).toBe(1);
    expect(result.xml).toContain('>1. 负责订单系统中台<');
  });

  it('替换区间覆盖制表符时把该制表符一并删掉', () => {
    const xml = documentXml(
      paragraph(`${run('技能：')}<w:r><w:tab/></w:r>${run('Java')}`)
    );
    const result = fillDocxTemplate(xml, [{ before: '技能： Java', after: '技能：Java 与 MySQL' }]);

    expect(result.applied).toBe(1);
    expect(result.xml).not.toContain('<w:tab/>');
    expect(result.xml).toContain('技能：Java 与 MySQL');
  });

  it('文本实体在匹配前解码、写回时重新编码', () => {
    const xml = documentXml(paragraph(run('Java &amp; Go')));
    const result = fillDocxTemplate(xml, [{ before: 'Java & Go', after: 'Java & Go 双栈' }]);

    expect(result.applied).toBe(1);
    expect(result.xml).toContain('>Java &amp; Go 双栈<');
    expect(decodeXmlText(result.xml)).toContain('Java & Go 双栈');
  });

  it('定位不到的建议跳过并计数，不影响其他建议', () => {
    const xml = documentXml(paragraph(`${run('负责订单系统')}${run('熟悉 Java')}</w:p>`));
    const result = fillDocxTemplate(xml, [
      { before: '简历里没有的这句话', after: '改写内容' },
      { before: '熟悉 Java', after: '熟悉 Java 与 Spring' }
    ]);

    expect(result).toMatchObject({ applied: 1, skipped: 1 });
    expect(result.xml).toContain('熟悉 Java 与 Spring');
    expect(result.xml).not.toContain('改写内容');
  });

  it('改写内容不会被当成替换模式处理', () => {
    const xml = documentXml(paragraph(run('负责订单系统')));
    const result = fillDocxTemplate(xml, [{ before: '负责订单系统', after: '$& 与 $1 都要保留' }]);

    expect(result.xml).toContain('$&amp; 与 $1 都要保留');
  });

  it('文本只归属最内层段落，文本框内容不会连带改到外层', () => {
    const xml = documentXml(
      '<w:p><w:r><w:t>个人优势</w:t></w:r>' +
        '<w:r><w:pict><w:txbxContent><w:p><w:r><w:t>文本框里的文字</w:t></w:r></w:p></w:txbxContent></w:pict></w:r>' +
        '</w:p>'
    );

    // 外层段落的文本是「个人优势」，不含文本框内容
    const span = fillDocxTemplate(xml, [
      { before: '个人优势文本框里的文字', after: '不该出现的结果' }
    ]);
    expect(span).toMatchObject({ applied: 0, skipped: 1 });

    // 文本框自身仍可被正常改写
    const inner = fillDocxTemplate(xml, [{ before: '文本框里的文字', after: '侧栏里的文字' }]);
    expect(inner.applied).toBe(1);
    expect(inner.xml).toContain('侧栏里的文字');
    expect(inner.xml).toContain('个人优势');
  });

  it('同一行重叠的两条建议只应用靠前的一条', () => {
    const xml = documentXml(paragraph(run('负责订单系统开发')));
    const result = fillDocxTemplate(xml, [
      { before: '负责订单', after: '负责订单中台' },
      { before: '订单系统', after: '订单中台系统' }
    ]);

    expect(result).toMatchObject({ applied: 1, skipped: 1 });
    expect(result.xml).toContain('负责订单中台系统开发');
  });

  it('同一条建议在多个段落都能匹配时只应用第一次', () => {
    const xml = documentXml(
      paragraph(run('负责订单系统')) + paragraph(run('负责订单系统'))
    );
    const result = fillDocxTemplate(xml, [{ before: '负责订单系统', after: '负责订单中台' }]);

    expect(result.applied).toBe(1);
    expect(result.xml.match(/负责订单中台/g)).toHaveLength(1);
    expect(result.xml.match(/负责订单系统/g)).toHaveLength(1);
  });

  it('段落内的换行不参与跨行匹配', () => {
    const xml = documentXml(
      paragraph(`${run('第一行')}<w:r><w:br/></w:r>${run('第二行')}`)
    );
    const result = fillDocxTemplate(xml, [{ before: '第一行第二行', after: '不该命中' }]);

    expect(result).toMatchObject({ applied: 0, skipped: 1 });
  });

  it('空文本片段与自闭合片段不影响扫描', () => {
    const xml = documentXml(
      paragraph(`<w:r><w:t/></w:r>${run('负责订单系统')}<w:r><w:t xml:space="preserve"></w:t></w:r>`)
    );
    const result = fillDocxTemplate(xml, [{ before: '负责订单系统', after: '负责订单中台' }]);

    expect(result.applied).toBe(1);
    expect(result.xml).toContain('负责订单中台');
  });

  it('无前缀命名空间同样支持', () => {
    const xml = documentXml('<p><r><t>负责订单系统</t></r></p>', '');
    const result = fillDocxTemplate(xml, [{ before: '负责订单系统', after: '负责订单中台' }]);

    expect(result.applied).toBe(1);
    expect(result.xml).toContain('负责订单中台');
  });

  it('探测不到命名空间声明时降级为不做任何替换', () => {
    const xml = '<document><body><p><r><t>负责订单系统</t></r></p></body></document>';
    const result = fillDocxTemplate(xml, [{ before: '负责订单系统', after: '负责订单中台' }]);

    expect(result).toMatchObject({ applied: 0, skipped: 1, fallback: true });
    expect(result.xml).toBe(xml);
  });

  it('多条建议同时命中不同段落时全部写出', () => {
    const xml = documentXml(
      paragraph(run('负责订单系统')) + paragraph(run('熟悉 Java 开发'))
    );
    const result = fillDocxTemplate(xml, [
      { before: '负责订单系统', after: '负责订单中台' },
      { before: '熟悉 Java 开发', after: '熟悉 Java 与 Spring 开发' }
    ]);

    expect(result).toMatchObject({ applied: 2, skipped: 0 });
    expect(result.xml).toContain('负责订单中台');
    expect(result.xml).toContain('熟悉 Java 与 Spring 开发');
  });
});

describe('suggestionLengthLimit', () => {
  it('默认按 40% 的红线判定', () => {
    expect(suggestionLengthLimit('负'.repeat(100))).toBe(140);
  });

  it('可以按提示词的目标比例（20%）单独取值', () => {
    expect(suggestionLengthLimit('负'.repeat(100), 0.2)).toBe(120);
  });

  it('短句按 5 个字给固定余量，不把正常改写框死', () => {
    expect(suggestionLengthLimit('负责订单')).toBe(9);
    expect(suggestionLengthLimit('')).toBe(5);
  });

  it('中英文混排按字符数计算', () => {
    // 'Java 开发' 共 7 个字符，40% 只多出 3 个字，按 5 个字的固定余量给
    expect(suggestionLengthLimit('Java 开发')).toBe(12);
  });
});
