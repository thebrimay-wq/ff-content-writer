export interface LanguageOption {
  value: string
  label: string
}

export interface RegionOption {
  region: string
  label: string
  language: LanguageOption[]
}

export const versionConfig: { options: RegionOption[] } = {
  options: [
    {
      region: 'us',
      label: 'United States',
      language: [
        { value: 'en', label: 'English' },
        { value: 'es', label: 'Spanish' },
      ],
    },
    { region: 'ca', label: 'Canada', language: [{ value: 'en', label: 'English' }] },
    { region: 'gb', label: 'United Kingdom', language: [{ value: 'en', label: 'English' }] },
    { region: 'mx', label: 'Mexico', language: [{ value: 'es', label: 'Spanish' }] },
    { region: 'ph', label: 'Philippines', language: [{ value: 'en', label: 'English' }] },
    { region: 'ie', label: 'Ireland', language: [{ value: 'en', label: 'English' }] },
    {
      region: 'un',
      label: 'Universal',
      language: [
        { value: 'en', label: 'English' },
        { value: 'es', label: 'Spanish' },
        { value: 'fr', label: 'French' },
        { value: 'pt', label: 'Portuguese' },
      ],
    },
    {
      region: 'ca-qc',
      label: 'Quebec',
      language: [
        { value: 'en', label: 'English' },
        { value: 'fr', label: 'French' },
      ],
    },
    { region: 'au', label: 'Australia', language: [{ value: 'en', label: 'English' }] },
  ],
}

export const DEFAULT_REGION = 'us'
export const DEFAULT_LANGUAGE = 'en'

export function regionLabel(region: string): string {
  return versionConfig.options.find(o => o.region === region)?.label ?? region
}

export function languageLabel(region: string, lang: string): string {
  const r = versionConfig.options.find(o => o.region === region)
  return r?.language.find(l => l.value === lang)?.label ?? lang
}

export function languagesForRegion(region: string): LanguageOption[] {
  return versionConfig.options.find(o => o.region === region)?.language ?? []
}

// Emoji flag for the region chip. Universal and Quebec get custom symbols;
// the rest are derived from the ISO-style region code.
const REGION_FLAGS: Record<string, string> = {
  us: '🇺🇸',
  ca: '🇨🇦',
  gb: '🇬🇧',
  mx: '🇲🇽',
  ph: '🇵🇭',
  ie: '🇮🇪',
  au: '🇦🇺',
  un: '🌐',
  'ca-qc': '⚜️',
}

// Short-code badges for the inline chip: "US · EN", "QC · FR", etc.
const REGION_SHORT: Record<string, string> = {
  us: 'US',
  ca: 'CA',
  gb: 'UK',
  mx: 'MX',
  ph: 'PH',
  ie: 'IE',
  au: 'AU',
  un: 'UN',
  'ca-qc': 'QC',
}

export function regionFlag(region: string): string {
  return REGION_FLAGS[region] ?? '🌐'
}

export function regionShortCode(region: string): string {
  return REGION_SHORT[region] ?? region.toUpperCase()
}

export function languageShortCode(lang: string): string {
  return (lang || '').slice(0, 2).toUpperCase()
}
