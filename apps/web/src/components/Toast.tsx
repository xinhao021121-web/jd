import { useEffect } from 'react';
import { create } from 'zustand';

interface ToastState {
  message: string;
  visible: boolean;
  show: (message: string) => void;
  hide: () => void;
}

const useToastStore = create<ToastState>((set) => ({
  message: '',
  visible: false,
  show: (message) => set({ message, visible: true }),
  hide: () => set({ visible: false })
}));

export function toast(message: string): void {
  useToastStore.getState().show(message);
}

export function Toast(): JSX.Element | null {
  const { message, visible, hide } = useToastStore();

  useEffect(() => {
    if (!visible) return undefined;
    const timer = setTimeout(hide, 1800);
    return () => clearTimeout(timer);
  }, [visible, message, hide]);

  if (!visible) return null;

  return (
    <div
      role="status"
      className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-[#1b2333] px-4 py-2 text-sm text-white shadow-card"
    >
      {message}
    </div>
  );
}
