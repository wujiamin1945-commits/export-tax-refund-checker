import legalBasisData from '../data/legal_basis.json'
import rulesData from '../data/rules.json'
import { lookupRefundRate, refundRateMetadata } from './refundRateLookup.js'
import { dualUseCatalogMetadata, lookupDualUseHscode } from './dualUseLookup.js'

const CONCLUSIONS = {
  eligible: '原则上可以申报出口退税',
  review: '原则上可退税，但需人工复核风险项',
  exempt: '较可能适用免税不退税',
  taxRisk: '不适用退免税或存在征税风险',
  insufficient: '信息不足，需要人工复核',
}

const DOCUMENTS = {
  eligible: ['出口合同', '采购合同', '增值税专用发票或海关进口增值税专用缴款书', '出口货物报关单', '物流运输单据', '收汇凭证或视同收汇资料', '备案单证目录', '商品归类依据'],
  exempt: ['出口合同', '采购合同', '普通发票、拍卖成交确认书、收据等凭证', '出口货物报关单', '物流运输单据', '免税处理依据', '财务成本处理说明'],
  review: ['原进口报关单', '海关进口增值税专用缴款书', '海关监管状态说明', '是否解除监管的证明', '商品归类依据', '报关行意见', '主管税务机关咨询记录', '合规部门审核意见'],
}

const unique = (items) => [...new Set(items)]
const activeRules = new Map(rulesData.filter((rule) => rule.enabled).map((rule) => [rule.rule_id, rule]))
const legalBasisById = new Map(legalBasisData.map((item) => [item.id, item]))

function getVersions() {
  return {
    rules: unique(rulesData.filter((item) => item.enabled).map((item) => item.version)).join(', '),
    legalBasis: unique(legalBasisData.map((item) => item.data_version)).join(', '),
    refundRates: refundRateMetadata.version,
    dualUseCatalog: dualUseCatalogMetadata.version,
  }
}

function resolveLegalBasis(ruleIds) {
  const ids = unique(ruleIds.flatMap((id) => activeRules.get(id)?.legal_basis_ids ?? []))
  return ids.map((id) => legalBasisById.get(id)).filter(Boolean)
}

function result({ resultType, conclusion, reasons, risks = [], ruleIds = [], documents = DOCUMENTS.review, rateMatch = null }) {
  return {
    resultType,
    conclusion,
    reasons,
    risks: unique(risks),
    legalBasis: resolveLegalBasis(ruleIds),
    documents: unique(documents),
    versions: getVersions(),
    rateMatch,
  }
}

function regulatoryRisks(formData) {
  const risks = []
  if (formData.soldOverseas === 'special_zone') {
    risks.push('该业务涉及特殊区域视同出口规则，建议核对入区报关单、销售对象、货物实际流向及特殊区域业务类型。')
    if (formData.specialZoneRestrictedGoods === 'unknown') {
      risks.push('尚不清楚货物是否属于销售给特殊区域内的生活消费用品或交通运输工具，建议在申报前专项复核。')
    }
  }
  if (formData.originallyImported === 'unknown') {
    risks.push('货物可能涉及海关监管状态，但当前无法确认是否存在原进口业务，建议核对货物来源、原进口资料和监管解除情况。')
  }
  if (formData.originallyImported === 'yes') {
    if (formData.importTradeMode === 'general' && formData.underCustomsSupervision === 'no') {
      risks.push('货物最初进口这一事实本身不当然影响出口退税判断，但仍需核对原进口资料和现有进项凭证。')
    }
    if (['duty_reduction', 'temporary', 'bonded', 'repair', 'lease', 'unknown'].includes(formData.importTradeMode)
      || ['yes', 'unknown'].includes(formData.underCustomsSupervision)) {
      risks.push('货物可能涉及海关监管状态，需进一步核对原进口报关单、进口缴款书、监管解除情况或复运出境要求。')
    }
  }
  const dualUseMatch = lookupDualUseHscode(formData.hscode)
  if (dualUseMatch?.matched) risks.push('该 HSCode 命中 2026 年度两用物项许可证管理目录的参考海关商品编号，必须继续核对物项技术参数、主要用途和管制编码，并在出口前确认是否需要许可。')
  else if (dualUseMatch) risks.push('该 HSCode 未命中 2026 年度目录中已列明的参考编号，但 HSCode 不是两用物项的判定依据，仍不能排除参数管制、临时管制或全面管制。')
  return risks
}

function missingFields(formData) {
  const required = ['exportDate', 'enterpriseType', 'soldOverseas', 'customsExported', 'saleRecognized', 'collectionStatus', 'purchaseDocumentType', 'usedEquipment', 'originallyImported']
  const missing = required.filter((field) => !formData[field])
  if (formData.usedEquipment === 'yes' && !formData.usedBy) missing.push('usedBy')
  if (formData.purchaseDocumentType === 'vat_invoice' && !formData.invoiceRate) missing.push('invoiceRate')
  if (formData.usedEquipment === 'yes'
    && ['other_documents', 'none'].includes(formData.purchaseDocumentType)
    && !formData.usedEquipmentOtherDocsComplete) missing.push('usedEquipmentOtherDocsComplete')
  if (formData.usedEquipment === 'yes' && formData.usedBy === 'self') {
    if (!formData.depreciatedFixedAsset) missing.push('depreciatedFixedAsset')
  }
  if (formData.originallyImported === 'yes') {
    if (!formData.importTradeMode) missing.push('importTradeMode')
    if (!formData.underCustomsSupervision) missing.push('underCustomsSupervision')
  }
  if (formData.soldOverseas === 'special_zone' && !formData.specialZoneRestrictedGoods) missing.push('specialZoneRestrictedGoods')
  return unique(missing)
}

export function evaluateRefund(formData) {
  const hscode = String(formData.hscode ?? '').trim()
  let rateMatch = lookupRefundRate(hscode, formData.exportDate)

  if (!/^\d{10}$/.test(hscode)) {
    return result({
      resultType: 'insufficient', conclusion: CONCLUSIONS.insufficient,
      reasons: ['HSCode 为空或格式不正确，无法准确匹配出口退税率。'], ruleIds: ['HSCODE_INVALID'],
    })
  }
  if (!rateMatch) {
    return result({
      resultType: 'insufficient', conclusion: CONCLUSIONS.insufficient,
      reasons: ['未在当前官方退税率文库覆盖期间内匹配到该 HSCode，请核对商品编码和预计出口日期。'], ruleIds: ['REFUND_RATE_NOT_FOUND'],
    })
  }
  if (rateMatch.refund_rate === 0) {
    return result({
      resultType: 'insufficient', conclusion: '无法产生应退税额，需判断政策属性', rateMatch,
      reasons: [`当前 HSCode 按 ${rateMatch.query_date} 在官方 ${rateMatch.version} 文库中匹配的退税率为 0，但 0% 本身不能区分免税不退税与视同内销征税情形。`],
      risks: ['如果属于第六条免税政策范围，较可能适用免税不退税，对应进项税额不得抵扣和退税，应转入成本。', '如果属于取消出口退（免）税货物或第七条征税情形，则不适用退免税，可能应按视同向境内销售等规定申报缴纳增值税。'], ruleIds: ['REFUND_RATE_ZERO'],
    })
  }

  const missing = missingFields(formData)
  if (missing.length) {
    return result({
      resultType: 'insufficient', conclusion: CONCLUSIONS.insufficient, rateMatch,
      reasons: [`尚有 ${missing.length} 项必要判断信息未选择，系统不会将空值默认为“是”。`],
      risks: ['请补充标注为必填的业务条件后重新判断。'], ruleIds: [],
    })
  }

  const specialZoneBusiness = formData.soldOverseas === 'special_zone'
  if (specialZoneBusiness && formData.specialZoneRestrictedGoods === 'yes') {
    return result({
      resultType: 'tax_risk', conclusion: CONCLUSIONS.taxRisk, rateMatch,
      reasons: ['销售给特殊区域内的生活消费用品或交通运输工具，可能适用增值税征税政策，不应直接按一般视同出口退税处理。'],
      risks: ['建议核对商品用途、销售对象和特殊区域管理要求，并咨询主管税务机关。'],
      ruleIds: ['SPECIAL_ZONE_TAXABLE_GOODS'],
    })
  }

  const baseSatisfied = ['yes', 'special_zone'].includes(formData.soldOverseas)
    && formData.customsExported === 'yes'
    && formData.saleRecognized === 'yes'
    && ['yes', 'deemed'].includes(formData.collectionStatus)
  if (!baseSatisfied) {
    return result({
      resultType: 'tax_risk', conclusion: CONCLUSIONS.taxRisk, rateMatch,
      reasons: ['该业务未完全满足出口货物适用退免税的基础条件。'],
      risks: regulatoryRisks(formData), ruleIds: [specialZoneBusiness ? 'SPECIAL_ZONE_DEEMED_EXPORT' : 'BASIC_EXPORT_CONDITION'],
    })
  }

  if (formData.enterpriseType !== 'foreign_trade') {
    const production = formData.enterpriseType === 'production'
    return result({
      resultType: 'insufficient', conclusion: CONCLUSIONS.insufficient, rateMatch,
      reasons: [production ? '生产企业通常适用免抵退税逻辑，第一版系统暂不自动判断。' : '其他单位的退免税适用情形需结合主体资格和具体业务人工复核。'],
      risks: regulatoryRisks(formData), ruleIds: ['ENTERPRISE_TYPE_REVIEW'],
    })
  }

  const validInputDocument = ['vat_invoice', 'customs_payment'].includes(formData.purchaseDocumentType)
  const onlyOtherDocuments = formData.purchaseDocumentType === 'other_documents'
  const numericInvoiceRate = formData.purchaseDocumentType === 'vat_invoice' && /^\d+(\.\d+)?$/.test(formData.invoiceRate)
    ? Number(formData.invoiceRate)
    : null
  const invoiceRateNeedsReview = formData.purchaseDocumentType === 'vat_invoice' && formData.invoiceRate === 'other'
  if (numericInvoiceRate !== null) {
    rateMatch = {
      ...rateMatch,
      invoice_rate: numericInvoiceRate,
      applicable_refund_rate: Math.min(rateMatch.refund_rate, numericInvoiceRate),
      rate_rule: '专票税率或征收率与出口退税率孰低',
    }
  } else if (formData.purchaseDocumentType === 'customs_payment') {
    rateMatch = { ...rateMatch, applicable_refund_rate: rateMatch.refund_rate, rate_rule: '按出口退税率文库初步判断' }
  }
  const risks = regulatoryRisks(formData)
  if (invoiceRateNeedsReview) risks.unshift('专票税率或征收率选择了“其他”，系统无法自动按孰低原则确定初步适用退税率。')
  const ownUsedEquipment = formData.usedEquipment === 'yes' && formData.usedBy === 'self'
    && formData.depreciatedFixedAsset === 'yes'
  if (ownUsedEquipment) risks.unshift('已使用过设备适用专项免退税规则的前提是该设备进项税额未计算抵扣，应核对增值税申报和固定资产台账。')
  if (!validInputDocument) {
    risks.unshift(onlyOtherDocuments
      ? '未取得增值税专用发票或海关进口增值税专用缴款书，目前仅有普通发票、拍卖成交确认书、收据等凭证，通常不具备外贸企业免退税的购进凭证基础。'
      : '未取得增值税专用发票或海关进口增值税专用缴款书，缺少当前规则所需的有效退税购进凭证。')
  }

  if (formData.usedEquipment === 'yes' && !validInputDocument && formData.usedEquipmentOtherDocsComplete === 'yes') {
    risks.unshift('旧设备未取得增值税专用发票或海关进口增值税专用缴款书，但已确认其他相关单证齐全，应按免税政策路径复核。')
    return result({
      resultType: 'exempt_no_refund', conclusion: CONCLUSIONS.exempt, rateMatch,
      reasons: ['已使用过的设备购进时未取得增值税专用发票、海关进口增值税专用缴款书，且其他相关单证齐全，较可能适用增值税免税政策，而不是申报出口退税。'],
      risks, ruleIds: ['USED_EQUIPMENT_NO_VALID_INPUT_DOCUMENT', ...(ownUsedEquipment ? ['OWN_USED_EQUIPMENT_SPECIAL_REVIEW'] : [])],
      documents: unique([...DOCUMENTS.exempt, '旧设备购进及权属证明', '设备使用记录', '其他相关单证']),
    })
  }

  if (formData.usedEquipment === 'yes' && !validInputDocument) {
    const documentsIncomplete = formData.usedEquipmentOtherDocsComplete === 'no'
    return result({
      resultType: 'insufficient', conclusion: '当前不具备申报出口退税条件，后续税务处理需要人工复核', rateMatch,
      reasons: [documentsIncomplete
        ? '旧设备未取得增值税专用发票或海关进口增值税专用缴款书，且其他相关单证不齐全，不满足该旧设备免税条款的单证前提。'
        : '旧设备未取得增值税专用发票或海关进口增值税专用缴款书，但尚不清楚其他相关单证是否齐全，暂时无法判定是否适用旧设备免税政策。'],
      risks, ruleIds: ['NO_PURCHASE_DOCUMENT_REVIEW'], documents: DOCUMENTS.review,
    })
  }

  if (formData.purchaseDocumentType === 'none') {
    risks.splice(1, 0, '同时未确认持有普通发票、政府非税收入票据、拍卖成交确认书及收据等凭证，不能直接引用相应的免税不退税条款。')
    return result({
      resultType: 'insufficient', conclusion: '当前不具备申报出口退税条件，后续税务处理需要人工复核', rateMatch,
      reasons: ['既未取得可用于外贸企业免退税申报的增值税专用发票或海关进口增值税专用缴款书，也未确认持有其他合法有效进货凭证，因此当前不具备申报出口退税的凭证基础。', '现有信息仍不足以直接判定后续应适用免税不退税还是增值税征税处理，需进一步核实采购来源、货物权属和实际凭证。'],
      risks, ruleIds: ['NO_PURCHASE_DOCUMENT_REVIEW'], documents: DOCUMENTS.review,
    })
  }

  if (!validInputDocument) {
    return result({
      resultType: 'exempt_no_refund', conclusion: CONCLUSIONS.exempt, rateMatch,
      reasons: [onlyOtherDocuments
        ? '外贸企业出口货物如果仅取得普通发票、拍卖成交确认书、收据等凭证，通常不具备出口退税的进项凭证基础，较可能适用免税不退税。'
        : '未取得可用于外贸企业免退税申报的进项凭证，较可能适用免税不退税，建议人工复核具体凭证类型。'],
      risks, ruleIds: ['NORMAL_INVOICE_OR_RECEIPT_EXEMPT'], documents: DOCUMENTS.exempt,
    })
  }

  const hasCustomsRisk = risks.some((item) => item.startsWith('货物可能涉及海关'))
  const hasControlRisk = lookupDualUseHscode(formData.hscode)?.matched === true
  if (ownUsedEquipment || hasCustomsRisk || hasControlRisk || specialZoneBusiness || invoiceRateNeedsReview) {
    const reviewReasons = ownUsedEquipment
      ? ['该设备已由本企业使用、作为固定资产并计提折旧，应按已使用过设备的专门规则复核。', '在确认进项税额未计算抵扣的前提下，退免税计税依据应按购进凭证金额×设备净值÷设备原值计算，不应直接按发票全额计算。']
      : ['外贸企业的基础出口条件、进项凭证和正退税率条件已初步满足，但存在需人工复核的专项风险。']
    return result({
      resultType: 'review', conclusion: CONCLUSIONS.review, rateMatch,
      reasons: reviewReasons,
      risks,
      ruleIds: [specialZoneBusiness ? 'SPECIAL_ZONE_DEEMED_EXPORT' : 'BASIC_EXPORT_CONDITION', ...(ownUsedEquipment ? ['OWN_USED_EQUIPMENT_SPECIAL_REVIEW'] : ['FOREIGN_TRADE_ENTERPRISE_REFUND', 'VALID_INPUT_DOCUMENT']), ...(formData.purchaseDocumentType === 'vat_invoice' ? ['INVOICE_RATE_LOWER_OF'] : []), ...(hasCustomsRisk ? ['IMPORT_CUSTOMS_SUPERVISION_REVIEW'] : []), ...(hasControlRisk ? ['EXPORT_CONTROL_REVIEW'] : [])],
      documents: unique([...DOCUMENTS.eligible, ...DOCUMENTS.review]),
    })
  }

  const eligibleDocuments = formData.originallyImported === 'yes'
    ? [...DOCUMENTS.eligible, '原进口报关单和进口缴款书']
    : DOCUMENTS.eligible
  return result({
    resultType: 'eligible', conclusion: CONCLUSIONS.eligible, rateMatch,
    reasons: [
      '企业类型为外贸企业，出口货物通常适用免退税办法。',
      specialZoneBusiness ? '该业务已初步符合特殊区域视同出口货物条件。' : '该业务已初步满足出口货物退免税的基础条件。',
      '已取得可用于退税判断的进项凭证。',
      `当前 HSCode 按 ${rateMatch.query_date} 在官方 ${rateMatch.version} 文库中查询到的退税率为 ${rateMatch.refund_rate}%，大于 0。`,
      ...(numericInvoiceRate !== null ? [`专票税率或征收率为 ${numericInvoiceRate}%，按与文库退税率孰低原则，初步适用退税率为 ${rateMatch.applicable_refund_rate}%。`] : []),
      '未发现明显免税不退税、征税或重大海关监管风险触发项。',
    ],
    risks: risks.length ? risks : ['未发现已配置规则中的明显风险；仍建议结合最新政策和实际单证复核。'],
    ruleIds: [specialZoneBusiness ? 'SPECIAL_ZONE_DEEMED_EXPORT' : 'BASIC_EXPORT_CONDITION', 'FOREIGN_TRADE_ENTERPRISE_REFUND', 'VALID_INPUT_DOCUMENT', ...(formData.purchaseDocumentType === 'vat_invoice' ? ['INVOICE_RATE_LOWER_OF'] : [])], documents: eligibleDocuments,
  })
}
