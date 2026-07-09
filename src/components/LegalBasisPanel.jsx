export default function LegalBasisPanel({ items }) {
  return (
    <section className="result-section">
      <h3><span aria-hidden="true">§</span> 政策依据</h3>
      {items.length ? <div className="legal-list">{items.map((item) => (
        <article key={item.id}>
          <strong>{item.document}</strong>
          <span>{item.article}</span>
          <p>{item.summary}</p>
        </article>
      ))}</div> : <p className="muted">当前命中项为数据或信息完整性校验，没有关联具体政策条款。</p>}
    </section>
  )
}
