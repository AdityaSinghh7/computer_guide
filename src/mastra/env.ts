export const readEnv = (key: string) => {
  const value = process.env[key]?.trim();
  return value ? value : undefined;
};

export const readEnvOrDefault = (key: string, fallback: string) => readEnv(key) ?? fallback;
