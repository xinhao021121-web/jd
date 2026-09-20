import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { loadEnvFile, parseEnvContent, readEnv } from '../apps/api/src/env';

describe('parseEnvContent', () => {
  it('解析键值、忽略注释与空行、去掉成对引号', () => {
    const parsed = parseEnvContent(
      ['# 注释', '', 'DEEPSEEK_API_KEY=sk-abc', 'MODEL="deepseek-chat"', "X='quoted value'"].join(
        '\n'
      )
    );

    expect(parsed).toEqual({
      DEEPSEEK_API_KEY: 'sk-abc',
      MODEL: 'deepseek-chat',
      X: 'quoted value'
    });
  });

  it('忽略没有等号或键名为空的行', () => {
    expect(parseEnvContent(['没有等号', '=值', 'KEY=value'].join('\n'))).toEqual({ KEY: 'value' });
  });
});

describe('loadEnvFile', () => {
  it('文件不存在时静默返回空数组', () => {
    expect(loadEnvFile('D:/不存在的目录/.env', {})).toEqual([]);
  });

  it('只补齐缺失的变量，不覆盖已有环境变量', () => {
    const target: NodeJS.ProcessEnv = { DEEPSEEK_API_KEY: 'sk-from-platform' };
    const samplesPath = fileURLToPath(new URL('./samples/env-fixture.env', import.meta.url));

    const applied = loadEnvFile(samplesPath, target);

    expect(applied).toEqual(['DEEPSEEK_MODEL', 'PORT']);
    expect(target.DEEPSEEK_API_KEY).toBe('sk-from-platform');
    expect(target.DEEPSEEK_MODEL).toBe('deepseek-chat');
    expect(target.PORT).toBe('8787');
  });
});

describe('readEnv', () => {
  it('缺少密钥时直接报错并给出配置提示，不返回半成品配置', () => {
    expect(() => readEnv({})).toThrowError(/DEEPSEEK_API_KEY/);
  });

  it('默认值：官方端点、deepseek-chat、8787 端口与用量阈值', () => {
    expect(readEnv({ DEEPSEEK_API_KEY: 'sk-abc' })).toEqual({
      apiKey: 'sk-abc',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      visionModel: 'deepseek-flash',
      port: 8787,
      dailyCallAlert: 500,
      dailyCallCap: 1500
    });
  });

  it('可用环境变量覆盖端点、模型与用量阈值', () => {
    expect(
      readEnv({
        DEEPSEEK_API_KEY: ' sk-abc ',
        DEEPSEEK_BASE_URL: 'http://127.0.0.1:8788/v1',
        DEEPSEEK_MODEL: 'mock-chat',
        DEEPSEEK_VISION_MODEL: 'mock-vision',
        PORT: '9000',
        DAILY_CALL_ALERT: '10',
        DAILY_CALL_CAP: '20'
      })
    ).toEqual({
      apiKey: 'sk-abc',
      baseUrl: 'http://127.0.0.1:8788/v1',
      model: 'mock-chat',
      visionModel: 'mock-vision',
      port: 9000,
      dailyCallAlert: 10,
      dailyCallCap: 20
    });
  });
});
