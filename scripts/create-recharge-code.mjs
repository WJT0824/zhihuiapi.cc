import { copyToClipboard, createRechargeCode, permanentExpiresAt } from "./recharge-code-lib.mjs";

function arg(name, fallback = "") {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

const amountCny = Number(arg("amount", "10"));
const user = arg("user", "*");
const daysArg = arg("days", "");
const permanent = !daysArg || ["permanent", "forever", "\u6c38\u4e45"].includes(daysArg.toLowerCase());
const days = permanent ? undefined : Number(daysArg);
const { code, payload } = createRechargeCode({ amountCny, user, days, permanent });

try {
  copyToClipboard(code);
  console.log("\u79ef\u5206\u8bbf\u95ee\u7801\u5df2\u590d\u5236\u5230\u526a\u8d34\u677f\uff1a");
} catch {
  console.log("\u79ef\u5206\u8bbf\u95ee\u7801\uff1a");
}
console.log(code);
console.log(
  `\u7528\u6237\uff1a${payload.user} \u91d1\u989d\uff1a\u00a5${payload.amountCny} \u79ef\u5206\uff1a${payload.points} \u6709\u6548\u671f\uff1a${
    payload.expiresAt === permanentExpiresAt ? "\u6c38\u4e45" : payload.expiresAt
  }`,
);
