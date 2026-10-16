
import { useMemo, useState, type ChangeEvent } from 'react'
import Papa from 'papaparse'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ThemeSwitch } from '@/components/theme-switch'
import { ConfigDrawer } from '@/components/config-drawer'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'

type CsvRow = Record<string, string>
type Aggregation = 'average' | 'sum'

export function HistoricalContext() {
  const [rows, setRows] = useState<CsvRow[]>([])
  const [columns, setColumns] = useState<string[]>([])
  const [filename, setFilename] = useState('')
  const [error, setError] = useState('')

  const [dateColumn, setDateColumn] = useState('')
  const [metricColumn, setMetricColumn] = useState('')
  const [accountColumn, setAccountColumn] = useState('')
  const [accountFilter, setAccountFilter] = useState('')
  const [aggregation, setAggregation] =
    useState<Aggregation>('average')

  async function handleUpload(
    event: ChangeEvent<HTMLInputElement>
  ) {
    const file = event.target.files?.[0]
    if (!file) return

    setError('')
    setRows([])
    setColumns([])
    setFilename(file.name)
    setDateColumn('')
    setMetricColumn('')
    setAccountColumn('')
    setAccountFilter('')

    if (!file.name.toLowerCase().endsWith('.csv')) {
      setError('Please upload a CSV file.')
      return
    }

    if (file.size > 15 * 1024 * 1024) {
      setError(
        'This browser preview supports CSV files up to 15 MB. ' +
        'Larger datasets will use the data service.'
      )
      return
    }

    try {
      const parsed = Papa.parse<CsvRow>(
        await file.text(),
        {
          header: true,
          skipEmptyLines: 'greedy',
          transformHeader: (header) => header.trim(),
        }
      )

      if (parsed.errors.length > 0) {
        setError(
          `CSV parsing failed: ${parsed.errors[0].message}`
        )
        return
      }

      const headers = parsed.meta.fields ?? []

      if (!headers.length || !parsed.data.length) {
        setError('The CSV is empty or has no usable headers.')
        return
      }

      setRows(parsed.data)
      setColumns(headers)

      setDateColumn(
        headers.find((name) =>
          /^(timestamp|date|datetime|event_time|transaction_time|transaction_timestamp|event_date|created_at|occurred_at)$/i.test(name)
        ) ?? ''
      )

      setAccountColumn(
        headers.find((name) =>
          /^(account_id|player_id|account)$/i.test(name)
        ) ?? ''
      )

      setMetricColumn(
        headers.find((name) =>
          /^(amount|transaction_amount|deposit_amount|withdrawal_amount|wager_amount|fraud_score|aml_score|protection_score)$/i.test(name)
        ) ?? ''
      )
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to read the CSV.'
      )
    }
  }

  const chartData = useMemo(() => {
    if (!dateColumn || !metricColumn) return []

    const groups = new Map<
      string,
      { total: number; count: number }
    >()

    for (const row of rows) {
      if (
        accountColumn &&
        accountFilter.trim() &&
        row[accountColumn]?.trim() !== accountFilter.trim()
      ) {
        continue
      }

      const date = new Date(row[dateColumn] ?? '')
      const value = Number(row[metricColumn])

      if (
        !Number.isFinite(date.getTime()) ||
        !row[metricColumn]?.trim() ||
        !Number.isFinite(value)
      ) {
        continue
      }

      const day = date.toISOString().slice(0, 10)
      const existing = groups.get(day) ?? {
        total: 0,
        count: 0,
      }

      existing.total += value
      existing.count += 1

      groups.set(day, existing)
    }

    return Array.from(groups.entries())
      .map(([day, group]) => ({
        day,
        value:
          aggregation === 'sum'
            ? group.total
            : group.total / group.count,
        observations: group.count,
      }))
      .sort((a, b) => a.day.localeCompare(b.day))
  }, [
    rows,
    dateColumn,
    metricColumn,
    accountColumn,
    accountFilter,
    aggregation,
  ])

  const fieldSelectClass =
    'w-full rounded-md border bg-background px-3 py-2 text-sm'

  return (
    <>
      <Header>
        <div className='me-auto text-sm font-semibold'>
          Historical Context
        </div>
        <ThemeSwitch />
        <ConfigDrawer />
      </Header>

      <Main className='space-y-6'>
        <div>
          <p className='text-xs uppercase tracking-widest text-muted-foreground'>
            Investigation / Historical Context
          </p>
          <h1 className='mt-2 text-3xl font-bold tracking-tight'>
            Historical Context
          </h1>
          <p className='mt-2 text-sm text-muted-foreground'>
            Explore temporal patterns in uploaded account
            and transaction data.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Upload historical data</CardTitle>
            <CardDescription>
              Select a CSV containing timestamps and at least
              one numerical activity or risk measurement.
              Files are parsed locally in your browser.
            </CardDescription>
          </CardHeader>
          <CardContent className='space-y-4'>
            <Input
              type='file'
              accept='.csv,text/csv'
              aria-label='Upload historical CSV'
              onChange={(event) => void handleUpload(event)}
            />

            {filename && (
              <p className='text-sm text-muted-foreground'>
                {filename}
              </p>
            )}

            {error && (
              <p role='alert' className='text-sm text-destructive'>
                {error}
              </p>
            )}

            {rows.length > 0 && (
              <p className='text-sm text-muted-foreground'>
                Loaded {rows.length.toLocaleString()} records
                and {columns.length} columns.
              </p>
            )}
          </CardContent>
        </Card>

        {rows.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Temporal analysis controls</CardTitle>
              <CardDescription>
                Choose the date and numerical measurement
                used to build the timeline.
              </CardDescription>
            </CardHeader>

            <CardContent className='grid gap-4 md:grid-cols-2 xl:grid-cols-3'>
              <div className='space-y-2'>
                <label htmlFor='qg-date' className='text-sm font-medium'>
                  Timestamp column
                </label>
                <select
                  id='qg-date'
                  className={fieldSelectClass}
                  value={dateColumn}
                  onChange={(e) => setDateColumn(e.target.value)}
                >
                  <option value=''>Select timestamp</option>
                  {columns.map((column) => (
                    <option key={column} value={column}>
                      {column}
                    </option>
                  ))}
                </select>
              </div>

              <div className='space-y-2'>
                <label htmlFor='qg-metric' className='text-sm font-medium'>
                  Measurement
                </label>
                <select
                  id='qg-metric'
                  className={fieldSelectClass}
                  value={metricColumn}
                  onChange={(e) => setMetricColumn(e.target.value)}
                >
                  <option value=''>Select numerical column</option>
                  {columns.map((column) => (
                    <option key={column} value={column}>
                      {column}
                    </option>
                  ))}
                </select>
              </div>

              <div className='space-y-2'>
                <label htmlFor='qg-agg' className='text-sm font-medium'>
                  Aggregation per day
                </label>
                <select
                  id='qg-agg'
                  className={fieldSelectClass}
                  value={aggregation}
                  onChange={(e) =>
                    setAggregation(e.target.value as Aggregation)
                  }
                >
                  <option value='average'>Average</option>
                  <option value='sum'>Sum</option>
                </select>
              </div>

              <div className='space-y-2'>
                <label htmlFor='qg-account-col' className='text-sm font-medium'>
                  Account identifier column (optional)
                </label>
                <select
                  id='qg-account-col'
                  className={fieldSelectClass}
                  value={accountColumn}
                  onChange={(e) => setAccountColumn(e.target.value)}
                >
                  <option value=''>None</option>
                  {columns.map((column) => (
                    <option key={column} value={column}>
                      {column}
                    </option>
                  ))}
                </select>
              </div>

              <div className='space-y-2'>
                <label htmlFor='qg-account' className='text-sm font-medium'>
                  Filter by account ID (optional)
                </label>
                <Input
                  id='qg-account'
                  placeholder='Enter exact account ID'
                  value={accountFilter}
                  onChange={(e) => setAccountFilter(e.target.value)}
                  disabled={!accountColumn}
                />
              </div>
            </CardContent>
          </Card>
        )}

        {rows.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Behavioral timeline</CardTitle>
              <CardDescription>
                {metricColumn || 'Measurement'} grouped by UTC day
                using {aggregation === 'sum' ? 'sum' : 'average'}.
              </CardDescription>
            </CardHeader>

            <CardContent>
              {chartData.length > 0 ? (
                <div className='h-[350px] w-full'>
                  <ResponsiveContainer width='100%' height='100%'>
                    <LineChart data={chartData}>
                      <CartesianGrid
                        strokeDasharray='3 3'
                        opacity={0.2}
                      />
                      <XAxis
                        dataKey='day'
                        minTickGap={26}
                      />
                      <YAxis width={70} />
                      <Tooltip />
                      <Line
                        type='monotone'
                        dataKey='value'
                        name={metricColumn}
                        stroke='currentColor'
                        strokeWidth={2}
                        dot={false}
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className='py-12 text-center text-sm text-muted-foreground'>
                  Select a timestamp and numerical column with
                  valid historical observations to display a graph.
                </p>
              )}
            </CardContent>
          </Card>
        )}

        <p className='text-xs text-muted-foreground'>
          Historical charts describe observed uploaded data.
          They do not execute risk-model inference or establish fraud.
        </p>
      </Main>
    </>
  )
}
