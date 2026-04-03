'use client'

interface StatsBarProps {
  active: number
  expired: number
  umbrella: number
}

export default function StatsBar({ active, expired, umbrella }: StatsBarProps) {
  const cards = [
    {
      label: 'Active Tokens',
      value: active,
      colorClass: 'bg-green-50 border-green-200 text-green-700',
      valueClass: 'text-green-800',
    },
    {
      label: 'Expired / Failed',
      value: expired,
      colorClass: 'bg-red-50 border-red-200 text-red-700',
      valueClass: 'text-red-800',
    },
    {
      label: 'Umbrella Tokens',
      value: umbrella,
      colorClass: 'bg-blue-50 border-blue-200 text-blue-700',
      valueClass: 'text-blue-800',
    },
  ]

  return (
    <div className="grid grid-cols-3 gap-4 mb-6">
      {cards.map((card) => (
        <div
          key={card.label}
          className={`rounded-lg border p-5 ${card.colorClass}`}
        >
          <p className="text-sm font-medium">{card.label}</p>
          <p className={`mt-1 text-3xl font-bold ${card.valueClass}`}>{card.value}</p>
        </div>
      ))}
    </div>
  )
}
