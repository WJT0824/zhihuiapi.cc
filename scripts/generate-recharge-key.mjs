import crypto from "node:crypto";
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";

const target = path.join(process.cwd(), "data", "recharge-private.pem");
if (existsSync(target)) throw new Error(`私钥已存在：${target}`);
const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519", {
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
mkdirSync(path.dirname(target), { recursive: true });
writeFileSync(target, privateKey, { encoding: "utf8", mode: 0o600 });
console.log(`新私钥已保存到忽略提交的文件：${target}`);
console.log("请将下面的公钥更新到 electron/main.ts 的 RECHARGE_PUBLIC_KEY：\n" + publicKey);
