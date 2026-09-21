/**
 * 把作品集页面与素材同步进前端静态资源目录（差距诊断 G9 的部署物料）。
 *
 * 源文件在仓库根目录、素材在 docs/assets/；要让它跟产品同域可访问，就得进
 * apps/web/dist（Worker 的 assets 目录）。这里把 HTML 复制成
 * apps/web/public/portfolio.html，把引用的素材复制成 portfolio-assets/，
 * 并替换 HTML 里的路径前缀——源文件保持本地可打开，产物才是部署形态。
 *
 * 单向同步：根目录是源，public/ 是产物，不要反过来改产物。
 * 运行：pnpm portfolio:sync（pnpm build 与 pnpm deploy:cf 会自动先跑）
 */
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const sourceHtml = fileURLToPath(new URL('作品集_CaseStudy_V1.0.html', root));
const publicDir = fileURLToPath(new URL('apps/web/public/', root));
const assetsDir = `${publicDir}portfolio-assets/`;

const SOURCE_PREFIX = 'docs/assets/';
const TARGET_PREFIX = 'portfolio-assets/';

function main(): void {
  const html = readFileSync(sourceHtml, 'utf8');

  // 从 HTML 现取引用清单，避免手写一份会过期的素材列表
  const referenced = [
    ...new Set([...html.matchAll(/docs\/assets\/([^"'\s)]+)/g)].map((match) => match[1]!))
  ];
  if (!referenced.length) {
    throw new Error('HTML 里没有找到 docs/assets/ 引用，检查源文件是否被改过');
  }

  rmSync(publicDir, { recursive: true, force: true });
  mkdirSync(assetsDir, { recursive: true });

  let missing = 0;
  referenced.forEach((name) => {
    try {
      copyFileSync(fileURLToPath(new URL(`docs/assets/${name}`, root)), `${assetsDir}${name}`);
    } catch {
      // PDF 可能还没导出：只提示，不阻断构建
      console.warn(`  跳过缺失的素材：${name}`);
      missing += 1;
    }
  });

  writeFileSync(`${publicDir}portfolio.html`, html.split(SOURCE_PREFIX).join(TARGET_PREFIX), 'utf8');

  console.log(`作品集已同步到 apps/web/public/：1 个页面 + ${referenced.length - missing} 个素材`);
  console.log('部署后访问：https://<你的域名>/portfolio.html');
}

main();
