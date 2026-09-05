import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { allowedAmounts, copyToClipboard, createRechargeCode, permanentExpiresAt } from "./recharge-code-lib.mjs";

const rl = readline.createInterface({ input, output });

async function ask(prompt, fallback) {
  const answer = (await rl.question(fallback ? `${prompt}\uff08\u9ed8\u8ba4 ${fallback}\uff09\uff1a` : `${prompt}\uff1a`)).trim();
  return answer || fallback;
}

async function main() {
  console.clear();
  console.log("========================================");
  console.log(" \u90c5\u7ed8ai\u753b\u5e03 - \u79ef\u5206\u7801\u751f\u6210\u5668");
  console.log("========================================");
  console.log("\u91d1\u989d\u6863\u4f4d\uff1a10 / 20 / 30 / 50 / 100 / 200");
  console.log("\u7528\u6237\u6635\u79f0\u5fc5\u987b\u548c\u8f6f\u4ef6\u767b\u5f55\u6635\u79f0\u4e00\u81f4\uff1b\u8f93\u5165 * \u53ef\u751f\u6210\u901a\u7528\u7801\u3002");
  console.log("\u6709\u6548\u671f\u9ed8\u8ba4\u6c38\u4e45\uff1b\u8f93\u5165\u5929\u6570\u53ef\u751f\u6210\u9650\u65f6\u7801\u3002");
  console.log("");

  const user = await ask("\u8bf7\u8f93\u5165\u7528\u6237\u6635\u79f0", "*");
  const amountInput = await ask("\u8bf7\u8f93\u5165\u5145\u503c\u91d1\u989d", "10");
  const daysInput = await ask("\u8bf7\u8f93\u5165\u6709\u6548\u5929\u6570\uff0c\u76f4\u63a5\u56de\u8f66\u4e3a\u6c38\u4e45", "\u6c38\u4e45");
  const amountCny = Number(amountInput);
  const permanent = daysInput === "\u6c38\u4e45" || daysInput === "*" || daysInput.toLowerCase() === "permanent";
  const days = permanent ? undefined : Number(daysInput);

  if (!allowedAmounts.includes(amountCny)) {
    throw new Error("\u5145\u503c\u91d1\u989d\u4e0d\u6b63\u786e\uff0c\u53ea\u80fd\u8f93\u5165 10\u300120\u300130\u300150\u3001100\u3001200\u3002");
  }

  const { code, payload } = createRechargeCode({ amountCny, user, days, permanent });
  let copied = false;
  try {
    copyToClipboard(code);
    copied = true;
  } catch {
    copied = false;
  }

  console.log("");
  console.log("\u751f\u6210\u6210\u529f");
  console.log("----------------------------------------");
  console.log(`\u7528\u6237\uff1a${payload.user}`);
  console.log(`\u91d1\u989d\uff1a\u00a5${payload.amountCny}`);
  console.log(`\u79ef\u5206\uff1a${payload.points}`);
  console.log(`\u6709\u6548\u671f\uff1a${payload.expiresAt === permanentExpiresAt ? "\u6c38\u4e45" : payload.expiresAt}`);
  console.log("----------------------------------------");
  console.log(code);
  console.log("----------------------------------------");
  console.log(copied ? "\u5df2\u81ea\u52a8\u590d\u5236\u5230\u526a\u8d34\u677f\uff0c\u53ef\u4ee5\u76f4\u63a5\u53d1\u7ed9\u7528\u6237\u3002" : "\u81ea\u52a8\u590d\u5236\u5931\u8d25\uff0c\u8bf7\u624b\u52a8\u590d\u5236\u4e0a\u9762\u7684\u79ef\u5206\u7801\u3002");
  console.log("");
}

main()
  .catch((error) => {
    console.error("");
    console.error(error instanceof Error ? error.message : String(error));
    console.error("");
  })
  .finally(async () => {
    await rl.question("\u6309\u56de\u8f66\u952e\u9000\u51fa...");
    rl.close();
  });
