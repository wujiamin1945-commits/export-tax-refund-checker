import refundRateLibrary from '../data/refund_rates_2026B.json'

const ratesByCode = new Map()
const descendantsByTenDigitCode = new Map()
const commoditiesByCode = new Map(refundRateLibrary.commodities.map((item) => [item.code, item]))

for (const rate of refundRateLibrary.rates) {
  const records = ratesByCode.get(rate.code) ?? []
  records.push(rate)
  ratesByCode.set(rate.code, records)
  if (rate.code.length > 10) {
    const prefix = rate.code.slice(0, 10)
    const descendants = descendantsByTenDigitCode.get(prefix) ?? []
    descendants.push(rate)
    descendantsByTenDigitCode.set(prefix, descendants)
  }
}

function localDateText() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function activeOn(rate, date) {
  return (!rate.effective_from || rate.effective_from <= date)
    && (!rate.effective_to || rate.effective_to >= date)
}

function normalizeMatch(hscode, rate, date, matchedBy = 'prefix') {
  const commodity = commoditiesByCode.get(hscode) ?? commoditiesByCode.get(rate.code)
  return {
    hscode,
    rate_code: rate.code,
    goods_name: commodity?.goods_name || rate.goods_name,
    unit: commodity?.unit || rate.unit,
    refund_rate: rate.refund_rate,
    tax_rates: rate.tax_rates,
    effective_from: rate.effective_from,
    effective_to: rate.effective_to,
    query_date: date,
    special_flag: rate.special_flag,
    matched_by: matchedBy,
    version: refundRateLibrary.metadata.version,
    source: refundRateLibrary.metadata.source,
    risk_note: `已按${date}匹配官方出口退税率文库${refundRateLibrary.metadata.version}版；实际申报仍建议与最新文库及主管税务机关复核。`,
  }
}

export function lookupRefundRate(hscode, exportDate = '') {
  const code = String(hscode ?? '').trim()
  if (!/^\d{10}$/.test(code)) return null
  const date = exportDate || localDateText()

  for (let length = code.length; length >= 1; length -= 1) {
    const records = ratesByCode.get(code.slice(0, length))
    const active = records?.filter((rate) => activeOn(rate, date))
      .sort((a, b) => (b.effective_from || '').localeCompare(a.effective_from || ''))
    if (active?.length) return normalizeMatch(code, active[0], date)
  }

  const descendants = (descendantsByTenDigitCode.get(code) ?? []).filter((rate) => activeOn(rate, date))
  const rates = [...new Set(descendants.map((rate) => rate.refund_rate))]
  if (descendants.length && rates.length === 1) {
    const newest = descendants.sort((a, b) => (b.effective_from || '').localeCompare(a.effective_from || ''))[0]
    return normalizeMatch(code, { ...newest, code }, date, 'descendants_same_rate')
  }
  return null
}

export const refundRateMetadata = refundRateLibrary.metadata
