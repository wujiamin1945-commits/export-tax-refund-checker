import RefundRateLookup from './RefundRateLookup.jsx'
import DualUseLookup from './DualUseLookup.jsx'

const currentLocalDate = () => {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export const createEmptyForm = () => ({
  hscode: '', exportDate: currentLocalDate(), rateCandidateCode: '',
  enterpriseType: 'foreign_trade', soldOverseas: '', customsExported: '', specialZoneRestrictedGoods: '', saleRecognized: '', unrecognizedSaleReason: '', collectionStatus: '', collectionFailureReason: '',
  purchaseDocumentType: '', simplifiedOrSmallSupplier: '', invoiceRate: '',
  usedEquipment: '', usedBy: '', usedEquipmentOtherDocsComplete: '', depreciatedFixedAsset: '', inputTaxNotDeducted: '', originallyImported: '', importTradeMode: '', underCustomsSupervision: '',
})

const yesNo = [['yes', '是'], ['no', '否']]

function SelectField({ id, label, value, options, onChange, required = false, hint }) {
  return (
    <label className="field" htmlFor={id}>
      <span>{label}{required && <em> 必填</em>}</span>
      <select id={id} value={value} onChange={(event) => onChange(id, event.target.value)}>
        <option value="">请选择</option>
        {options.map(([optionValue, text]) => <option key={optionValue} value={optionValue}>{text}</option>)}
      </select>
      {hint && <small>{hint}</small>}
    </label>
  )
}

function TextField({ id, label, value, onChange, type = 'text', placeholder = '', required = false, maxLength }) {
  return (
    <label className="field" htmlFor={id}>
      <span>{label}{required && <em> 必填</em>}</span>
      <input id={id} type={type} value={value} placeholder={placeholder} maxLength={maxLength} required={required}
        inputMode={id === 'hscode' ? 'numeric' : undefined}
        onChange={(event) => onChange(id, id === 'hscode' ? event.target.value.replace(/\D/g, '').slice(0, 10) : event.target.value)} />
    </label>
  )
}

function Section({ number, title, description, children }) {
  return (
    <fieldset className="form-section">
      <legend><b>{number}</b><span>{title}<small>{description}</small></span></legend>
      <div className="field-grid">{children}</div>
    </fieldset>
  )
}

export default function InputForm({ formData, onChange, onSubmit, onReset }) {
  const update = (field, value) => {
    const next = { ...formData, [field]: value }
    if (field === 'usedEquipment' && value !== 'yes') Object.assign(next, { usedBy: '', usedEquipmentOtherDocsComplete: '', depreciatedFixedAsset: '', inputTaxNotDeducted: '' })
    if (field === 'usedBy' && value !== 'self') Object.assign(next, { depreciatedFixedAsset: '', inputTaxNotDeducted: '' })
    if (field === 'depreciatedFixedAsset' && value !== 'yes') next.inputTaxNotDeducted = ''
    if (field === 'purchaseDocumentType') {
      if (value !== 'vat_invoice') Object.assign(next, { simplifiedOrSmallSupplier: '', invoiceRate: '' })
      if (!['vat_invoice', 'customs_payment'].includes(value)) next.inputTaxNotDeducted = ''
      if (['vat_invoice', 'customs_payment'].includes(value)) next.usedEquipmentOtherDocsComplete = ''
    }
    if (field === 'simplifiedOrSmallSupplier' && value !== 'yes') next.invoiceRate = ''
    if (['hscode', 'exportDate'].includes(field)) next.rateCandidateCode = ''
    if (field === 'saleRecognized' && value !== 'no') next.unrecognizedSaleReason = ''
    if (field === 'collectionStatus' && value !== 'no') next.collectionFailureReason = ''
    if (field === 'originallyImported' && value !== 'yes') Object.assign(next, { importTradeMode: '', underCustomsSupervision: '' })
    if (field === 'soldOverseas' && value !== 'special_zone') next.specialZoneRestrictedGoods = ''
    onChange(next)
  }

  return (
    <form className="input-card" onSubmit={onSubmit} noValidate>
      <div className="card-heading">
        <div><span className="step-label">业务信息</span><h2>填写判断条件</h2></div>
        <span className="required-note"><i /> 必填判断项</span>
      </div>

      <Section number="01" title="商品信息" description="用于匹配官方退税率文库">
        <div className="field field--wide">
          <TextField id="hscode" label="HSCode" value={formData.hscode} onChange={update} placeholder="请输入 10 位数字" required maxLength={10} />
          <RefundRateLookup hscode={formData.hscode} exportDate={formData.exportDate} selectedRateCode={formData.rateCandidateCode} onSelectRateCode={(value) => update('rateCandidateCode', value)} />
          <DualUseLookup hscode={formData.hscode} />
        </div>
        <TextField id="exportDate" label="预计出口日期" value={formData.exportDate} onChange={update} type="date" required />
      </Section>

      <Section number="02" title="企业与出口条件" description="核对退免税基础条件">
        <div className="field">
          <span>适用企业主体</span>
          <div className="fixed-value" aria-label="适用企业主体：增值税一般纳税人外贸企业">
            <strong>增值税一般纳税人外贸企业</strong>
            <small>当前工具不适用于增值税小规模纳税人</small>
          </div>
        </div>
        <SelectField id="soldOverseas" label="业务销售/出口情形" value={formData.soldOverseas} onChange={update} required options={[["yes", '销售给境外单位或个人并实际离境'], ["special_zone", '报关进入综合保税区等特殊区域并销售给区内单位或境外单位/个人'], ["no", '以上情形均不符合']]} />
        <SelectField id="customsExported" label={formData.soldOverseas === 'special_zone' ? '是否向海关报关进入特殊区域' : '是否报关并实际离境'} value={formData.customsExported} onChange={update} required options={yesNo} />
        {formData.soldOverseas === 'special_zone' && <SelectField id="specialZoneRestrictedGoods" label="是否属于销售给特殊区域内的生活消费用品或交通运输工具" value={formData.specialZoneRestrictedGoods} onChange={update} required options={[["yes", '是'], ["no", '否'], ["unknown", '不清楚']]} />}
        <SelectField id="saleRecognized" label="是否按会计制度确认销售" value={formData.saleRecognized} onChange={update} required options={yesNo} />
        {formData.saleRecognized === 'no' &&
          <SelectField id="unrecognizedSaleReason" label="未确认销售的原因" value={formData.unrecognizedSaleReason} onChange={update} required
            options={[["sample_exhibit", '出口样品、展品但未确认销售'], ["other", '其他原因']]} />}
        <SelectField id="collectionStatus" label="是否按规定收汇" value={formData.collectionStatus} onChange={update} required options={[["yes", '是'], ["no", '否'], ["deemed", '视同收汇']]} />
        {formData.collectionStatus === 'no' &&
          <SelectField id="collectionFailureReason" label="未按规定收汇的原因" value={formData.collectionFailureReason} onChange={update} required
            options={[["genuinely_uncollectible", '确实无法收汇且不符合视同收汇规定'], ["other", '尚未收汇或其他原因']]} />}
      </Section>

      <Section number="03" title="采购与发票信息" description="判断是否具备有效进项凭证">
        <SelectField id="purchaseDocumentType" label="取得的购进凭证类型" value={formData.purchaseDocumentType} onChange={update} required
          options={[["vat_invoice", '增值税专用发票'], ["customs_payment", '海关进口增值税专用缴款书'], ["other_documents", '普通发票、政府非税票据、拍卖或资产重组凭证等'], ["none", '未取得上述任何合法有效购进凭证']]} />
        {formData.purchaseDocumentType === 'vat_invoice' && <>
          <SelectField id="simplifiedOrSmallSupplier" label="是否从小规模纳税人购进，或购进环节适用简易计税方法" value={formData.simplifiedOrSmallSupplier} onChange={update} required options={yesNo}
            hint="仅在该情形下，取得专票的退税率才按专票税率（征收率）与文库退税率孰低确定。" />
          {formData.simplifiedOrSmallSupplier === 'yes' &&
            <SelectField id="invoiceRate" label="专票税率或征收率" value={formData.invoiceRate} onChange={update} required options={[['13', '13%'], ['9', '9%'], ['3', '3%'], ['1', '1%'], ['other', '其他']]} />}
        </>}
      </Section>

      <Section number="04" title="旧设备与监管状态" description="识别专项税务及海关风险">
        <SelectField id="usedEquipment" label="是否旧设备/已使用过设备" value={formData.usedEquipment} onChange={update} required options={yesNo} />
        {formData.usedEquipment === 'yes' && <>
          <SelectField id="usedBy" label="旧设备是谁使用过" value={formData.usedBy} onChange={update} required options={[["self", '我司使用过'], ["other", '其他单位或个人使用过']]} />
          {formData.purchaseDocumentType === 'none' &&
            <SelectField id="usedEquipmentOtherDocsComplete" label="旧设备的其他相关单证是否齐全" value={formData.usedEquipmentOtherDocsComplete} onChange={update} required
              options={[["yes", '是'], ["no", '否'], ["unknown", '不清楚']]}
              hint="用于判断无专票、无海关进口增值税专用缴款书时，是否满足旧设备免税政策的单证前提。" />}
          {formData.usedBy === 'self' && <>
            <SelectField id="depreciatedFixedAsset" label="该设备是否为我司已计提折旧的固定资产" value={formData.depreciatedFixedAsset} onChange={update} required options={yesNo} />
            {formData.depreciatedFixedAsset === 'yes' && ['vat_invoice', 'customs_payment'].includes(formData.purchaseDocumentType) &&
              <SelectField id="inputTaxNotDeducted" label="该设备购进时的进项税额是否未计算抵扣" value={formData.inputTaxNotDeducted} onChange={update} required options={yesNo}
                hint="只有进项税额未计算抵扣的自用已折旧设备，才进入已使用设备专项免退税计税依据判断。" />}
          </>}
        </>}
        <SelectField id="originallyImported" label="货物最初是否进口" value={formData.originallyImported} onChange={update} required options={[["yes", '是'], ["no", '否'], ["unknown", '不清楚']]} />
        {formData.originallyImported === 'yes' && <>
          <SelectField id="importTradeMode" label="原进口贸易方式" value={formData.importTradeMode} onChange={update} required options={[["general", '一般贸易'], ["duty_reduction", '减免税'], ["temporary", '暂时进境'], ["bonded", '保税'], ["repair", '修理物品'], ["lease", '租赁'], ["unknown", '不清楚'], ["na", '不适用']]} />
          <SelectField id="underCustomsSupervision" label="是否仍在海关监管期" value={formData.underCustomsSupervision} onChange={update} required options={[["yes", '是'], ["no", '否'], ["unknown", '不清楚'], ["na", '不适用']]} />
        </>}
      </Section>

      <div className="form-actions">
        <button type="button" className="button button--secondary" onClick={onReset}>清空表单</button>
        <button type="submit" className="button button--primary">开始判断 <span aria-hidden="true">→</span></button>
      </div>
    </form>
  )
}
