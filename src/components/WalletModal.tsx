import { useMemo, useState } from "react";
import { CheckCircle2, Copy, Wallet, X } from "lucide-react";
import type { BillingLedgerEntry, RechargeRedeemResult, WalletState } from "@/types/domain";
import { pointsForAmount, rechargeAmounts } from "@/services/billingRules";
import wechatPaySrc from "@/assets/wechat-pay.png";

const ledgerLabels: Record<BillingLedgerEntry["type"], string> = {
  recharge: "充值到账",
  reserve: "运行预扣",
  commit: "扣费确认",
  refund: "失败退回",
};

function cleanErrorMessage(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/^Error invoking remote method ['"][^'"]+['"]:\s*/i, "")
    .replace(/^Error:\s*/i, "")
    .trim();
}

function looksLikeRechargeCode(value: string) {
  return value.trim().startsWith("ZHRC1.");
}

export function WalletModal({
  open,
  wallet,
  ledger,
  onClose,
  onRedeem,
}: {
  open: boolean;
  wallet?: WalletState;
  ledger: BillingLedgerEntry[];
  onClose: () => void;
  onRedeem: (code: string) => Promise<RechargeRedeemResult>;
}) {
  const [selectedAmount, setSelectedAmount] = useState<number>(10);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const selectedPoints = useMemo(() => pointsForAmount(selectedAmount), [selectedAmount]);

  if (!open) return null;

  async function redeem() {
    const trimmedCode = code.trim();
    if (!looksLikeRechargeCode(trimmedCode)) {
      setMessage("请粘贴管理员发放的积分访问码，必须以 ZHRC1. 开头。这里不能粘贴 TokenFlux 的 API 访问令牌。");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const result = await onRedeem(trimmedCode);
      setCode("");
      setMessage(`兑换成功，到账 ${result.points} 积分。`);
    } catch (error) {
      setMessage(cleanErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <section className="wallet-modal">
        <header>
          <div>
            <h2>
              <Wallet size={19} />
              钱包充值
            </h2>
            <p>当前余额：{wallet?.balance ?? 0} 积分</p>
          </div>
          <button onClick={onClose} title="关闭">
            <X size={18} />
          </button>
        </header>

        <div className="wallet-body">
          <section className="recharge-card">
            <h3>选择充值金额</h3>
            <div className="amount-grid">
              {rechargeAmounts.map((amount) => (
                <button key={amount} className={selectedAmount === amount ? "active" : ""} onClick={() => setSelectedAmount(amount)}>
                  <strong>¥{amount}</strong>
                  <span>{pointsForAmount(amount)} 积分</span>
                </button>
              ))}
            </div>
            <div className="qr-wrap">
              <img src={wechatPaySrc} alt="微信支付二维码" />
              <div>
                <strong>微信扫码支付</strong>
                <span>当前选择：¥{selectedAmount} = {selectedPoints} 积分</span>
                <span>付款后联系管理员领取以 ZHRC1. 开头的积分访问码。</span>
              </div>
            </div>
          </section>

          <section className="recharge-card">
            <h3>兑换积分访问码</h3>
            <textarea
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="此处粘贴管理员发放的积分访问码"
            />
            <div className="wallet-actions">
              <button
                onClick={async () => {
                  const text = await navigator.clipboard.readText().catch(() => "");
                  if (text) setCode(text.trim());
                }}
              >
                <Copy size={15} />
                粘贴
              </button>
              <button className="primary" disabled={busy || !code.trim()} onClick={() => void redeem()}>
                <CheckCircle2 size={15} />
                兑换
              </button>
            </div>
            {message && <p className={message.includes("成功") ? "wallet-message success" : "wallet-message"}>{message}</p>}
          </section>

          <section className="recharge-card ledger-card">
            <h3>最近流水</h3>
            <div className="ledger-list">
              {ledger.length ? (
                ledger.map((entry) => (
                  <div key={entry.id} className="ledger-row">
                    <div>
                      <strong>{ledgerLabels[entry.type]}</strong>
                      <span>{entry.note || new Date(entry.createdAt).toLocaleString()}</span>
                    </div>
                    <b className={entry.points >= 0 ? "positive" : "negative"}>{entry.points >= 0 ? `+${entry.points}` : entry.points}</b>
                  </div>
                ))
              ) : (
                <p className="empty-state">暂无积分流水</p>
              )}
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}
