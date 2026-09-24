// Framework logging must never receive database query parameters or provider exceptions.
export async function safeRead<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch {
    throw new Error('Workspace temporarily unavailable.');
  }
}
