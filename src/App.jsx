import { useState } from 'react'
import InputForm, { createEmptyForm } from './components/InputForm.jsx'
import ResultCard from './components/ResultCard.jsx'
import { evaluateRefund } from './engine/evaluateRefund.js'

const contactEmail = 'exporttaxrefund@163.com'
const contactMailto = `mailto:${contactEmail}?subject=${encodeURIComponent('出口退税判断咨询')}&body=${encodeURIComponent('您好，我想咨询出口退税初步判断问题。\n\nHSCode：\n问题描述：\n\n请勿在邮件中发送未经脱敏的发票、报关单、身份证件等敏感资料。')}`

export default function App() {
  const [formData, setFormData] = useState(createEmptyForm)
  const [result, setResult] = useState(null)

  const handleSubmit = (event) => {
    event.preventDefault()
    setResult(evaluateRefund(formData))
    window.setTimeout(() => document.getElementById('result')?.focus(), 0)
  }

  const handleReset = () => {
    setFormData(createEmptyForm())
    setResult(null)
  }

  return (
    <div className="app-shell">
      <header className="hero">
        <div className="hero__eyebrow">内部辅助工具 · 官方 2026B 退税率文库</div>
        <h1>贸易企业出口退税规则判断助手</h1>
        <p>本工具仅用于内部初步判断，不构成正式税务意见。实际业务请以主管税务机关、最新出口退税率文库及正式政策文件为准。</p>
      </header>

      <main className="workspace">
        <InputForm
          formData={formData}
          onChange={setFormData}
          onSubmit={handleSubmit}
          onReset={handleReset}
        />
        <section className="result-column" aria-live="polite">
          {result ? <ResultCard result={result} /> : (
            <div className="empty-result">
              <div className="empty-result__icon" aria-hidden="true">§</div>
              <h2>等待判断</h2>
              <p>请填写左侧业务信息并点击“开始判断”。系统将根据官方 2026B 退税率文库和当前规则库输出初步结论与复核建议。</p>
            </div>
          )}
        </section>
      </main>
      <section className="contact-strip" aria-labelledby="contact-heading">
        <div>
          <span className="contact-strip__label">邮件咨询</span>
          <h2 id="contact-heading">对判断结果有疑问？</h2>
          <p>可通过邮件咨询。请勿发送未经脱敏的发票、报关单、身份证件等敏感资料。</p>
        </div>
        <a className="contact-strip__action" href={contactMailto}>
          <span>发送邮件</span>
          <strong>{contactEmail}</strong>
        </a>
      </section>
      <footer>
        本工具仅用于出口退税初步判断，不构成正式税务意见，实际业务以最新政策、退税率文库和主管税务机关口径为准。
      </footer>
    </div>
  )
}
