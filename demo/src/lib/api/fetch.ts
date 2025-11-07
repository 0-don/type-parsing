export const customFetch = async <T>(
  url: string,
  options: RequestInit
): Promise<T> => {
  return { url, options } as unknown as T;
};
