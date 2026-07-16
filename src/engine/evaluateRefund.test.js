import { describe, expect, it } from 'vitest'
import { evaluateRefund } from './evaluateRefund.js'
import { lookupRefundRate, refundRateMetadata } from './refundRateLookup.js'
import { dualUseCatalogMetadata, lookupDualUseHscode } from './dualUseLookup.js'

const valid = (overrides = {}) => ({
  hscode: '8479899990', exportDate: '2026-07-07', rateCandidateCode: '', enterpriseType: 'foreign_trade', soldOverseas: 'yes', customsExported: 'yes', saleRecognized: 'yes', unrecognizedSaleReason: '', collectionStatus: 'yes', collectionFailureReason: '',
  purchaseDocumentType: 'vat_invoice', simplifiedOrSmallSupplier: 'no', invoiceRate: '', usedEquipment: 'no', usedBy: '', usedEquipmentOtherDocsComplete: '', depreciatedFixedAsset: '', inputTaxNotDeducted: '',
  originallyImported: 'no', importTradeMode: '', underCustomsSupervision: '', ...overrides,
})

describe('evaluateRefund', () => {
  it('rejects an invalid HSCode', () => expect(evaluateRefund(valid({ hscode: '123' })).resultType).toBe('insufficient'))
  it('reports an unmatched HSCode', () => expect(evaluateRefund(valid({ hscode: '1234567890' })).reasons[0]).toContain('未在当前官方退税率文库'))
  it('uses the special commodity flag to classify a zero-rate taxable item', () => {
    const output = evaluateRefund({ hscode: '8541430000', exportDate: '2026-07-07' })
    expect(output.resultType).toBe('tax_risk')
    expect(output.conclusion).toContain('无法产生应退税额')
    expect(output.rateMatch.special_policy.category).toBe('taxable')
    expect(output.legalBasis.some((item) => item.id === 'VAT_EXPORT_2026_11_ARTICLE_7_1_1')).toBe(true)
  })
  it('uses the special commodity flag to classify a zero-rate exempt item', () => {
    const output = evaluateRefund({ hscode: '7108110000', exportDate: '2026-07-07' })
    expect(output.resultType).toBe('exempt_no_refund')
    expect(output.conclusion).toContain('免税不退税')
    expect(output.rateMatch.special_policy.category).toBe('exempt')
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
  it('requires a concrete commodity selection when a 10-digit code has different specific rates', () => {
    const ambiguous = lookupRefundRate('0210990090', '2026-07-07')
    expect(ambiguous.ambiguous).toBe(true)
    expect(ambiguous.candidate_rates).toEqual(expect.arrayContaining([9, 13]))
    const output = evaluateRefund(valid({ hscode: '0210990090' }))
    expect(output.resultType).toBe('insufficient')
    expect(output.conclusion).toContain('多个可能结果')
  })
  it('uses the selected specific commodity code to resolve an ambiguous 10-digit code', () => {
    const match = lookupRefundRate('0210990090', '2026-07-07', '02109900902')
    expect(match.ambiguous).not.toBe(true)
    expect(match.refund_rate).toBe(13)
    const output = evaluateRefund(valid({ hscode: '0210990090', rateCandidateCode: '02109900902' }))
    expect(output.resultType).toBe('eligible')
    expect(output.rateMatch.rate_code).toBe('02109900902')
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
  it('requires the simplified-tax or small-supplier condition when a VAT special invoice is selected', () => {
    const output = evaluateRefund(valid({ simplifiedOrSmallSupplier: '' }))
    expect(output.resultType).toBe('insufficient')
  })
  it('requires an invoice rate only when the lower-of rule applies', () => {
    const output = evaluateRefund(valid({ simplifiedOrSmallSupplier: 'yes', invoiceRate: '' }))
    expect(output.resultType).toBe('insufficient')
  })
  it('does not apply the lower-of rule to an ordinary VAT special invoice purchase', () => {
    const output = evaluateRefund(valid({ simplifiedOrSmallSupplier: 'no', invoiceRate: '3' }))
    expect(output.resultType).toBe('eligible')
    expect(output.rateMatch.applicable_refund_rate).toBe(13)
    expect(output.legalBasis.some((item) => item.id === 'VAT_EXPORT_2026_11_ARTICLE_3_2_1')).toBe(false)
  })
  it('applies the lower of a 3% invoice rate and the library refund rate', () => {
    const output = evaluateRefund(valid({ simplifiedOrSmallSupplier: 'yes', invoiceRate: '3' }))
    expect(output.rateMatch.refund_rate).toBe(13)
    expect(output.rateMatch.applicable_refund_rate).toBe(3)
    expect(output.legalBasis.some((item) => item.id === 'VAT_EXPORT_2026_11_ARTICLE_3_2_1')).toBe(true)
  })
  it('supports a 1% invoice rate and sends other rates to review', () => {
    expect(evaluateRefund(valid({ simplifiedOrSmallSupplier: 'yes', invoiceRate: '1' })).rateMatch.applicable_refund_rate).toBe(1)
    const output = evaluateRefund(valid({ simplifiedOrSmallSupplier: 'yes', invoiceRate: 'other' }))
    expect(output.resultType).toBe('review')
    expect(output.risks.join('')).toContain('无法自动按孰低原则')
  })
  it('does not automatically classify a failed export condition as taxable', () => {
    const output = evaluateRefund(valid({ soldOverseas: 'no' }))
    expect(output.resultType).toBe('insufficient')
    expect(output.conclusion).toContain('不符合一般出口货物退税')
  })
  it('classifies unrecognized-sale samples and exhibits as exempt', () => {
    const output = evaluateRefund(valid({ saleRecognized: 'no', unrecognizedSaleReason: 'sample_exhibit' }))
    expect(output.resultType).toBe('exempt_no_refund')
    expect(output.legalBasis.some((item) => item.id === 'VAT_EXPORT_2026_11_ARTICLE_6_1_1_15')).toBe(true)
  })
  it('requires a reason when an export was not recognized as a sale', () => {
    expect(evaluateRefund(valid({ saleRecognized: 'no' })).resultType).toBe('insufficient')
  })
  it('classifies a genuinely uncollectible export as exempt', () => {
    const output = evaluateRefund(valid({ collectionStatus: 'no', collectionFailureReason: 'genuinely_uncollectible' }))
    expect(output.resultType).toBe('exempt_no_refund')
    expect(output.legalBasis.some((item) => item.id === 'VAT_EXPORT_2026_11_ARTICLE_6_1_1_16')).toBe(true)
  })
  it('keeps a pending or other collection failure out of the taxable category', () => {
    const output = evaluateRefund(valid({ collectionStatus: 'no', collectionFailureReason: 'other' }))
    expect(output.resultType).toBe('insufficient')
    expect(output.conclusion).toContain('尚未满足收汇条件')
  })
  it('sends a production enterprise to review', () => expect(evaluateRefund(valid({ enterpriseType: 'production' })).reasons[0]).toContain('生产企业'))
  it('classifies ordinary documents as exempt and puts the document issue first', () => {
    const output = evaluateRefund(valid({
      purchaseDocumentType: 'other_documents', originallyImported: 'yes',
      importTradeMode: 'general', underCustomsSupervision: 'no',
    }))
    expect(output.resultType).toBe('exempt_no_refund')
    expect(output.risks[0]).toContain('未取得增值税专用发票或海关进口增值税专用缴款书')
    expect(output.exportCompliance.status).toBe('clear')
    expect(output.exportCompliance.notes.join('')).toContain('货物最初进口')
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
    expect(output.resultType).toBe('tax_risk')
    expect(output.conclusion).toBe('不适用退免税或存在征税风险')
    expect(output.reasons[0]).toContain('未取得任何合法有效购进凭证')
    expect(output.legalBasis.some((item) => item.id === 'VAT_EXPORT_2026_11_ARTICLE_7_1_11')).toBe(true)
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
    expect(output.resultType).toBe('tax_risk')
    expect(output.reasons[0]).toContain('不满足旧设备免税条款的单证前提')
    expect(output.legalBasis.some((item) => item.id === 'VAT_EXPORT_2026_11_ARTICLE_6_1_1_6')).toBe(false)
  })
  it('classifies a used item with a legal ordinary purchase document as exempt without a separate completeness answer', () => {
    const output = evaluateRefund(valid({ purchaseDocumentType: 'other_documents', usedEquipment: 'yes', usedBy: 'other' }))
    expect(output.resultType).toBe('exempt_no_refund')
    expect(output.legalBasis.some((item) => item.id === 'VAT_EXPORT_2026_11_ARTICLE_6_1_1_10')).toBe(true)
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
    const output = evaluateRefund(valid({ usedEquipment: 'yes', usedBy: 'self', depreciatedFixedAsset: 'yes', inputTaxNotDeducted: 'yes' }))
    expect(output.resultType).toBe('review')
    expect(output.reasons.join('')).toContain('购进凭证金额×设备净值÷设备原值')
    expect(output.risks.join('')).toContain('进项税额未计算抵扣')
    expect(output.legalBasis.some((item) => item.id === 'VAT_EXPORT_2026_11_ARTICLE_4_1_11' && item.summary.includes('固定资产净值'))).toBe(true)
    expect(output.legalBasis.some((item) => item.id === 'VAT_EXPORT_2026_11_ARTICLE_4_1_7')).toBe(false)
    expect(output.legalBasis.some((item) => item.id === 'VAT_EXPORT_2026_11_ARTICLE_5_2')).toBe(true)
    expect(output.legalBasis.some((item) => item.id === 'EXPORT_REFUND_ADMIN_2026_5_ARTICLE_20_2')).toBe(true)
  })
  it('requires the input-tax deduction status for own depreciated equipment with a valid purchase document', () => {
    const output = evaluateRefund(valid({ usedEquipment: 'yes', usedBy: 'self', depreciatedFixedAsset: 'yes' }))
    expect(output.resultType).toBe('insufficient')
    expect(output.reasons[0]).toContain('必要判断信息未选择')
  })
  it('does not apply the own-used-equipment special refund rule when input tax was deducted', () => {
    const output = evaluateRefund(valid({ usedEquipment: 'yes', usedBy: 'self', depreciatedFixedAsset: 'yes', inputTaxNotDeducted: 'no' }))
    expect(output.resultType).toBe('review')
    expect(output.conclusion).toContain('不适用未抵扣进项税额')
    expect(output.reasons.join('')).toContain('已经计算抵扣')
    expect(output.reasons.join('')).toContain('不会再按购进凭证金额')
    expect(output.legalBasis.some((item) => item.id === 'VAT_EXPORT_2026_11_ARTICLE_4_1_11')).toBe(true)
  })
  it('reviews self-used equipment that was not a depreciated fixed asset', () => {
    const output = evaluateRefund(valid({ usedEquipment: 'yes', usedBy: 'self', depreciatedFixedAsset: 'no' }))
    expect(output.resultType).toBe('review')
    expect(output.reasons.join('')).toContain('不能直接套用已使用过设备专项')
  })
  it('flags risky original import modes', () => {
    const output = evaluateRefund(valid({ originallyImported: 'yes', importTradeMode: 'bonded', underCustomsSupervision: 'unknown' }))
    expect(output.resultType).toBe('eligible')
    expect(output.taxAssessment.resultType).toBe('eligible')
    expect(output.exportCompliance.status).toBe('review')
    expect(output.exportCompliance.issues.join('')).toContain('海关监管')
  })
  it('keeps an unknown original import status in the independent compliance conclusion', () => {
    const output = evaluateRefund(valid({ originallyImported: 'unknown' }))
    expect(output.resultType).toBe('eligible')
    expect(output.exportCompliance.status).toBe('review')
  })
  it('automatically flags an HSCode found in the dual-use reference catalog', () => {
    const output = evaluateRefund(valid({ hscode: '8504401940' }))
    expect(output.resultType).toBe('eligible')
    expect(output.taxAssessment.conclusion).toBe('原则上可以申报出口退税')
    expect(output.exportCompliance.status).toBe('review')
    expect(output.exportCompliance.issues.join('')).toContain('命中2026年度两用物项')
    expect(output.versions.dualUseCatalog).toBe('2026')
  })
  it('recognizes goods entering a special zone as deemed exports requiring review', () => {
    const output = evaluateRefund(valid({ soldOverseas: 'special_zone', specialZoneRestrictedGoods: 'no' }))
    expect(output.resultType).toBe('review')
    expect(output.exportCompliance.status).toBe('review')
    expect(output.legalBasis.some((item) => item.id === 'VAT_EXPORT_2026_11_ARTICLE_1_1_2_1')).toBe(true)
    expect(output.exportCompliance.issues.join('')).toContain('特殊区域')
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
    expect(output.legalBasis.length).toBeGreaterThanOrEqual(4)
    expect(output.legalBasis.some((item) => item.id === 'VAT_EXPORT_2026_11_ARTICLE_3_2_1')).toBe(false)
    expect(output.taxAssessment).toEqual({ resultType: 'eligible', conclusion: '原则上可以申报出口退税' })
    expect(output.exportCompliance.status).toBe('clear')
    expect(output.exportCompliance.conclusion).toContain('未发现已配置规则中的明显出口合规风险')
  })
})
