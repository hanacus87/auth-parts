import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../types";

/**
 * バケット名と IP と時間ウィンドウ番号で KV カウンタを加算し、
 * 閾値超過なら 429 `rate_limited` を返す Hono middleware を生成する。
 * Fixed window (tumbling window) 方式で、境界では最大 2 × limit のバーストを許容する。
 * KV の `expirationTtl` でキーは自動失効するため掃除ジョブ不要。
 * KV の eventual consistency により ± 数回の誤差は発生しうる設計。
 */
export function rateLimit(opts: {
  bucket: string;
  windowSec: number;
  limit: number;
}): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const ip = c.req.header("CF-Connecting-IP") ?? "anon";
    const windowNo = Math.floor(Date.now() / 1000 / opts.windowSec);
    const key = `rl:${opts.bucket}:${ip}:${windowNo}`;
    const raw = await c.env.RATE_LIMIT_KV.get(key);
    const count = raw ? parseInt(raw, 10) : 0;
    if (count >= opts.limit) {
      c.header("Retry-After", String(opts.windowSec));
      return c.json({ error: "rate_limited" }, 429);
    }
    await c.env.RATE_LIMIT_KV.put(key, String(count + 1), {
      expirationTtl: opts.windowSec,
    });
    await next();
  };
}
