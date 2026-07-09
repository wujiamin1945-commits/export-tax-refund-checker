import LegalBasisPanel from './LegalBasisPanel.jsx'
import RiskChecklist from './RiskChecklist.jsx'

const labels = { eligible: '可退税初判', review: '需风险复核', exempt_no_refund: '免税不退税初判', tax_risk: '征税风险', insufficient: '信息不足' }

export default function ResultCard({ result }) {
  return (
    <article id="result" className={`result-card result-card--${result.resultType}`} tabIndex="-1">
      <div className="result-summary">
        <span className="result-badge">{labels[result.resultType]}</span>
        <p>初步结论</p>
        <h2>{result.conclusion}</h2>
        {result.rateMatch && <div className="rate-chip">
          <span>{result.rateMatch.hscode}</span>
          <strong>{result.rateMatch.applicable_refund_rate ?? result.rateMatch.refund_rate}%</strong>
          <small>{result.rateMatch.applicable_refund_rate != null
            ? `初步适用退税率 · 文库 ${result.rateMatch.refund_rate}%${result.rateMatch.invoice_rate != null ? ` · 专票 ${result.rateMatch.invoice_rate}%` : ''}`
            : `${result.rateMatch.version} 文库退税率`}</small>
        </div>}
      </div>
      <section className="result-section">
        <h3><span aria-hidden="true">✓</span> 判断理由</h3>
        <ol>{result.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ol>
      </section>
      <RiskChecklist risks={result.risks} />
      <LegalBasisPanel items={result.legalBasis} />
      <section className="result-section">
        <h3><span aria-hidden="true">☷</span> 建议准备资料</h3>
        <div className="document-grid">{result.documents.map((document) => <span key={document}>{document}</span>)}</div>
      </section>
      <section className="version-bar">
        <h3>当前使用的数据版本</h3>
        <dl>
          <div><dt>规则库</dt><dd>{result.versions.rules}</dd></div>
          <div><dt>政策依据库</dt><dd>{result.versions.legalBasis}</dd></div>
          <div><dt>退税率文库</dt><dd>{result.versions.refundRates}</dd></div>
          <div><dt>两用物项参考目录</dt><dd>{result.versions.dualUseCatalog}</dd></div>
        </dl>
      </section>
    </article>
  )
}
