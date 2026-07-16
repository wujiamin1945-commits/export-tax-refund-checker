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
  exempt: ['出口合同', '采购合同', '普通发票、政府非税票据、拍卖或资产重组凭证等', '出口货物报关单', '物流运输单据', '免税处理依据', '财务成本处理说明'],
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

function createResult({ resultType, conclusion, reasons, risks = [], ruleIds = [], documents = DOCUMENTS.review, rateMatch = null, exportCompliance }) {
  return {
    resultType,
    conclusion,
    taxAssessment: { resultType, conclusion },
    exportCompliance,
    reasons,
    risks: unique(risks),
    legalBasis: resolveLegalBasis(ruleIds),
    documents: unique(documents),
    versions: getVersions(),
    rateMatch,
  }
}

function assessExportCompliance(formData) {
  const issues = []
  const notes = []
  let incomplete = false
  const hscode = String(formData.hscode ?? '').trim()
  if (!/^\d{10}$/.test(hscode)) {
    return {
      status: 'insufficient',
      conclusion: '出口合规信息不足，暂无法完成初筛',
      issues: ['需要有效的10位HSCode才能进行两用物项等出口合规初筛。'],
      notes: [],
    }
  }
  if (formData.soldOverseas === 'special_zone') {
    issues.push('该业务涉及特殊区域，应核对入区报关单、销售对象、货物实际流向及特殊区域业务类型。')
    if (formData.specialZoneRestrictedGoods === 'unknown') {
      issues.push('尚不清楚货物是否属于销售给特殊区域内的生活消费用品或交通运输工具。')
    }
  }
  if (!formData.customsExported) incomplete = true
  if (formData.customsExported === 'no') issues.push('货物尚未完成报关并实际离境，当前不具备完成出口及申报退税的操作条件。')
  if (!formData.originallyImported) incomplete = true
  if (formData.originallyImported === 'unknown') {
    issues.push('无法确认货物是否存在原进口业务，应核对货物来源、原进口资料和监管解除情况。')
  }
  if (formData.originallyImported === 'yes') {
    if (formData.importTradeMode === 'general' && formData.underCustomsSupervision === 'no') {
      notes.push('货物最初进口本身不当然影响退税；一般贸易进口且已解除监管时，仍应留存原进口资料。')
    }
    if (['duty_reduction', 'temporary', 'bonded', 'repair', 'lease', 'unknown'].includes(formData.importTradeMode)
      || ['yes', 'unknown'].includes(formData.underCustomsSupervision)) {
      issues.push('货物可能仍涉及海关监管，应核对原进口报关单、监管解除情况、处置许可或复运出境要求。')
    }
    if (!formData.importTradeMode || !formData.underCustomsSupervision) incomplete = true
  }
  const dualUseMatch = lookupDualUseHscode(hscode)
  if (dualUseMatch?.matched) issues.push('该HSCode命中2026年度两用物项许可证管理目录参考编号，必须核对技术参数、用途和管制编码，并确认是否需要许可证。')
  else if (dualUseMatch) notes.push('该HSCode未命中目录参考编号，但HSCode不是两用物项的最终判定依据，仍不能排除参数管制、临时管制或全面管制。')

  const status = issues.length ? 'review' : incomplete ? 'insufficient' : 'clear'
  const conclusion = status === 'review'
    ? '存在需完成核查或许可手续的出口合规事项'
    : status === 'insufficient'
      ? '出口合规信息不足，暂无法完成初筛'
      : '未发现已配置规则中的明显出口合规风险'
  return { status, conclusion, issues: unique(issues), notes: unique(notes) }
}

function missingFields(formData) {
  const required = ['exportDate', 'enterpriseType', 'soldOverseas', 'customsExported', 'saleRecognized', 'collectionStatus', 'purchaseDocumentType', 'usedEquipment', 'originallyImported']
  const missing = required.filter((field) => !formData[field])
  if (formData.usedEquipment === 'yes' && !formData.usedBy) missing.push('usedBy')
  if (formData.purchaseDocumentType === 'vat_invoice' && !formData.simplifiedOrSmallSupplier) missing.push('simplifiedOrSmallSupplier')
  if (formData.purchaseDocumentType === 'vat_invoice'
    && formData.simplifiedOrSmallSupplier === 'yes'
    && !formData.invoiceRate) missing.push('invoiceRate')
  if (formData.usedEquipment === 'yes'
    && formData.purchaseDocumentType === 'none'
    && !formData.usedEquipmentOtherDocsComplete) missing.push('usedEquipmentOtherDocsComplete')
  if (formData.usedEquipment === 'yes' && formData.usedBy === 'self') {
    if (!formData.depreciatedFixedAsset) missing.push('depreciatedFixedAsset')
    if (formData.depreciatedFixedAsset === 'yes'
      && ['vat_invoice', 'customs_payment'].includes(formData.purchaseDocumentType)
      && !formData.inputTaxNotDeducted) missing.push('inputTaxNotDeducted')
  }
  if (formData.originallyImported === 'yes') {
    if (!formData.importTradeMode) missing.push('importTradeMode')
    if (!formData.underCustomsSupervision) missing.push('underCustomsSupervision')
  }
  if (formData.soldOverseas === 'special_zone' && !formData.specialZoneRestrictedGoods) missing.push('specialZoneRestrictedGoods')
  if (formData.saleRecognized === 'no' && !formData.unrecognizedSaleReason) missing.push('unrecognizedSaleReason')
  if (formData.collectionStatus === 'no' && !formData.collectionFailureReason) missing.push('collectionFailureReason')
  return unique(missing)
}

export function evaluateRefund(formData) {
  const result = (options) => createResult({ ...options, exportCompliance: assessExportCompliance(formData) })
  const hscode = String(formData.hscode ?? '').trim()
  let rateMatch = lookupRefundRate(hscode, formData.exportDate, formData.rateCandidateCode)

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
  if (rateMatch.ambiguous) {
    return result({
      resultType: 'insufficient', conclusion: '商品文库代码存在多个可能结果，需要确认具体商品', rateMatch,
      reasons: [`该10位HSCode在官方 ${rateMatch.version} 文库中对应多个退税率或政策属性不同的具体商品代码，不能直接采用父级税率。`],
      risks: ['请根据商品实际名称选择具体文库商品；不能确认时，应先核实商品归类或税收商品扩展码。'], ruleIds: ['REFUND_RATE_AMBIGUOUS'],
    })
  }
  if (rateMatch.refund_rate === 0) {
    if (rateMatch.special_policy?.category === 'taxable') {
      return result({
        resultType: 'tax_risk', conclusion: '无法产生应退税额，且文库特殊商品标识显示存在征税风险', rateMatch,
        reasons: [`当前商品退税率为0，文库特殊商品标识为“${rateMatch.special_policy.label}”，初步属于取消出口退（免）税或出口不退税商品。`],
        risks: ['除政策明确列明的例外业务外，可能不适用退免税和免税政策，应按视同向境内销售等规定申报缴纳增值税。'], ruleIds: ['REFUND_RATE_ZERO_TAXABLE'],
      })
    }
    if (rateMatch.special_policy?.category === 'exempt') {
      return result({
        resultType: 'exempt_no_refund', conclusion: '无法产生应退税额，较可能适用免税不退税', rateMatch,
        reasons: [`当前商品退税率为0，文库特殊商品标识为“${rateMatch.special_policy.label}”，初步按照免税不退税路径判断。`],
        risks: ['对应进项税额不得抵扣和退税，应按规定转入成本；仍需核对该商品是否存在专项政策。'], ruleIds: ['REFUND_RATE_ZERO_EXEMPT'], documents: DOCUMENTS.exempt,
      })
    }
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

  if (!['yes', 'special_zone'].includes(formData.soldOverseas) || formData.customsExported !== 'yes') {
    return result({
      resultType: 'insufficient', conclusion: '当前不符合一般出口货物退税的基础条件', rateMatch,
      reasons: [formData.customsExported !== 'yes'
        ? '货物尚未向海关报关并实际离境，当前不能按一般出口货物申报出口退税。'
        : '当前销售和出口情形不属于系统已支持的一般出口或特殊区域视同出口情形。'],
      risks: ['该情形不能直接按一般出口退税路径处理，需要先确认实际业务性质。'], ruleIds: [specialZoneBusiness ? 'SPECIAL_ZONE_DEEMED_EXPORT' : 'BASIC_EXPORT_CONDITION'],
    })
  }

  if (formData.saleRecognized === 'no') {
    if (formData.unrecognizedSaleReason === 'sample_exhibit') {
      return result({
        resultType: 'exempt_no_refund', conclusion: CONCLUSIONS.exempt, rateMatch,
        reasons: ['出口样品、展品但未按照会计制度确认销售，较可能适用增值税免税政策，而不是出口退税。'],
        risks: ['应留存样品、展品用途及未确认销售的会计处理资料，对应进项税额不得抵扣和退税。'], ruleIds: ['SAMPLE_EXHIBIT_EXEMPT'], documents: DOCUMENTS.exempt,
      })
    }
    return result({
      resultType: 'insufficient', conclusion: '当前未满足确认销售条件，不能按一般出口货物直接申报退税', rateMatch,
      reasons: ['货物未按会计制度确认销售，且不属于已确认的样品、展品免税情形，需进一步核实业务性质。'],
      risks: ['需要结合实际交易和会计处理进一步确认适用免税还是其他税务处理。'], ruleIds: ['BASIC_EXPORT_CONDITION'],
    })
  }

  if (formData.collectionStatus === 'no') {
    if (formData.collectionFailureReason === 'genuinely_uncollectible') {
      return result({
        resultType: 'exempt_no_refund', conclusion: CONCLUSIONS.exempt, rateMatch,
        reasons: ['该出口货物确实无法收汇且不符合视同收汇规定，较可能适用增值税免税政策，而不是出口退税。'],
        risks: ['需要留存无法收汇的事实材料；对应进项税额不得抵扣和退税，应按规定转入成本。'], ruleIds: ['UNABLE_TO_COLLECT_EXEMPT'], documents: unique([...DOCUMENTS.exempt, '无法收汇情况说明及证明材料']),
      })
    }
    return result({
      resultType: 'insufficient', conclusion: '当前尚未满足收汇条件，暂不能按一般路径办理出口退税', rateMatch,
      reasons: ['当前尚未按规定收汇，也未确认属于确实无法收汇或视同收汇情形。'],
      risks: ['待完成收汇或取得视同收汇举证材料后，可在规定期限内重新判断和申报。'], ruleIds: ['COLLECTION_PENDING_REVIEW'], documents: DOCUMENTS.review,
    })
  }

  if (formData.enterpriseType !== 'foreign_trade') {
    const production = formData.enterpriseType === 'production'
    return result({
      resultType: 'insufficient', conclusion: CONCLUSIONS.insufficient, rateMatch,
      reasons: [production ? '生产企业通常适用免抵退税逻辑，第一版系统暂不自动判断。' : '其他单位的退免税适用情形需结合主体资格和具体业务人工复核。'],
      risks: ['当前工具仅支持增值税一般纳税人外贸企业。'], ruleIds: ['ENTERPRISE_TYPE_REVIEW'],
    })
  }

  const validInputDocument = ['vat_invoice', 'customs_payment'].includes(formData.purchaseDocumentType)
  const onlyOtherDocuments = formData.purchaseDocumentType === 'other_documents'
  const lowerOfApplies = formData.purchaseDocumentType === 'vat_invoice' && formData.simplifiedOrSmallSupplier === 'yes'
  const numericInvoiceRate = lowerOfApplies && /^\d+(\.\d+)?$/.test(formData.invoiceRate)
    ? Number(formData.invoiceRate)
    : null
  const invoiceRateNeedsReview = lowerOfApplies && formData.invoiceRate === 'other'
  if (numericInvoiceRate !== null) {
    rateMatch = {
      ...rateMatch,
      invoice_rate: numericInvoiceRate,
      applicable_refund_rate: Math.min(rateMatch.refund_rate, numericInvoiceRate),
      rate_rule: '专票税率或征收率与出口退税率孰低',
    }
  } else if (validInputDocument) {
    rateMatch = { ...rateMatch, applicable_refund_rate: rateMatch.refund_rate, rate_rule: '按出口退税率文库初步判断' }
  }
  const risks = []
  if (invoiceRateNeedsReview) risks.unshift('专票税率或征收率选择了“其他”，系统无法自动按孰低原则确定初步适用退税率。')
  const selfUsedEquipment = formData.usedEquipment === 'yes' && formData.usedBy === 'self'
  const ownDepreciatedEquipment = selfUsedEquipment && formData.depreciatedFixedAsset === 'yes'
  const ownUsedEquipmentSpecialRefund = ownDepreciatedEquipment && validInputDocument && formData.inputTaxNotDeducted === 'yes'
  if (ownUsedEquipmentSpecialRefund) risks.unshift('已确认该设备进项税额未计算抵扣，申报时仍应以增值税申报资料和固定资产台账核实。')
  if (!validInputDocument) {
    risks.unshift(onlyOtherDocuments
      ? '未取得增值税专用发票或海关进口增值税专用缴款书，目前仅有普通发票、政府非税票据、拍卖或资产重组凭证等，通常不具备外贸企业免退税的购进凭证基础。'
      : '未取得增值税专用发票或海关进口增值税专用缴款书，缺少当前规则所需的有效退税购进凭证。')
  }

  if (formData.usedEquipment === 'yes' && formData.purchaseDocumentType === 'none' && formData.usedEquipmentOtherDocsComplete === 'yes') {
    risks.unshift('旧设备未取得增值税专用发票或海关进口增值税专用缴款书，但已确认其他相关单证齐全，应按免税政策路径复核。')
    return result({
      resultType: 'exempt_no_refund', conclusion: CONCLUSIONS.exempt, rateMatch,
      reasons: ['已使用过的设备购进时未取得增值税专用发票、海关进口增值税专用缴款书，且其他相关单证齐全，较可能适用增值税免税政策，而不是申报出口退税。'],
      risks, ruleIds: ['USED_EQUIPMENT_NO_VALID_INPUT_DOCUMENT'],
      documents: unique([...DOCUMENTS.exempt, '旧设备购进及权属证明', '设备使用记录', '其他相关单证']),
    })
  }

  if (formData.usedEquipment === 'yes' && formData.purchaseDocumentType === 'none') {
    if (formData.usedEquipmentOtherDocsComplete === 'no') {
      return result({
        resultType: 'tax_risk', conclusion: CONCLUSIONS.taxRisk, rateMatch,
        reasons: ['该旧设备既未取得任何合法有效购进凭证，其他相关单证也不齐全，不满足旧设备免税条款的单证前提。', '对于购进后直接出口且未取得任何合法有效购进凭证的业务，除政策明确例外外，存在视同向境内销售征税风险。'],
        risks, ruleIds: ['NO_PURCHASE_DOCUMENT_TAX_RISK'], documents: DOCUMENTS.review,
      })
    }
    return result({
      resultType: 'insufficient', conclusion: '当前不具备申报出口退税条件，后续税务处理需要人工复核', rateMatch,
      reasons: ['旧设备未取得任何合法有效购进凭证，但尚不清楚其他相关单证是否齐全，暂时无法判定是否适用旧设备免税政策或征税政策。'],
      risks, ruleIds: ['NO_PURCHASE_DOCUMENT_REVIEW'], documents: DOCUMENTS.review,
    })
  }

  if (formData.purchaseDocumentType === 'none') {
    return result({
      resultType: 'tax_risk', conclusion: CONCLUSIONS.taxRisk, rateMatch,
      reasons: ['该业务属于购进后直接出口，但未取得任何合法有效购进凭证，除政策明确例外外，不适用出口退（免）税和免税政策。'],
      risks, ruleIds: ['NO_PURCHASE_DOCUMENT_TAX_RISK'], documents: DOCUMENTS.review,
    })
  }

  if (!validInputDocument) {
    return result({
      resultType: 'exempt_no_refund', conclusion: CONCLUSIONS.exempt, rateMatch,
      reasons: [onlyOtherDocuments
        ? '外贸企业出口货物仅取得普通发票、政府非税票据、拍卖凭证或资产重组凭证等合法有效购进凭证的，较可能适用免税不退税。'
        : '未取得可用于外贸企业免退税申报的进项凭证，较可能适用免税不退税，建议人工复核具体凭证类型。'],
      risks, ruleIds: ['NORMAL_INVOICE_OR_RECEIPT_EXEMPT'], documents: DOCUMENTS.exempt,
    })
  }

  if (ownDepreciatedEquipment && formData.inputTaxNotDeducted === 'no') {
    return result({
      resultType: 'review', conclusion: '该设备不适用未抵扣进项税额的已使用设备专项退税规则，需复核出口环节税务处理', rateMatch,
      reasons: ['该设备购进时的进项税额已经计算抵扣，不符合“出口进项税额未计算抵扣的已使用过设备”专项免退税规则的前提。', '系统不会再按购进凭证金额×设备净值÷设备原值计算专项应退税额。'],
      risks, ruleIds: ['OWN_USED_EQUIPMENT_INPUT_DEDUCTED_REVIEW'], documents: unique([...DOCUMENTS.eligible, ...DOCUMENTS.review, '固定资产台账', '进项税额抵扣记录']),
    })
  }

  if (selfUsedEquipment && formData.depreciatedFixedAsset === 'no') {
    return result({
      resultType: 'review', conclusion: CONCLUSIONS.review, rateMatch,
      reasons: ['该设备由本企业使用过，但未作为已计提折旧的固定资产，不能直接套用已使用过设备专项免退税计税依据。'],
      risks, ruleIds: ['OWN_USED_EQUIPMENT_SPECIAL_REVIEW'], documents: unique([...DOCUMENTS.eligible, ...DOCUMENTS.review, '设备入账及使用记录']),
    })
  }

  if (ownUsedEquipmentSpecialRefund || specialZoneBusiness || invoiceRateNeedsReview) {
    const reviewReasons = ownUsedEquipmentSpecialRefund
      ? ['该设备已由本企业使用、作为固定资产并计提折旧，应按已使用过设备的专门规则复核。', '在确认进项税额未计算抵扣的前提下，退免税计税依据应按购进凭证金额×设备净值÷设备原值计算，不应直接按发票全额计算。']
      : ['外贸企业的基础出口条件、进项凭证和正退税率条件已初步满足，但存在需人工复核的专项风险。']
    return result({
      resultType: 'review', conclusion: CONCLUSIONS.review, rateMatch,
      reasons: reviewReasons,
      risks,
      ruleIds: [specialZoneBusiness ? 'SPECIAL_ZONE_DEEMED_EXPORT' : 'BASIC_EXPORT_CONDITION', ...(ownUsedEquipmentSpecialRefund ? ['OWN_USED_EQUIPMENT_SPECIAL_REVIEW'] : ['FOREIGN_TRADE_ENTERPRISE_REFUND', 'VALID_INPUT_DOCUMENT']), ...(lowerOfApplies ? ['INVOICE_RATE_LOWER_OF'] : [])],
      documents: unique([...DOCUMENTS.eligible, ...DOCUMENTS.review]),
    })
  }

  const eligibleDocuments = formData.originallyImported === 'yes'
    ? [...DOCUMENTS.eligible, '原进口报关单和进口缴款书']
    : DOCUMENTS.eligible
  return result({
    resultType: 'eligible', conclusion: CONCLUSIONS.eligible, rateMatch,
    reasons: [
      '适用主体为增值税一般纳税人外贸企业，出口货物通常适用免退税办法。',
      specialZoneBusiness ? '该业务已初步符合特殊区域视同出口货物条件。' : '该业务已初步满足出口货物退免税的基础条件。',
      '已取得可用于退税判断的进项凭证。',
      `当前 HSCode 按 ${rateMatch.query_date} 在官方 ${rateMatch.version} 文库中查询到的退税率为 ${rateMatch.refund_rate}%，大于 0。`,
      ...(numericInvoiceRate !== null ? [`专票税率或征收率为 ${numericInvoiceRate}%，按与文库退税率孰低原则，初步适用退税率为 ${rateMatch.applicable_refund_rate}%。`] : []),
      '未发现明显免税不退税、征税或重大海关监管风险触发项。',
    ],
    risks: risks.length ? risks : ['未发现已配置税务规则中的明显风险；仍建议结合最新政策和实际单证复核。'],
    ruleIds: [specialZoneBusiness ? 'SPECIAL_ZONE_DEEMED_EXPORT' : 'BASIC_EXPORT_CONDITION', 'FOREIGN_TRADE_ENTERPRISE_REFUND', 'VALID_INPUT_DOCUMENT', ...(lowerOfApplies ? ['INVOICE_RATE_LOWER_OF'] : [])], documents: eligibleDocuments,
  })
}
