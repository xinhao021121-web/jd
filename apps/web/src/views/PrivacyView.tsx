/**
 * 数据与隐私（PRD 4.1 / 差距诊断 G8）。
 *
 * 把「数据去哪、存在哪、给谁、怎么删」摊开说清楚，并提供一键清除。
 * 这一页不需要登录就能看，也是「你考虑过合规吗」这个问题的直接答案。
 */
import { Card, PageTitle } from '../components/ui';
import { clearSlice, getBrowserStorage } from '../store/storage';

const DATA_ROWS: { what: string; where: string; stored: string }[] = [
  {
    what: '简历与岗位 JD（文字）',
    where: '生成时发送给模型服务商（DeepSeek）用于生成内容',
    stored: '只在本机浏览器。服务端只转发，不写数据库、不写文件，日志里只有 ipHash 与耗时'
  },
  {
    what: 'JD 截图',
    where: '当次请求转发给模型服务商做文字识别',
    stored: '不落盘、不写日志；识别结果按顺序追加到 JD 输入框，可连续撤销'
  },
  {
    what: '生成的话术与改写建议',
    where: '只在浏览器里流式渲染',
    stored: '生成结果不持久化；复制过的话术进入「话术历史」（最多 20 条），同样只在本机'
  },
  {
    what: '定制简历存档',
    where: '不离开本机',
    stored: '本机浏览器；存档与原始简历互不影响'
  },
  {
    what: '使用记录（生成 / 复制 / 采纳次数）',
    where: '不上报，没有回流通道',
    stored: '本机浏览器，可在「生成打招呼」页导出成 JSON'
  }
];

export function PrivacyView(): JSX.Element {
  const clearAll = (): void => {
    const storage = getBrowserStorage();
    if (!storage) {
      window.alert('当前浏览器不允许访问本地存储，无法清除。');
      return;
    }
    const confirmed = window.confirm(
      '将清除本机的简历、JD、定制简历存档、话术历史、使用记录与授权状态，且无法恢复。确定继续？'
    );
    if (!confirmed) return;

    clearSlice(storage);
    window.location.reload();
  };

  return (
    <div>
      <PageTitle
        title="数据与隐私"
        description="这一页说明数据去哪、存在哪、怎么删——不需要登录就能看。"
      />

      <Card className="mb-4">
        <h3 className="mb-3 text-sm font-medium">数据流向</h3>
        <div className="overflow-x-auto">
          <table id="dataFlow" className="w-full text-left text-[13px]">
            <thead>
              <tr className="text-xs text-[#98a2b6]">
                <th className="py-2 pr-4 font-normal">数据</th>
                <th className="py-2 pr-4 font-normal">去哪</th>
                <th className="py-2 font-normal">存在哪</th>
              </tr>
            </thead>
            <tbody>
              {DATA_ROWS.map((row) => (
                <tr key={row.what} className="border-t border-[#eef1f7] align-top">
                  <td className="py-2 pr-4">{row.what}</td>
                  <td className="py-2 pr-4 text-[#6b7688]">{row.where}</td>
                  <td className="py-2 text-[#6b7688]">{row.stored}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="mb-4">
        <h3 className="mb-2 text-sm font-medium">模型服务商与数据用途</h3>
        <p className="text-[13px] leading-6 text-[#6b7688]">
          生成与图片识别由 DeepSeek 的接口完成。按 DeepSeek 隐私政策（2026/09 查阅原文）：
        </p>
        <ul className="mt-2 space-y-1 text-[13px] leading-6 text-[#6b7688]">
          <li>· 该政策明确适用于 API，不只适用于它的对话产品；</li>
          <li>
            · 原文：「在经安全加密技术处理和去标识化前提下，我们可能会将服务所收集的输入及对应输出，用于
            DeepSeek 模型训练和服务的优化」——也就是说，<b className="text-[#1b2333]">简历与 JD 可能被用于训练</b>；
          </li>
          <li>
            · 该政策给出的退出方式是「在产品内关闭『数据用于优化体验』」，但那是它对话产品的开关，
            API 调用没有对应入口，<b className="text-[#1b2333]">本产品无法替你关闭</b>。
          </li>
        </ul>
        <p className="mt-2 text-[13px] leading-6 text-[#6b7688]">
          所以：<b className="text-[#1b2333]">如果简历或 JD 里有你不愿意交给第三方处理的内容，请不要使用生成功能</b>。
          「我的简历」与「定制简历」的本地编辑不触发生成，可以单独使用。
        </p>
        <p className="mt-2 text-[13px] leading-6 text-[#6b7688]">
          另外，该政策要求开发者作为下游系统的个人信息处理者向终端用户披露处理规则——这一页就是这项披露。
        </p>
      </Card>

      <Card>
        <h3 className="mb-2 text-sm font-medium">清除本机数据</h3>
        <p className="mb-3 text-[13px] leading-6 text-[#6b7688]">
          清除后：简历、JD、定制简历存档、话术历史、使用记录与授权状态都会被删除，无法恢复。
          已经发给模型服务商的请求内容不在本机，无法由此处撤回。
        </p>
        <button
          id="clearLocalData"
          type="button"
          className="btn-ghost text-[#b42318]"
          onClick={clearAll}
        >
          清除本机全部数据
        </button>
      </Card>
    </div>
  );
}
