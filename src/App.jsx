import { useState } from 'react'
import InputForm, { createEmptyForm } from './components/InputForm.jsx'
import ResultCard from './components/ResultCard.jsx'
import { evaluateRefund } from './engine/evaluateRefund.js'

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
      <footer>退税率数据来自官方 2026B 版文库；规则判断仍为 MVP，政策或文库更新后应先更新数据再使用。</footer>
    </div>
  )
}
