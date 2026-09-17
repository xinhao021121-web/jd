/** 字数按 Unicode 码点统计，与 PRD 的「字」口径一致 */
export function countChars(text: string): number {
  return [...(text ?? '').trim()].length;
}

export function formatTime(timestamp: number): string {
  if (!timestamp) return '—';
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}
