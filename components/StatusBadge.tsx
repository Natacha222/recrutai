type Status = 'qualifié' | 'rejeté' | 'en attente' | 'actif' | 'clos' | string

const styles: Record<string, string> = {
  'qualifié': 'bg-status-green-bg text-status-green',
  'rejeté': 'bg-status-red-bg text-status-red',
  'en attente': 'bg-status-amber-bg text-status-amber',
  'actif': 'bg-status-green-bg text-status-green',
  'clos': 'bg-status-red-bg text-status-red',
}

export default function StatusBadge({ status }: { status: Status }) {
  const cls = styles[status] ?? 'bg-gray-100 text-gray-600'
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${cls}`}
    >
      {status}
    </span>
  )
}
