import { lookupRefundRate, refundRateMetadata } from '../engine/refundRateLookup.js'

export default function RefundRateLookup({ hscode, exportDate }) {
  if (!hscode) return <p className="field-hint">已导入官方出口退税率文库 {refundRateMetadata.version} 版</p>
  if (!/^\d{10}$/.test(hscode)) return <p className="lookup lookup--warning">HSCode 应为 10 位数字</p>
  const match = lookupRefundRate(hscode, exportDate)
  if (!match) return <p className="lookup lookup--warning">当前文库在所选日期未匹配，请核对 HSCode 和预计出口日期</p>
  return (
    <div className="lookup lookup--matched">
      <strong>{match.goods_name}</strong>
      <span>退税率：{match.refund_rate}%</span>
      <small>{match.version} 版 · 匹配日期 {match.query_date} · 有效期 {match.effective_from} 至 {match.effective_to}</small>
    </div>
  )
}
