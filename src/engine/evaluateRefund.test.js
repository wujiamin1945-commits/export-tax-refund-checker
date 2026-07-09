import { describe, expect, it } from 'vitest'
import { evaluateRefund } from './evaluateRefund.js'
import { lookupRefundRate, refundRateMetadata } from './refundRateLookup.js'
import { dualUseCatalogMetadata, lookupDualUseHscode } from './dualUseLookup.js'

const valid = (overrides = {}) => ({
  hscode: '8479899990', exportDate: '2026-07-07', enterpriseType: 'foreign_trade', soldOverseas: 'yes', customsExported: 'yes', saleRecognized: 'yes', collectionStatus: 'yes',
  purchaseDocumentType: 'vat_invoice', invoiceRate: '13', usedEquipment: 'no', usedBy: '', usedEquipmentOtherDocsComplete: '', depreciatedFixedAsset: '',
  originallyImported: 'no', importTradeMode: '', underCustomsSupervision: '', ...overrides,
})

describe('evaluateRefund', () => {
  it('rejects an invalid HSCode', () => expect(evaluateRefund(valid({ hscode: '123' })).resultType).toBe('insufficient'))
  it('reports an unmatched HSCode', () => expect(evaluateRefund(valid({ hscode: '1234567890' })).reasons[0]).toContain('未在当前官方退税率文库'))
  it('requires policy classification for a zero refund rate before other checks', () => {
    const output = evaluateRefund({ hscode: '8541430000', exportDate: '2026-07-07' })
    expect(output.resultType).toBe('insufficient')
    expect(output.conclusion).toContain('需判断政策属性')
  })
  it('uses the export date to match a historical 2026 rate', () => {
    expect(lookupRefundRate('8541430000', '2026-03-31').refund_rate).toBe(9)
    expect(lookupRefundRate('8541430000', '2026-04-01').refund_rate).toBe(0)
  })
  it('matches 8504319000 through its official basic commodity code', () => {
    const match = lookupRefundRate('8504319000', '2026-07-07')
    expect(match.rate_code).toBe('85043190')
    expect(match.refund_rate).toBe(13)
    expect(match.goods_name).toContain('其他变压器')
  })
  it('uses the official 2026B library metadata', () => {
    expect(refundRateMetadata.version).toBe('2026B')
    expect(refundRateMetadata.rate_record_count).toBeGreaterThan(11000)
  })
  it('uses the official 2026 dual-use reference HSCode catalog for screening', () => {
    expect(dualUseCatalogMetadata.code_count).toBe(636)
    expect(lookupDualUseHscode('8504401940').matched).toBe(true)
    expect(lookupDualUseHscode('8504319000').matched).toBe(false)
  })
  it('requires missing decision fields', () => expect(evaluateRefund({ hscode: '8479899990' }).resultType).toBe('insufficient'))
  it('requires a purchase document type', () => {
    const output = evaluateRefund(valid({ purchaseDocumentType: '' }))
    expect(output.resultType).toBe('insufficient')
    expect(output.reasons[0]).toContain('1 项必要判断信息未选择')
  })
  it('requires an invoice rate when a VAT special invoice is selected', () => {
    const output = evaluateRefund(valid({ invoiceRate: '' }))
    expect(output.resultType).toBe('insufficient')
  })
  it('applies the lower of a 3% invoice rate and the library refund rate', () => {
    const output = evaluateRefund(valid({ invoiceRate: '3' }))
    expect(output.rateMatch.refund_rate).toBe(13)
    expect(output.rateMatch.applicable_refund_rate).toBe(3)
    expect(output.legalBasis.some((item) => item.id === 'VAT_EXPORT_2026_11_ARTICLE_3_2_1')).toBe(true)
  })
  it('supports a 1% invoice rate and sends other rates to review', () => {
    expect(evaluateRefund(valid({ invoiceRate: '1' })).rateMatch.applicable_refund_rate).toBe(1)
    const output = evaluateRefund(valid({ invoiceRate: 'other' }))
    expect(output.resultType).toBe('review')
    expect(output.risks.join('')).toContain('无法自动按孰低原则')
  })
  it('rejects a failed basic condition', () => expect(evaluateRefund(valid({ soldOverseas: 'no' })).resultType).toBe('tax_risk'))
  it('sends a production enterprise to review', () => expect(evaluateRefund(valid({ enterpriseType: 'production' })).reasons[0]).toContain('生产企业'))
  it('classifies ordinary documents as exempt and puts the document issue first', () => {
    const output = evaluateRefund(valid({
      purchaseDocumentType: 'other_documents', originallyImported: 'yes',
      importTradeMode: 'general', underCustomsSupervision: 'no',
    }))
    expect(output.resultType).toBe('exempt_no_refund')
    expect(output.risks[0]).toContain('未取得增值税专用发票或海关进口增值税专用缴款书')
    expect(output.risks[1]).toContain('货物最初进口')
  })
  it('accepts a customs import VAT payment certificate as a valid input document', () => {
    const output = evaluateRefund(valid({ purchaseDocumentType: 'customs_payment' }))
    expect(output.resultType).toBe('eligible')
    expect(output.conclusion).toBe('原则上可以申报出口退税')
  })
  it('does not apply the ordinary-document exemption when no purchase document was obtained', () => {
    const output = evaluateRefund(valid({
      purchaseDocumentType: 'none',
    }))
    expect(output.resultType).toBe('insufficient')
    expect(output.conclusion).toBe('当前不具备申报出口退税条件，后续税务处理需要人工复核')
    expect(output.reasons[0]).toContain('当前不具备申报出口退税的凭证基础')
    expect(output.reasons[1]).toContain('免税不退税还是增值税征税')
    expect(output.legalBasis.some((item) => item.id === 'EXPORT_REFUND_ADMIN_2026_5_ARTICLE_18_1_3')).toBe(true)
    expect(output.legalBasis.some((item) => item.id === 'VAT_EXPORT_2026_11_ARTICLE_6_1_1_10')).toBe(false)
  })
  it('classifies used equipment without a valid input document as exempt', () => {
    const output = evaluateRefund(valid({ purchaseDocumentType: 'none', usedEquipment: 'yes', usedBy: 'other', usedEquipmentOtherDocsComplete: 'yes' }))
    expect(output.resultType).toBe('exempt_no_refund')
    expect(output.reasons[0]).toContain('其他相关单证齐全')
    expect(output.legalBasis.some((item) => item.id === 'VAT_EXPORT_2026_11_ARTICLE_6_1_1_6')).toBe(true)
  })
  it('does not apply the used-equipment exemption when other related documents are incomplete', () => {
    const output = evaluateRefund(valid({ purchaseDocumentType: 'none', usedEquipment: 'yes', usedBy: 'other', usedEquipmentOtherDocsComplete: 'no' }))
    expect(output.resultType).toBe('insufficient')
    expect(output.reasons[0]).toContain('不满足该旧设备免税条款的单证前提')
    expect(output.legalBasis.some((item) => item.id === 'VAT_EXPORT_2026_11_ARTICLE_6_1_1_6')).toBe(false)
  })
  it('requires confirmation of other related documents for used equipment without input vouchers', () => {
    const output = evaluateRefund(valid({ purchaseDocumentType: 'none', usedEquipment: 'yes', usedBy: 'other' }))
    expect(output.resultType).toBe('insufficient')
    expect(output.reasons[0]).toContain('必要判断信息未选择')
  })
  it('requires the combined depreciated fixed-asset answer for equipment used by the exporter', () => {
    const output = evaluateRefund(valid({ usedEquipment: 'yes', usedBy: 'self' }))
    expect(output.resultType).toBe('insufficient')
    expect(output.reasons[0]).toContain('必要判断信息未选择')
  })
  it('sends own depreciated equipment with a valid document to review', () => {
    const output = evaluateRefund(valid({ usedEquipment: 'yes', usedBy: 'self', depreciatedFixedAsset: 'yes' }))
    expect(output.resultType).toBe('review')
    expect(output.reasons.join('')).toContain('购进凭证金额×设备净值÷设备原值')
    expect(output.risks.join('')).toContain('进项税额未计算抵扣')
    expect(output.legalBasis.some((item) => item.id === 'VAT_EXPORT_2026_11_ARTICLE_4_1_11' && item.summary.includes('固定资产净值'))).toBe(true)
    expect(output.legalBasis.some((item) => item.id === 'VAT_EXPORT_2026_11_ARTICLE_4_1_7')).toBe(false)
    expect(output.legalBasis.some((item) => item.id === 'VAT_EXPORT_2026_11_ARTICLE_5_2')).toBe(true)
    expect(output.legalBasis.some((item) => item.id === 'EXPORT_REFUND_ADMIN_2026_5_ARTICLE_20_2')).toBe(true)
  })
  it('flags risky original import modes', () => {
    const output = evaluateRefund(valid({ originallyImported: 'yes', importTradeMode: 'bonded', underCustomsSupervision: 'unknown' }))
    expect(output.resultType).toBe('review')
    expect(output.risks.join('')).toContain('海关监管状态')
  })
  it('flags an unknown original import status', () => expect(evaluateRefund(valid({ originallyImported: 'unknown' })).resultType).toBe('review'))
  it('automatically flags an HSCode found in the dual-use reference catalog', () => {
    const output = evaluateRefund(valid({ hscode: '8504401940' }))
    expect(output.risks.join('')).toContain('命中 2026 年度两用物项')
    expect(output.versions.dualUseCatalog).toBe('2026')
  })
  it('recognizes goods entering a special zone as deemed exports requiring review', () => {
    const output = evaluateRefund(valid({ soldOverseas: 'special_zone', specialZoneRestrictedGoods: 'no' }))
    expect(output.resultType).toBe('review')
    expect(output.legalBasis.some((item) => item.id === 'VAT_EXPORT_2026_11_ARTICLE_1_1_2_1')).toBe(true)
    expect(output.risks.join('')).toContain('特殊区域视同出口')
  })
  it('flags consumer goods or vehicles sold into a special zone as tax risk', () => {
    const output = evaluateRefund(valid({ soldOverseas: 'special_zone', specialZoneRestrictedGoods: 'yes' }))
    expect(output.resultType).toBe('tax_risk')
    expect(output.legalBasis.some((item) => item.id === 'VAT_EXPORT_2026_11_ARTICLE_7_1_2')).toBe(true)
  })
  it('requires the special-zone goods classification', () => {
    expect(evaluateRefund(valid({ soldOverseas: 'special_zone' })).resultType).toBe('insufficient')
  })
  it('returns eligible and linked legal bases for the normal foreign-trade path', () => {
    const output = evaluateRefund(valid())
    expect(output.conclusion).toBe('原则上可以申报出口退税')
    expect(output.rateMatch.refund_rate).toBe(13)
    expect(output.rateMatch.goods_name).toContain('具有独立功能')
    expect(output.legalBasis.length).toBeGreaterThanOrEqual(5)
  })
})
