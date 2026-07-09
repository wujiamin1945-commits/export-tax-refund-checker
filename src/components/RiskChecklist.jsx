export default function RiskChecklist({ risks }) {
  return (
    <section className="result-section risk-section">
      <h3><span aria-hidden="true">!</span> 风险提示</h3>
      <ul>{risks.map((risk) => <li key={risk}>{risk}</li>)}</ul>
    </section>
  )
}
