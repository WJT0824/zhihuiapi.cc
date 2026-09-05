export function toFileUrl(filePath?: string) {
  if (!filePath) return "";
  const normalized = filePath.replace(/\\/g, "/");
  return normalized.startsWith("/") ? `file://${normalized}` : `file:///${normalized}`;
}
