import { DATA_FLOW_NOTICE } from '@zhipin/shared';
import { Sidebar } from './components/Sidebar';
import { Toast } from './components/Toast';
import { useAppStore } from './store/store';
import { ArchiveView } from './views/ArchiveView';
import { CustomizeView } from './views/CustomizeView';
import { GenerateView } from './views/GenerateView';
import { ResumeView } from './views/ResumeView';

export default function App(): JSX.Element {
  const view = useAppStore((state) => state.view);

  return (
    <div className="flex min-h-screen items-stretch">
      <Sidebar />

      <main className="min-w-0 flex-1 px-6 py-6 lg:px-8">
        <div className="mx-auto max-w-5xl">
          {view === 'resume' && <ResumeView />}
          {view === 'generate' && <GenerateView />}
          {view === 'custom' && <CustomizeView />}
          {view === 'archive' && <ArchiveView />}

          {view !== 'archive' && (
            <p className="mt-6 text-center text-xs text-[#98a2b6]">{DATA_FLOW_NOTICE}</p>
          )}
        </div>
      </main>

      <Toast />
    </div>
  );
}
