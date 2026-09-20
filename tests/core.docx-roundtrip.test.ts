/**
 * 真实 Word 样本的往返一致性（技术方案 V0.4 增补 六）：
 * 回填只允许改动命中的那段文字，其余字节必须与原文件逐字一致。
 * 样本与导入用例共用 tests/samples/import/resume-sample.docx，避免再造一份会漂移的夹具。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { fillDocxTemplate } from '@zhipin/core';

const samplePath = fileURLToPath(new URL('./samples/import/resume-sample.docx', import.meta.url));
const entries = unzipSync(new Uint8Array(readFileSync(samplePath)));
const documentXml = new TextDecoder().decode(entries['word/document.xml']);

const textNodes = [
  ...documentXml.matchAll(/<w:t(?=[\s/>])[^>]*?>([\s\S]*?)<\/w:t>/g)
].map((match) => match[1] as string);

/** 挑一个在文件里只出现一次、且不含实体的文本片段，用来验证「只有这一处变了」 */
const uniqueText = textNodes.find(
  (text) => text.length >= 4 && !text.includes('&') && documentXml.split(text).length === 2
);

describe('真实 docx 样本的往返一致性', () => {
  it('样本本身是可用的 docx 且含正文', () => {
    expect(entries['word/document.xml']).toBeInstanceOf(Uint8Array);
    expect(textNodes.length).toBeGreaterThan(10);
    expect(uniqueText).toBeTruthy();
  });

  it('一条建议都不采纳时，正文与原文逐字一致', () => {
    const result = fillDocxTemplate(documentXml, []);

    expect(result).toMatchObject({ applied: 0, skipped: 0, fallback: false });
    expect(result.xml).toBe(documentXml);
  });

  it('回填真实样本时只有命中的那一段发生变化', () => {
    const before = uniqueText as string;
    const after = `${before}（改写）`;
    const result = fillDocxTemplate(documentXml, [{ before, after }]);

    expect(result).toMatchObject({ applied: 1, skipped: 0, fallback: false });
    // after 只出现一次，且把它换回 before 后与原文完全相同
    expect(result.xml.split(after)).toHaveLength(2);
    expect(result.xml.split(after).join(before)).toBe(documentXml);
  });

  it('回填后的文件重新打包仍可解包，条目与正文都保持完整', () => {
    const before = uniqueText as string;
    const result = fillDocxTemplate(documentXml, [{ before, after: `${before}（改写）` }]);

    const zipped = zipSync({
      ...entries,
      'word/document.xml': new TextEncoder().encode(result.xml)
    });
    const reopened = unzipSync(zipped);

    expect(Object.keys(reopened).sort()).toEqual(Object.keys(entries).sort());
    expect(new TextDecoder().decode(reopened['word/document.xml'])).toBe(result.xml);
    expect(new TextDecoder().decode(reopened['[Content_Types].xml'])).toBe(
      new TextDecoder().decode(entries['[Content_Types].xml'])
    );
  });

  it('改写被实时写回后，正文里不再残留被替换的原文', () => {
    const before = uniqueText as string;
    const result = fillDocxTemplate(documentXml, [{ before, after: `${before}（改写）` }]);

    expect(result.xml).toContain(`${before}（改写）`);
    // 原文只剩在改写后的文字里，没有独立残留
    expect(result.xml.split(before)).toHaveLength(2);
  });
});
