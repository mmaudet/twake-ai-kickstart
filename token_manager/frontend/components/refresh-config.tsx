'use client'

export interface ServiceConfig {
  name: string
  auto_refresh: boolean
  token_validity: string
  refresh_margin: string
}

interface RefreshConfigProps {
  services: ServiceConfig[]
  onChange: (updated: ServiceConfig[]) => void
}

const VALIDITY_OPTIONS = [
  { label: '30 minutes', value: '30m' },
  { label: '1 hour', value: '1h' },
  { label: '4 hours', value: '4h' },
  { label: '8 hours', value: '8h' },
  { label: '24 hours', value: '24h' },
]

const MARGIN_OPTIONS = [
  { label: '5 minutes', value: '5m' },
  { label: '10 minutes', value: '10m' },
  { label: '15 minutes', value: '15m' },
  { label: '30 minutes', value: '30m' },
]

export default function RefreshConfig({ services, onChange }: RefreshConfigProps) {
  const update = (index: number, patch: Partial<ServiceConfig>) => {
    const updated = services.map((s, i) => (i === index ? { ...s, ...patch } : s))
    onChange(updated)
  }

  return (
    <div className="space-y-4">
      {services.map((svc, i) => (
        <div
          key={svc.name}
          className="rounded-lg border border-gray-200 bg-white p-5"
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-800 font-mono">{svc.name}</h3>
            <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={svc.auto_refresh}
                onChange={(e) => update(i, { auto_refresh: e.target.checked })}
                className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
              />
              Auto refresh
            </label>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Token validity
              </label>
              <select
                value={svc.token_validity}
                onChange={(e) => update(i, { token_validity: e.target.value })}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {VALIDITY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Refresh margin
              </label>
              <select
                value={svc.refresh_margin}
                onChange={(e) => update(i, { refresh_margin: e.target.value })}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {MARGIN_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
