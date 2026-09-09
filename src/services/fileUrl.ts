export function toFileUrl(filePath?: string) {
  if (!filePath) return "";
  const normalized = filePath.replace(/\\/g, "/");
  if (/^(https?:|data:|blob:|file:)/i.test(normalized)) return normalized;
  return normalized.startsWith("/") ? `file://${normalized}` : `file:///${normalized}`;
}
