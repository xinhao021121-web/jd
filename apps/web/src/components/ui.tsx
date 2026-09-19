import type { ReactNode } from 'react';

export function Card({
  children,
  className = '',
  testId
}: {
  children: ReactNode;
  className?: string;
  testId?: string;
}): JSX.Element {
  return (
    <section className={`card p-5 ${className}`} data-testid={testId}>
      {children}
    </section>
  );
}

export function PageTitle({
  title,
  description
}: {
  title: string;
  description: string;
}): JSX.Element {
  return (
    <header className="mb-4">
      <h2 className="text-lg font-semibold text-[#1b2333]">{title}</h2>
      <p className="mt-1 text-sm text-[#6b7688]">{description}</p>
    </header>
  );
}

export function Notice({
  tone = 'info',
  children
}: {
  tone?: 'info' | 'warn' | 'error' | 'muted';
  children: ReactNode;
}): JSX.Element {
  const tones = {
    info: 'bg-primary-soft text-[#1f52d6]',
    warn: 'bg-[#fdf3e3] text-[#b45309]',
    error: 'bg-[#fdeaea] text-[#b42318]',
    muted: 'bg-[#f6f8fc] text-[#6b7688]'
  } as const;

  return (
    <div className={`rounded-xl px-3 py-2 text-xs leading-5 ${tones[tone]}`} role="note">
      {children}
    </div>
  );
}

export function Chip({
  tone = 'muted',
  children
}: {
  tone?: 'muted' | 'ok' | 'warn';
  children: ReactNode;
}): JSX.Element {
  const tones = {
    muted: 'bg-[#f2f4f9] text-[#6b7688]',
    ok: 'bg-[#e9f8ef] text-[#15a34a]',
    warn: 'bg-[#fdf3e3] text-[#b45309]'
  } as const;

  return <span className={`chip ${tones[tone]}`}>{children}</span>;
}

export function ChipRow({
  label,
  items,
  tone = 'muted',
  emptyText = '无'
}: {
  label: string;
  items: string[];
  tone?: 'muted' | 'ok' | 'warn';
  emptyText?: string;
}): JSX.Element {
  return (
    <div className="flex gap-3 py-1">
      <span className="w-20 flex-none pt-1 text-xs text-[#98a2b6]">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {items.length ? (
          items.map((item) => (
            <Chip key={item} tone={tone}>
              {item}
            </Chip>
          ))
        ) : (
          <Chip>{emptyText}</Chip>
        )}
      </div>
    </div>
  );
}
