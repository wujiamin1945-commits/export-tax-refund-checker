export default function RiskChecklist({ risks, title = '税务提示' }) {
  if (!risks?.length) return null
  return (
    <section className="result-section risk-section">
      <h3><span aria-hidden="true">!</span> {title}</h3>
      <ul>{risks.map((risk) => <li key={risk}>{risk}</li>)}</ul>
    </section>
  )
}
