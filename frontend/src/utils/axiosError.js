/**
 * Readable message from failed axios calls (JSON or JSON-in-blob).
 */
export async function getAxiosErrorMessage(err, fallback) {
  const data = err.response?.data;
  if (data instanceof Blob) {
    try {
      const text = await data.text();
      const parsed = JSON.parse(text);
      if (parsed?.message) return parsed.message;
    } catch {
      /* ignore */
    }
    return fallback;
  }
  if (data && typeof data === 'object' && data.message) {
    return data.message;
  }
  return fallback;
}
