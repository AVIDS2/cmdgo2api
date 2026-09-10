export function cn(...values) {
  return values.filter(Boolean).join(' ');
}

export function formatMoney(value) {
  const amount = Number(value);
  return `$${Number.isFinite(amount) ? amount.toFixed(2) : '0.00'}`;
}

export function formatDate(value) {
  if (!value) return '未知';
  const numeric = typeof value === 'number' || (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value.trim()))
    ? Number(value)
    : null;
  const date = new Date(numeric === null ? value : numeric > 10_000_000_000 ? numeric : numeric * 1000);
  if (Number.isNaN(date.getTime())) return '未知';
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatFetchedAt(value) {
  if (!value) return '尚未同步';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '尚未同步';
  return `更新于 ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
}
