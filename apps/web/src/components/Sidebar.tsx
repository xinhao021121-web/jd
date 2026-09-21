import { useAppStore, type ViewName } from '../store/store';

const NAV_ITEMS: { view: ViewName; label: string; icon: string }[] = [
  { view: 'resume', label: '我的简历', icon: '📄' },
  { view: 'custom', label: '按 JD 改简历', icon: '🛠' },
  { view: 'archive', label: '定制简历', icon: '🗂' },
  { view: 'generate', label: '生成打招呼', icon: '💬' },
  { view: 'history', label: '话术历史', icon: '🕘' },
  { view: 'privacy', label: '数据与隐私', icon: '🔒' }
];

/** 后续规划分组：本版本占位，避免主流程加入未验证的入口（PRD 2.4） */
const PLANNED_ITEMS = ['设置'];

export function Sidebar(): JSX.Element {
  const view = useAppStore((state) => state.view);
  const collapsed = useAppStore((state) => state.sidebarCollapsed);
  const setView = useAppStore((state) => state.setView);
  const setCollapsed = useAppStore((state) => state.setSidebarCollapsed);
  const archiveCount = useAppStore((state) => state.archive.length);
  const historyCount = useAppStore((state) => state.greetingHistory.length);
  const hasResume = useAppStore((state) => state.resume.length > 0);

  return (
    <aside
      id="sidebar"
      data-collapsed={collapsed}
      className={`sticky top-0 flex h-screen flex-none flex-col border-r border-[#e5e9f2] bg-white transition-all duration-200 ${
        collapsed ? 'w-[72px]' : 'w-[236px]'
      }`}
    >
      <div className="flex items-center gap-3 px-4 py-5">
        <div className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-gradient-to-br from-primary to-[#7b5cff] text-[17px] font-bold text-white shadow-[0_6px_16px_rgba(47,107,255,.28)]">
          直
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <h1 className="truncate text-[15px] font-semibold">直聘打招呼助手</h1>
            <p className="mt-0.5 truncate text-[11.5px] text-[#98a2b6]">简历长期资产 · 按 JD 定制</p>
          </div>
        )}
      </div>

      <nav id="nav" className="flex flex-1 flex-col gap-1 px-3">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.view}
            type="button"
            data-view={item.view}
            title={collapsed ? item.label : undefined}
            onClick={() => setView(item.view)}
            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13.5px] transition ${
              view === item.view
                ? 'bg-primary-soft font-medium text-primary'
                : 'text-[#6b7688] hover:bg-[#f3f6fd] hover:text-[#1b2333]'
            }`}
          >
            <span className="w-5 flex-none text-center text-sm">{item.icon}</span>
            {!collapsed && (
              <span className="flex-1 truncate">
                {item.label}
                {item.view === 'resume' && hasResume && (
                  <span className="ml-1 text-[11px] text-[#15a34a]">已保存</span>
                )}
                {item.view === 'archive' && archiveCount > 0 && (
                  <span className="ml-1 text-[11px] text-[#98a2b6]">{archiveCount}</span>
                )}
                {item.view === 'history' && historyCount > 0 && (
                  <span className="ml-1 text-[11px] text-[#98a2b6]">{historyCount}</span>
                )}
              </span>
            )}
          </button>
        ))}

        <div className="my-3 h-px bg-[#e5e9f2]" />
        {!collapsed && <p className="px-1 pb-1 text-[11.5px] text-[#98a2b6]">后续规划</p>}
        {PLANNED_ITEMS.map((label) => (
          <button
            key={label}
            type="button"
            disabled
            title={collapsed ? label : '后续版本开放'}
            className="flex cursor-default items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13.5px] text-[#c3cbd9]"
          >
            <span className="w-5 flex-none text-center text-sm">·</span>
            {!collapsed && <span className="truncate">{label}</span>}
          </button>
        ))}
      </nav>

      <div className="border-t border-[#e5e9f2] p-3">
        <button
          id="collapseBtn"
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          title={collapsed ? '展开侧边栏' : '收起侧边栏'}
          aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-[13px] text-[#6b7688] transition hover:bg-[#f3f6fd] hover:text-[#1b2333]"
        >
          <span id="collapseIco" className="w-5 flex-none text-center">
            {collapsed ? '»' : '«'}
          </span>
          {!collapsed && <span>收起侧边栏</span>}
        </button>
      </div>
    </aside>
  );
}
