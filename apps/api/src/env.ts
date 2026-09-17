/** 环境变量读取：密钥只存在于服务端（PRD 4.1） */
export interface ApiEnv {
  apiKey: string;
  baseUrl: string;
  model: string;
  port: number;
}

export function readEnv(env: NodeJS.ProcessEnv = process.env): ApiEnv {
  const apiKey = (env.DEEPSEEK_API_KEY ?? '').trim();
  if (!apiKey) {
    throw new Error(
      '缺少环境变量 DEEPSEEK_API_KEY：密钥只保存在服务端，请参考 .env.example 配置后重启'
    );
  }
  return {
    apiKey,
    baseUrl: (env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1').trim(),
    model: (env.DEEPSEEK_MODEL ?? 'deepseek-chat').trim(),
    port: Number(env.PORT ?? 8787)
  };
}
