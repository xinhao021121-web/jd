/**
 * 本地 mock 模型服务：OpenAI 兼容 /chat/completions，流式返回 NDJSON。
 * 仅用于本地联调与端到端测试，不进入生产链路（技术方案 八）。
 * 启动：pnpm mock:model，然后把 DEEPSEEK_BASE_URL 指向它。
 */
import { createServer } from 'node:http';
import { analyzeMatch, extractSkills, parseResume } from '@zhipin/core';

const PORT = Number(process.env.MOCK_MODEL_PORT ?? 8788);

function between(text: string, start: string, end: string): string {
  const after = text.split(start)[1];
  if (after === undefined) return '';
  return (after.split(end)[0] ?? '').trim();
}

function resumeFacts(resume: string): { highlight: string; skills: string } {
  const lines = resume
    .split('\n')
    .map((line) => line.replace(/^[-•\s]+/, '').trim())
    .filter((line) => line.length >= 10);
  const highlight =
    lines.find((line) => /\d+\s*(%|ms|万|亿|倍)/.test(line)) ?? lines[0] ?? '负责相关业务开发';
  return { highlight, skills: extractSkills(resume).slice(0, 3).join('、') };
}

function greetingLines(resume: string, jd: string): string[] {
  const analysis = analyzeMatch(resume, jd);
  const { highlight, skills } = resumeFacts(resume);
  const role = /产品|需求分析/.test(resume + jd)
    ? '产品'
    : /前端|vue|react/i.test(resume + jd)
      ? '前端'
      : '后端';
  const focus = (analysis.matched.length ? analysis.matched : analysis.requirements).slice(0, 2).join('、');
  const low = analysis.lowMatch;

  const texts = low
    ? [
        `您好，我有${role}方向的工作经验，日常主要做${skills || '相关'}相关的事情。看到岗位方向与我的经历不完全是同一条线，但希望能了解一下具体需求，也方便您判断是否有可迁移的空间。`,
        `您好，${highlight}。岗位要求的方向与我的经历有差异，我不想硬套，如果团队愿意看可迁移的经验，我可以再补充一些细节供您判断。`,
        `您好，我目前主要做${role}方向的工作，想了解一下岗位的具体需求，方便聊聊吗？`
      ]
    : [
        `您好，我有${role}方向的工作经验，${skills || '相关技能'}是我日常工作的主要部分。${highlight}。看到岗位在找${focus || '相同方向'}的人，我的经历和这个岗位比较对口，方便的话想和您具体聊聊。`,
        `您好，${highlight}。岗位里提到的${focus || '方向'}正好是我一直在做的方向，希望能有机会和您详细沟通一下。`,
        `您好，${role}方向多年经验，熟悉${skills || '相关技能'}，和岗位要求比较匹配，方便聊聊吗？`
      ];

  return texts.map((text, index) =>
    JSON.stringify({
      type: 'item',
      kind: 'greeting',
      index,
      style: ['技能匹配型', '经历相关型', '简短直接型'][index],
      text
    })
  );
}

function suggestionLines(resume: string, jd: string): string[] {
  const analysis = analyzeMatch(resume, jd);
  // 术语对齐优先补这类带场景感的标签，与 PRD 3.3 的建议类型一致
  const preferred = ['高并发', '分布式', '性能优化', '微服务', '数据分析', '产品设计'];
  const term =
    preferred.find((skill) => analysis.matched.includes(skill)) ??
    analysis.matched[0] ??
    analysis.requirements[0] ??
    '';
  const lines: string[] = [];

  parseResume(resume)
    .filter((block) => block.kind === 'editable')
    .forEach((block) => {
      block.lines.forEach((line) => {
        const text = line.replace(/^[-•\s]+/, '').trim();
        if (text.length < 12 || text === block.title) return;
        if (/(%|ms|万|倍)/.test(text) && term && !text.includes(term)) {
          lines.push(
            JSON.stringify({
              type: 'item',
              kind: 'suggestion',
              index: lines.length,
              section: block.title,
              before: text,
              after: `${text}（${term}场景）`,
              reason: `这句已有量化结果，但没有点出岗位关注的「${term}」，补一个标签即可，不改变事实`,
              suggestionType: '术语对齐'
            })
          );
        }
      });
    });

  return lines.slice(0, 3);
}

const server = createServer((req, res) => {
  if (req.method !== 'POST' || !req.url?.includes('/chat/completions')) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
    return;
  }

  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
  });
  req.on('end', async () => {
    let userContent = '';
    let systemContent = '';
    try {
      const parsed = JSON.parse(body) as { messages?: { content?: string }[] };
      // 只解析最后一条用户消息，避免把系统提示词当成简历或 JD
      userContent = parsed.messages?.at(-1)?.content ?? '';
      systemContent = parsed.messages?.[0]?.content ?? '';
    } catch {
      userContent = '';
      systemContent = '';
    }

    const resume = between(userContent, '【简历原文】', '【岗位 JD】');
    const jd = between(userContent, '【岗位 JD】', '【本地匹配分析');
    const isSuggestion = systemContent.includes('简历顾问');
    const lines = isSuggestion ? suggestionLines(resume, jd) : greetingLines(resume, jd);
    const content = lines.join('\n') + '\n';

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    });

    // 逐行推送，模拟真实模型的增量输出
    const chunks = content.match(/[\s\S]{1,24}/g) ?? [];
    for (const chunk of chunks) {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n\n`);
      await new Promise((resolve) => setTimeout(resolve, 12));
    }
    res.write('data: [DONE]\n\n');
    res.end();
  });
});

server.listen(PORT, () => {
  console.log(JSON.stringify({ level: 'info', event: 'mock_model_listening', port: PORT }));
});
