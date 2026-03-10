export const readEnv = (key: string) => {
  const value = process.env[key]?.trim();
  return value ? value : undefined;
};

export const readEnvOrDefault = (key: string, fallback: string) => readEnv(key) ?? fallback;

export const readFirstEnv = (...keys: string[]) => {
  for (const key of keys) {
    const value = readEnv(key);
    if (value) {
      return value;
    }
  }

  return undefined;
};

export const readEnvFromKeys = (keys: string[], fallback?: string) => readFirstEnv(...keys) ?? fallback;
