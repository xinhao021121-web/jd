/**
 * Demo V0.4 的真实浏览器冒烟：原型是拿给人看的，光有 DOM 桩测试不够。
 * 用 file:// 打开单文件原型，走一遍「生成 → 复制 → 历史 → 导出入口」。
 */
import path from 'node:path';
import { expect, test } from '@playwright/test';

const DEMO = path.join(__dirname, '..', '..', '直聘打招呼助手_Demo_V0.4.html');
const DEMO_URL = encodeURI(`file:///${DEMO.replace(/\\/g, '/')}`);

test.beforeEach(async ({ page }) => {
  await page.goto(DEMO_URL);
  await page.evaluate(() => {
    try {
      localStorage.clear();
    } catch {
      /* file:// 下可能不可用，跳过即可 */
    }
  });
  await page.reload();
});

test('Demo V0.4：复制话术进入历史，历史页可回看，导出入口按来源置灰', async ({ page }) => {
  // 1. 侧边栏的「话术历史」已经是正式入口，空态给出引导
  await page.locator('[data-view="history"]').click();
  await expect(page.locator('#view-history')).toBeVisible();
  await expect(page.locator('#historyEmpty')).toBeVisible();

  // 2. 简历与 JD 都填入示例后生成话术
  await page.locator('[data-view="resume"]').click();
  await page.locator('#fillResume').click();
  await page.locator('#saveResume').click();

  await page.locator('[data-view="generate"]').click();
  await page.locator('#fillJd').click();
  await page.locator('#generate').click();
  await expect(page.locator('.msg-card')).toHaveCount(3, { timeout: 10_000 });

  // 3. 复制第一条：提示已归档，导航出现条数
  await page.locator('.msg-card .copy').first().click();
  await expect(page.locator('#toast')).toContainText('并保存到话术历史');
  await expect(page.locator('#historyBadge')).toHaveText('1');

  // 4. 历史页：一条记录、三条候选、标记复制过第 1 条
  await page.locator('[data-view="history"]').click();
  await expect(page.locator('#historyList .archive-item')).toHaveCount(1);
  await expect(page.locator('#historyItems .msg-card')).toHaveCount(3);
  await expect(page.locator('#historyMeta')).toContainText('复制过第 1 条');
  await expect(page.locator('#historyJd')).toContainText('某电商科技有限公司');

  // 5. 同一批再复制第二条：仍然只有一条记录
  await page.locator('[data-view="generate"]').click();
  await page.locator('.msg-card .copy').nth(1).click();
  await page.locator('[data-view="history"]').click();
  await expect(page.locator('#historyList .archive-item')).toHaveCount(1);
  await expect(page.locator('#historyMeta')).toContainText('复制过第 1、2 条');

  // 6. 从历史复制：只提示复制成功
  await page.locator('#historyItems .copy-h').first().click();
  await expect(page.locator('#toast')).toHaveText('已复制');

  // 7. 导出入口：没有导入过 Word 时置灰并说明原因
  await page.locator('[data-view="custom"]').click();
  await expect(page.locator('#exportDocx')).toBeDisabled();
  await expect(page.locator('#exportHint')).toContainText('只在本次会话导入过 Word 简历');

  // 8. 模拟导入 Word 简历后可用，换成 PDF 又失效
  await page.locator('.demo-help summary').click();
  await page.locator('[data-view="resume"]').click();
  // 草稿留空，导入直接生效（覆盖确认由 demo.import.spec 的桩测试与既有用例覆盖）
  await page.locator('#resumeEditor').fill('');
  await page.locator('#demoImportResume').click();
  await expect(page.locator('#resumeImportBar')).toContainText('可导出同版式 Word', {
    timeout: 5_000
  });
  await page.locator('[data-view="custom"]').click();
  await expect(page.locator('#exportDocx')).toBeEnabled();

  await page.locator('[data-view="resume"]').click();
  await page.locator('#resumeEditor').fill('');
  await page.locator('#demoImportPdf').click();
  await expect(page.locator('#resumeImportBar')).toContainText('导入', { timeout: 5_000 });
  await page.locator('[data-view="custom"]').click();
  await expect(page.locator('#exportDocx')).toBeDisabled();
});
