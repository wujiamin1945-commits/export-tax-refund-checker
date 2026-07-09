import { dualUseCatalogMetadata, lookupDualUseHscode } from '../engine/dualUseLookup.js'

export default function DualUseLookup({ hscode }) {
  if (!hscode) return <p className="field-hint">已导入 {dualUseCatalogMetadata.version} 年度两用物项许可证管理目录参考 HSCode</p>
  const match = lookupDualUseHscode(hscode)
  if (!match) return null
  if (match.matched) {
    return <div className="lookup lookup--warning">
      <strong>出口管制初步筛查结果：该 HSCode 已列入2026年度两用物项参考目录</strong>
      <span>这表明该货物需要进行重点出口管制复核，但不代表必然属于受控物项。出口前应根据产品规格书核对物项名称、技术参数、性能和主要用途，确认对应的两用物项管制编码及是否需要申请出口许可。</span>
    </div>
  }
  return <div className="lookup lookup--matched">
    <strong>出口管制初步筛查结果：未发现该 HSCode 列入2026年度两用物项参考目录</strong>
    <span>这仅表示当前本地参考编码库未匹配，不等于确认该货物不受出口管制。部分受控物项未配置参考 HSCode，最终应以两用物项出口管制清单规定的物项名称、技术参数、性能和用途为准。出口前仍应结合产品规格书、最终用户、最终用途和目的地完成合规复核；无法判断时，建议向商务主管部门咨询。</span>
  </div>
}
