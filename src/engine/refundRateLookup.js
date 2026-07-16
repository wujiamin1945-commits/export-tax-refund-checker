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
  const specialPolicy = rate.special_flag === '1'
    ? { category: 'taxable', label: '禁止出口或出口不退税' }
    : rate.special_flag === '2'
      ? { category: 'exempt', label: '免税' }
      : null
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
    special_policy: specialPolicy,
    matched_by: matchedBy,
    version: refundRateLibrary.metadata.version,
    source: refundRateLibrary.metadata.source,
    risk_note: `已按${date}匹配官方出口退税率文库${refundRateLibrary.metadata.version}版；实际申报仍建议与最新文库及主管税务机关复核。`,
  }
}

function newestActive(records, date) {
  return records.filter((rate) => activeOn(rate, date))
    .sort((a, b) => (b.effective_from || '').localeCompare(a.effective_from || ''))[0]
}

function ambiguityResult(hscode, records, date) {
  const candidates = records
    .sort((a, b) => a.code.localeCompare(b.code) || (b.effective_from || '').localeCompare(a.effective_from || ''))
    .filter((rate, index, items) => index === items.findIndex((item) => item.code === rate.code
      && item.refund_rate === rate.refund_rate && item.special_flag === rate.special_flag))
    .map((rate) => ({
      code: rate.code,
      goods_name: commoditiesByCode.get(rate.code)?.goods_name || rate.goods_name,
      refund_rate: rate.refund_rate,
      special_flag: rate.special_flag,
    }))
  return {
    hscode,
    query_date: date,
    ambiguous: true,
    matched_by: 'specific_codes_different_policy',
    candidates,
    candidate_rates: [...new Set(candidates.map((item) => item.refund_rate))],
    version: refundRateLibrary.metadata.version,
    source: refundRateLibrary.metadata.source,
    risk_note: '该10位HSCode在文库中对应多个适用政策不同的具体商品代码，必须按实际商品名称选择后才能判断。',
  }
}

export function lookupRefundRate(hscode, exportDate = '', selectedRateCode = '') {
  const code = String(hscode ?? '').trim()
  if (!/^\d{10}$/.test(code)) return null
  const date = exportDate || localDateText()

  const exact = (ratesByCode.get(code) ?? []).filter((rate) => activeOn(rate, date))
  const descendants = (descendantsByTenDigitCode.get(code) ?? []).filter((rate) => activeOn(rate, date))
  const specificRecords = [...exact, ...descendants]

  if (selectedRateCode) {
    const selected = newestActive(specificRecords.filter((rate) => rate.code === selectedRateCode), date)
    if (selected) return normalizeMatch(code, selected, date, 'selected_specific_code')
  }

  if (specificRecords.length) {
    const policies = new Set(specificRecords.map((rate) => `${rate.refund_rate}|${rate.special_flag ?? ''}`))
    if (policies.size > 1) return ambiguityResult(code, specificRecords, date)
    const exactMatch = newestActive(exact, date)
    if (exactMatch) return normalizeMatch(code, exactMatch, date, 'exact')
    const newest = newestActive(descendants, date)
    return normalizeMatch(code, { ...newest, code }, date, 'descendants_same_policy')
  }

  for (let length = code.length - 1; length >= 1; length -= 1) {
    const active = newestActive(ratesByCode.get(code.slice(0, length)) ?? [], date)
    if (active) return normalizeMatch(code, active, date)
  }
  return null
}

export const refundRateMetadata = refundRateLibrary.metadata
