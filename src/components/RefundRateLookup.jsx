import { lookupRefundRate, refundRateMetadata } from '../engine/refundRateLookup.js'

export default function RefundRateLookup({ hscode, exportDate, selectedRateCode, onSelectRateCode }) {
  if (!hscode) return <p className="field-hint">已导入官方出口退税率文库 {refundRateMetadata.version} 版</p>
  if (!/^\d{10}$/.test(hscode)) return <p className="lookup lookup--warning">HSCode 应为 10 位数字</p>
  const unresolvedMatch = lookupRefundRate(hscode, exportDate)
  const match = selectedRateCode ? lookupRefundRate(hscode, exportDate, selectedRateCode) : unresolvedMatch
  if (!match) return <p className="lookup lookup--warning">当前文库在所选日期未匹配，请核对 HSCode 和预计出口日期</p>
  if (unresolvedMatch?.ambiguous) return (
    <>
      <p className="lookup lookup--warning">该10位HSCode对应多个具体商品代码，退税率或政策属性不同，不能直接采用父级税率。</p>
      <label className="field" htmlFor="rateCandidateCode">
        <span>请选择与实际商品名称相符的文库商品<em> 必填</em></span>
        <select id="rateCandidateCode" value={selectedRateCode} onChange={(event) => onSelectRateCode(event.target.value)}>
          <option value="">请选择具体商品</option>
          {unresolvedMatch.candidates.map((candidate) => (
            <option key={`${candidate.code}-${candidate.refund_rate}-${candidate.special_flag ?? ''}`} value={candidate.code}>
              {candidate.code} · {candidate.goods_name} · 退税率 {candidate.refund_rate}%
            </option>
          ))}
        </select>
        <small>请根据商品实际名称选择；不能确认时，应先核实商品归类或税收商品扩展码。</small>
      </label>
      {selectedRateCode && !match.ambiguous && <div className="lookup lookup--matched">
        <strong>{match.goods_name}</strong>
        <span>退税率：{match.refund_rate}%</span>
        {match.special_policy && <span>特殊商品标识：{match.special_policy.label}</span>}
      </div>}
    </>
  )
  return (
    <div className="lookup lookup--matched">
      <strong>{match.goods_name}</strong>
      <span>退税率：{match.refund_rate}%</span>
      {match.special_policy && <span>特殊商品标识：{match.special_policy.label}</span>}
      <small>{match.version} 版 · 匹配日期 {match.query_date} · 有效期 {match.effective_from} 至 {match.effective_to}</small>
    </div>
  )
}
