
import { createFileRoute } from '@tanstack/react-router'
import { HistoricalContext } from '@/features/historical-context'

export const Route = createFileRoute(
  '/_authenticated/historical-context'
)({
  component: HistoricalContext,
})
