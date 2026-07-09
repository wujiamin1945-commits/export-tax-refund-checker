import catalog from '../data/dual_use_hs_codes_2026.json'

const codeSet = new Set(catalog.codes)

export function lookupDualUseHscode(hscode) {
  const code = String(hscode ?? '').trim()
  if (!/^\d{10}$/.test(code)) return null
  return {
    hscode: code,
    matched: codeSet.has(code),
    version: catalog.metadata.version,
    source: catalog.metadata.source,
    source_url: catalog.metadata.source_url,
    disclaimer: catalog.metadata.scope,
  }
}

export const dualUseCatalogMetadata = catalog.metadata
