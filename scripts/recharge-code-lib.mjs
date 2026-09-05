import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

function loadPrivateKey() {
  const inline = process.env.ZH_RECHARGE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (inline) return inline;
  const keyPath = process.env.ZH_RECHARGE_PRIVATE_KEY_FILE || path.join(process.cwd(), "data", "recharge-private.pem");
  try { return readFileSync(keyPath, "utf8"); }
  catch { throw new Error(`未找到积分码签名私钥。请设置 ZH_RECHARGE_PRIVATE_KEY_FILE，或运行 npm run recharge:keygen。`); }
}

export const allowedAmounts = [10, 20, 30, 50, 100, 200];
export const permanentExpiresAt = "9999-12-31T23:59:59.999Z";

export function normalizeUser(user) {
  return String(user || "").trim().replace(/\s+/g, "").toLowerCase();
}

function base64url(buffer) {
  return Buffer.from(buffer).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function createRechargeCode({ amountCny, user, days, permanent = true }) {
  const amount = Number(amountCny);
  const normalizedUser = normalizeUser(user || "*");
  if (!allowedAmounts.includes(amount)) {
    throw new Error("\u5145\u503c\u91d1\u989d\u53ea\u652f\u6301 10\u300120\u300130\u300150\u3001100\u3001200\u3002");
  }
  if (!normalizedUser) {
    throw new Error("\u8bf7\u586b\u5199\u7528\u6237\u6635\u79f0\uff0c\u6216\u8f93\u5165 * \u751f\u6210\u901a\u7528\u7801\u3002");
  }

  const now = new Date();
  const validityDays = Math.max(1, Number(days) || 30);
  const expiresAt = permanent
    ? permanentExpiresAt
    : new Date(now.getTime() + validityDays * 24 * 60 * 60 * 1000).toISOString();
  const payload = {
    v: 1,
    app: "zhihui-ai-canvas",
    user: normalizedUser,
    amountCny: amount,
    points: amount * 10,
    nonce: crypto.randomUUID(),
    issuedAt: now.toISOString(),
    expiresAt,
  };
  const payloadBuffer = Buffer.from(JSON.stringify(payload), "utf8");
  const signature = crypto.sign(null, payloadBuffer, loadPrivateKey());
  return {
    code: `ZHRC1.${base64url(payloadBuffer)}.${base64url(signature)}`,
    payload,
  };
}

export function copyToClipboard(text) {
  execFileSync("clip", { input: text });
}
