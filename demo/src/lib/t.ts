export const t = (translation: string, params?: Record<string, any>) =>
  translation + JSON.stringify(params);
