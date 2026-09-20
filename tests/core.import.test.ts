import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  assembleDocxParagraphs,
  decodeTextFile,
  hasUsableTextLayer,
  rebuildPdfText,
  sanitizeOcrText,
  sniffFileType,
  type PdfTextItem
} from '@zhipin/core';
import { MIN_TEXT_LENGTH } from '@zhipin/shared';

const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('sniffFileType', () => {
  it('按 magic number 识别 pdf 与 docx', () => {
    expect(sniffFileType(bytesOf('%PDF-1.7\n...'))).toBe('pdf');
    expect(sniffFileType(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]))).toBe('docx');
  });

  it('可读文本按 text 处理，不识别扩展名', () => {
    expect(sniffFileType(bytesOf('工作经历\n负责订单中心开发'))).toBe('text');
  });

  it('图片等二进制判定为 unknown', () => {
    // 真实 PNG 头带 NUL 字节，JPEG 以 0xFFD8 开头
    expect(
      sniffFileType(
        new Uint8Array([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
          0x52
        ])
      )
    ).toBe('unknown');
    expect(sniffFileType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]))).toBe('unknown');
  });

  it('空文件判定为 unknown', () => {
    expect(sniffFileType(new Uint8Array())).toBe('unknown');
  });

  it('含 NUL 的 UTF-16 文本不算可读文本，避免乱码进草稿', () => {
    expect(sniffFileType(new Uint8Array([0xff, 0xfe, 0x2d, 0x00, 0x4f, 0x00]))).toBe('unknown');
  });
});

describe('decodeTextFile', () => {
  it('UTF-8 正常解码并统一换行', () => {
    expect(decodeTextFile(bytesOf('第一行\r\n第二行\r第三行'))).toBe('第一行\n第二行\n第三行');
  });

  it('去掉 UTF-8 BOM', () => {
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...bytesOf('简历')]);
    expect(decodeTextFile(withBom)).toBe('简历');
  });

  it('UTF-8 严格解码失败时回退 GBK', () => {
    // "简历" 的 GBK 编码：0xBC 0xF2 0xC0 0xFA
    const gbk = new Uint8Array([0xbc, 0xf2, 0xc0, 0xfa]);
    expect(decodeTextFile(gbk)).toBe('简历');
  });
});

describe('rebuildPdfText', () => {
  const item = (str: string, x: number, y: number, width = str.length * 6): PdfTextItem => ({
    str,
    x,
    y,
    width
  });

  it('按 y 聚类成行、行内按 x 排序，间隙补空格', () => {
    const text = rebuildPdfText(
      [item('工程师', 120, 700), item('后端开发', 40, 700), item('工作经历', 40, 720)],
      { pageWidth: 600 }
    );

    expect(text).toBe('工作经历\n后端开发 工程师');
  });

  it('上一行没有句末标点时与下一行合并为一段，项目符号行单独成段', () => {
    const text = rebuildPdfText([
      item('负责订单中心核心链路开发，使用 Java 与 Spring Boot', 40, 700),
      item('搭建订单创建与履约服务。', 40, 682),
      item('- 主导订单查询接口性能优化', 40, 664)
    ]);

    expect(text).toBe(
      '负责订单中心核心链路开发，使用 Java 与 Spring Boot 搭建订单创建与履约服务。\n- 主导订单查询接口性能优化'
    );
  });

  it('小标题独立成行：上一行没有句末标点也不会把「工作经历」并进上一行', () => {
    const text = rebuildPdfText(
      [
        item('李某某 | Java 后端开发工程师 | 3 年经验', 40, 720),
        item('工作经历', 40, 700),
        item('2023.06 - 至今 某电商科技有限公司 后端开发工程师', 40, 682),
        item('专业技能', 40, 664)
      ],
      { pageWidth: 600 }
    );

    expect(text.split('\n')).toEqual([
      '李某某 | Java 后端开发工程师 | 3 年经验',
      '工作经历',
      '2023.06 - 至今 某电商科技有限公司 后端开发工程师',
      '专业技能'
    ]);
  });

  it('同一行内 x 间隙超过页宽 15% 时按双栏切开', () => {
    const text = rebuildPdfText(
      [
        item('教育背景', 40, 700),
        item('专业技能', 340, 700),
        item('某某大学 本科', 40, 682),
        item('Java、Redis', 340, 682)
      ],
      { pageWidth: 600 }
    );

    expect(text).toBe('教育背景\n专业技能\n某某大学 本科\nJava、Redis');
  });

  it('按页顺序拼接，页与页之间空一行；缺页宽时按最右边缘推断', () => {
    const text = rebuildPdfText([
      { ...item('第一页结尾。', 40, 700), page: 2 },
      { ...item('第一页开头。', 40, 720), page: 1 }
    ]);

    expect(text).toBe('第一页开头。\n\n第一页结尾。');
  });

  it('空输入返回空字符串', () => {
    expect(rebuildPdfText([])).toBe('');
    expect(rebuildPdfText([item('   ', 0, 0)])).toBe('');
  });

  it('拿不到页宽时不做分栏判断，按单栏重排', () => {
    expect(rebuildPdfText([item('工作经历', 40, 700), item('后端开发', 340, 700)], { pageWidth: 0 })).toBe(
      '工作经历 后端开发'
    );
  });

  it('双栏回归样本：左右栏各自成行，不与正文拼在一起', () => {
    const sample = JSON.parse(
      readFileSync(new URL('./samples/import/two-column-items.json', import.meta.url), 'utf8')
    ) as { pageWidth: number; items: PdfTextItem[] };

    expect(rebuildPdfText(sample.items, { pageWidth: sample.pageWidth })).toBe(
      [
        '教育背景',
        '专业技能',
        '某某大学 本科',
        'Java、Redis',
        '工作经历',
        '- 负责订单中心核心链路开发，使用 Java 与 Redis'
      ].join('\n')
    );
  });
});

describe('assembleDocxParagraphs', () => {
  it('压缩空行、统一项目符号与编号写法', () => {
    const text = assembleDocxParagraphs([
      '工作经历',
      '',
      '• 负责订单中心开发',
      '1．主导性能优化',
      '2023.06 - 至今  某电商科技',
      '   ',
      '专业技能'
    ]);

    expect(text).toBe(
      ['工作经历', '- 负责订单中心开发', '1. 主导性能优化', '2023.06 - 至今 某电商科技', '专业技能'].join(
        '\n'
      )
    );
  });

  it('全角空格与不换行空格收敛为普通空格', () => {
    expect(assembleDocxParagraphs(['姓名\u00a0\u00a0李某某', '岗位\u3000后端'])).toBe(
      '姓名 李某某\n岗位 后端'
    );
  });

  it('没有段落时返回空字符串', () => {
    expect(assembleDocxParagraphs([])).toBe('');
    expect(assembleDocxParagraphs(['', '   '])).toBe('');
  });
});

describe('sanitizeOcrText', () => {
  it('去掉代码块包裹与「以下是识别结果」前缀', () => {
    expect(sanitizeOcrText('```\n识别结果：\n公司：某电商科技\n岗位：Java 开发\n```')).toBe(
      '公司：某电商科技\n岗位：Java 开发'
    );
    expect(sanitizeOcrText('以下是识别结果：\n公司：某电商科技')).toBe('公司：某电商科技');
  });

  it('压缩连续空行与行尾空白', () => {
    expect(sanitizeOcrText('岗位职责   \n\n\n\n1. 负责后端开发')).toBe('岗位职责\n\n1. 负责后端开发');
  });

  it('超长文本按上限截断', () => {
    const long = '招聘要求'.repeat(100);
    expect(sanitizeOcrText(long, 20)).toHaveLength(20);
  });

  it('空输入返回空字符串', () => {
    expect(sanitizeOcrText('')).toBe('');
    expect(sanitizeOcrText('   \n\n')).toBe('');
  });
});

describe('hasUsableTextLayer', () => {
  it('正常中文文本层可用', () => {
    expect(hasUsableTextLayer('工作经历\n负责订单中心核心链路开发，使用 Java 与 Redis')).toBe(true);
  });

  it('内容过短或为空按不可用处理', () => {
    expect(hasUsableTextLayer('')).toBe(false);
    expect(hasUsableTextLayer('短'.repeat(MIN_TEXT_LENGTH - 1))).toBe(false);
  });

  it('替换字符过多按扫描件处理', () => {
    const garbled = `\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD工作经历`;
    expect(hasUsableTextLayer(garbled)).toBe(false);
  });

  it('几乎没有有效字符时按不可用处理', () => {
    expect(hasUsableTextLayer('. . . . . . . . . . . . . . . . . . . . .')).toBe(false);
  });
});
