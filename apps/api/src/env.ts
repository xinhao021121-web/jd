/** 环境变量读取：密钥只存在于服务端（PRD 4.1） */
import { readFileSync } from 'node:fs';

export interface ApiEnv {
  apiKey: string;
  baseUrl: string;
  model: string;
  port: number;
  dailyCallAlert: number;
  dailyCallCap: number;
}

/** 解析 .env 内容：支持 # 注释、空行与成对引号 */
export function parseEnvContent(content: string): Record<string, string> {
  const parsed: Record<string, string> = {};

  content.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;

    const separator = trimmed.indexOf('=');
    if (separator <= 0) return;

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    if (quoted && value.length >= 2) value = value.slice(1, -1);

    parsed[key] = value;
  });

  return parsed;
}

/**
 * 加载 .env 到进程环境，返回实际生效的键名。
 * 已经存在的环境变量优先，避免覆盖部署平台或端到端测试注入的值。
 */
export function loadEnvFile(
  filePath: string,
  target: NodeJS.ProcessEnv = process.env
): string[] {
  let content: string;
  try {
    content = readFileSync(filePath, 'utf8');
  } catch {
    return [];
  }

  const applied: string[] = [];
  const parsed = parseEnvContent(content);
  Object.entries(parsed).forEach(([key, value]) => {
    if (target[key] !== undefined) return;
    target[key] = value;
    applied.push(key);
  });
  return applied;
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
    port: Number(env.PORT ?? 8787),
    dailyCallAlert: Number(env.DAILY_CALL_ALERT ?? 500),
    dailyCallCap: Number(env.DAILY_CALL_CAP ?? 1500)
  };
}
