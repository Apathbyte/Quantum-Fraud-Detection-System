
import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import {
  Activity,
  ArrowRight,
  ClipboardList,
  Flag,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  UploadCloud,
  Users,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ConfigDrawer } from '@/components/config-drawer'
import { ThemeSwitch } from '@/components/theme-switch'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

// ============================================================
// TYPES
// ============================================================

type RiskCategory = 'fraud' | 'aml' | 'protection'

type AlertCounts = Record<RiskCategory, number>

type SnapshotOverview = {
  source: string
  account_count: number
  alerted_accounts: number
  alert_counts: AlertCounts
  operational_models?: Record<RiskCategory, string>
  warning?: string
}

type ScanSummary = {
  scan_id: string
  dataset_id: string
  status: string
  source: string
  account_count: number
  alerted_accounts: number
  alert_counts: AlertCounts
  priority_policy: string
  warning: string
}

type ScanResponse = {
  id: string
  dataset_id: string
  status: string
  created_at: string
  completed_at: string | null
  error: string | null
  summary?: ScanSummary
}

type Prediction = {
  account_id: string
  fraud_score: number
  aml_score: number
  protection_score: number
  fraud_alert: boolean
  aml_alert: boolean
  protection_alert: boolean
  alert_count: number
  priority_score: number
}

type PredictionResponse = {
  scan_id: string
  rows: Prediction[]
}

type DisplayMode = 'scan' | 'snapshot'

// ============================================================
// FORMATTERS
// ============================================================

const numberFormat = new Intl.NumberFormat('en-CA')

function formatCount(value: number): string {
  return numberFormat.format(value)
}

function formatScore(value: number): string {
  if (value === 0) return '0.0000'

  if (Math.abs(value) < 0.0001) {
    return value.toExponential(2)
  }

  return value.toFixed(4)
}

function formatPercent(numerator: number, denominator: number): string {
  if (denominator <= 0) return '0.00%'

  return `${((numerator / denominator) * 100).toFixed(2)}%`
}

// ============================================================
// API
// ============================================================

async function fetchJson<T>(
  url: string,
  signal: AbortSignal
): Promise<T> {
  const response = await fetch(url, {
    signal,
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error(
      `API request failed: ${url} (${response.status})`
    )
  }

  const contentType =
    response.headers.get('content-type') ?? ''

  if (!contentType.includes('application/json')) {
    throw new Error(
      `Expected JSON from ${url}. Check the Vite API proxy.`
    )
  }

  return (await response.json()) as T
}

// ============================================================
// METRIC CARD
// ============================================================

function MetricCard({
  title,
  value,
  description,
  icon: Icon,
}: {
  title: string
  value: string
  description: string
  icon: typeof Users
}) {
  return (
    <Card>
      <CardHeader className='flex flex-row items-center justify-between'>
        <CardTitle className='text-sm font-medium'>
          {title}
        </CardTitle>

        <Icon className='size-4 text-muted-foreground' />
      </CardHeader>

      <CardContent>
        <div className='text-3xl font-bold tracking-tight tabular-nums'>
          {value}
        </div>

        <p className='mt-2 text-xs text-muted-foreground'>
          {description}
        </p>
      </CardContent>
    </Card>
  )
}

// ============================================================
// RISK CATEGORY CARD
// ============================================================

function RiskCard({
  name,
  model,
  count,
  total,
}: {
  name: string
  model: string
  count: number
  total: number
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className='flex items-center gap-2'>
          <Activity className='size-4' />
          {name}
        </CardTitle>

        <CardDescription>{model}</CardDescription>
      </CardHeader>

      <CardContent className='space-y-4'>
        <div className='text-3xl font-bold tabular-nums'>
          {formatCount(count)}
        </div>

        <div>
          <p className='mb-2 text-xs text-muted-foreground'>
            {formatPercent(count, total)} of monitored accounts
          </p>

          <div className='h-2 overflow-hidden rounded-full bg-muted'>
            <div
              className='h-full rounded-full bg-primary'
              style={{
                width: `${Math.min(
                  (count / Math.max(total, 1)) * 100,
                  100
                )}%`,
              }}
            />
          </div>
        </div>

        <p className='text-xs text-muted-foreground'>
          Accounts exceeding the saved operational alert threshold
        </p>
      </CardContent>
    </Card>
  )
}

// ============================================================
// SCORE CELL
// ============================================================

function ScoreCell({
  score,
  alert,
}: {
  score: number
  alert: boolean
}) {
  return (
    <div className='flex items-center gap-2'>
      <span className='font-mono text-xs tabular-nums'>
        {formatScore(score)}
      </span>

      {alert && (
        <Badge variant='destructive'>
          Alert
        </Badge>
      )}
    </div>
  )
}

// ============================================================
// COMMAND CENTRE
// ============================================================

export function Dashboard() {
  const [snapshot, setSnapshot] =
    useState<SnapshotOverview | null>(null)

  const [scanSummary, setScanSummary] =
    useState<ScanSummary | null>(null)

  const [scanId, setScanId] =
    useState<string | null>(null)

  const [predictions, setPredictions] =
    useState<Prediction[]>([])

  const [displayMode, setDisplayMode] =
    useState<DisplayMode>('scan')

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  // ----------------------------------------------------------
  // Watch for newly selected scans and tab focus.
  // ----------------------------------------------------------

  useEffect(() => {
    const refresh = () => {
      setRefreshKey((value) => value + 1)
    }

    const onStorage = (event: StorageEvent) => {
      if (event.key === 'qguard:selected-scan') {
        refresh()
      }
    }

    window.addEventListener('focus', refresh)
    window.addEventListener('storage', onStorage)
    window.addEventListener('qguard:scan-completed', refresh)

    return () => {
      window.removeEventListener('focus', refresh)
      window.removeEventListener('storage', onStorage)
      window.removeEventListener(
        'qguard:scan-completed',
        refresh
      )
    }
  }, [])

  // ----------------------------------------------------------
  // Retrieve the original snapshot and selected inference scan.
  // ----------------------------------------------------------

  useEffect(() => {
    const controller = new AbortController()
    let active = true

    async function loadDashboard() {
      setLoading(true)
      setError(null)
      setNotice(null)

      const selectedId = localStorage.getItem(
        'qguard:selected-scan'
      )

      setScanId(selectedId)

      try {
        // The existing endpoint serves the prepared demo
        // snapshot, not the newly uploaded inference scan.
        const snapshotRequest =
          fetchJson<SnapshotOverview>(
            '/api/overview',
            controller.signal
          )

        const scanRequest = selectedId
          ? fetchJson<ScanResponse>(
              `/api/scans/${encodeURIComponent(selectedId)}`,
              controller.signal
            )
          : Promise.resolve(null)

        const [snapshotResult, scanResult] =
          await Promise.allSettled([
            snapshotRequest,
            scanRequest,
          ])

        if (!active) return

        const loadedSnapshot =
          snapshotResult.status === 'fulfilled'
            ? snapshotResult.value
            : null

        const loadedScan =
          scanResult.status === 'fulfilled'
            ? scanResult.value
            : null

        setSnapshot(loadedSnapshot)

        let completedScan: ScanSummary | null = null
        let resultRows: Prediction[] = []

        if (
          loadedScan?.status === 'completed' &&
          loadedScan.summary
        ) {
          completedScan = loadedScan.summary

          try {
            const result =
              await fetchJson<PredictionResponse>(
                `/api/scans/${encodeURIComponent(
                  loadedScan.id
                )}/results?limit=20`,
                controller.signal
              )

            resultRows = result.rows
          } catch {
            if (!controller.signal.aborted) {
              setNotice(
                'The scan metrics loaded, but the account ' +
                'prediction preview is unavailable.'
              )
            }
          }
        } else if (selectedId) {
          setNotice(
            loadedScan
              ? `The selected scan is ${loadedScan.status}. ` +
                'Displaying the prepared snapshot until ' +
                'a completed scan is available.'
              : 'The previously selected scan could not ' +
                'be retrieved. Displaying the prepared snapshot.'
          )
        }

        if (!active) return

        setScanSummary(completedScan)
        setPredictions(resultRows)

        if (!loadedSnapshot && !completedScan) {
          setError(
            'No dashboard data is available. Verify that ' +
            'FastAPI is running and the model bundle exists.'
          )
        }
      } catch (err) {
        if (!active) return

        setError(
          err instanceof Error
            ? err.message
            : 'Unable to load Command Centre.'
        )
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    void loadDashboard()

    return () => {
      active = false
      controller.abort()
    }
  }, [refreshKey])

  // ----------------------------------------------------------
  // Select the source displayed on the Command Centre.
  // ----------------------------------------------------------

  const showingScan =
    scanSummary !== null &&
    (displayMode === 'scan' || snapshot === null)

  const metrics = showingScan
    ? scanSummary
    : snapshot

  const chartData = metrics
    ? [
        {
          name: 'Fraud',
          alerts: metrics.alert_counts.fraud,
        },
        {
          name: 'AML',
          alerts: metrics.alert_counts.aml,
        },
        {
          name: 'Protection',
          alerts: metrics.alert_counts.protection,
        },
      ]
    : []

  const operationalModels = snapshot?.operational_models

  // ----------------------------------------------------------
  // Render
  // ----------------------------------------------------------

  return (
    <>
      <Header>
        <div className='me-auto flex items-center gap-2'>
          <ShieldCheck className='size-5' />
          <span className='font-semibold'>
            Q-Guard Operations
          </span>
        </div>

        <ThemeSwitch />
        <ConfigDrawer />
      </Header>

      <Main className='space-y-6'>
        {/* Heading */}

        <div className='flex flex-wrap items-start justify-between gap-4'>
          <div>
            <p className='text-xs font-medium uppercase tracking-widest text-muted-foreground'>
              Investigation Workspace / Overview
            </p>

            <h1 className='mt-2 text-3xl font-bold tracking-tight'>
              Command Centre
            </h1>

            <p className='mt-2 text-sm text-muted-foreground'>
              Operational fraud, AML and player protection
              monitoring.
            </p>
          </div>

          <div className='flex flex-wrap items-center gap-2'>
            <Button
              variant='outline'
              onClick={() =>
                setRefreshKey((value) => value + 1)
              }
              disabled={loading}
            >
              <RefreshCw className='size-4' />
              Refresh
            </Button>

            <Button asChild>
              <Link to='/data-intake'>
                <UploadCloud className='size-4' />
                Run new scan
                <ArrowRight className='size-4' />
              </Link>
            </Button>
          </div>
        </div>

        {/* Data source selector */}

        <Card>
          <CardContent className='flex flex-wrap items-center justify-between gap-4'>
            <div className='space-y-2'>
              <div className='flex items-center gap-2'>
                <span className='text-sm font-semibold'>
                  Data source
                </span>

                <Badge variant='outline'>
                  Synthetic research data
                </Badge>
              </div>

              <p className='text-sm text-muted-foreground'>
                {showingScan
                  ? 'Fresh inference from the uploaded CSV'
                  : 'Prepared retrospective demonstration snapshot'}
              </p>

              {showingScan && scanId && (
                <p className='break-all font-mono text-xs text-muted-foreground'>
                  Scan: {scanId}
                </p>
              )}
            </div>

            <div className='flex flex-wrap gap-2'>
              <Button
                variant={
                  showingScan
                    ? 'default'
                    : 'outline'
                }
                disabled={!scanSummary}
                onClick={() => setDisplayMode('scan')}
              >
                Latest inference
              </Button>

              <Button
                variant={
                  !showingScan
                    ? 'default'
                    : 'outline'
                }
                disabled={!snapshot}
                onClick={() => setDisplayMode('snapshot')}
              >
                Demo snapshot
              </Button>
            </div>
          </CardContent>
        </Card>

        {loading && (
          <div
            role='status'
            className='flex items-center gap-2 rounded-lg border p-5 text-sm text-muted-foreground'
          >
            <LoaderCircle className='size-4 animate-spin' />
            Loading operational metrics...
          </div>
        )}

        {error && (
          <div
            role='alert'
            className='rounded-lg border border-destructive/40 p-4 text-sm text-destructive'
          >
            {error}
          </div>
        )}

        {notice && (
          <div className='rounded-lg border p-4 text-sm text-muted-foreground'>
            {notice}
          </div>
        )}

        {metrics && (
          <>
            {/* Primary metrics */}

            <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
              <MetricCard
                title='Monitored Accounts'
                value={formatCount(metrics.account_count)}
                description='Accounts included in this dataset'
                icon={Users}
              />

              <MetricCard
                title='Flagged Accounts'
                value={formatCount(metrics.alerted_accounts)}
                description='Accounts with at least one operational alert'
                icon={Flag}
              />

              <MetricCard
                title='Alerted Account Rate'
                value={formatPercent(
                  metrics.alerted_accounts,
                  metrics.account_count
                )}
                description='Share of monitored accounts with alerts'
                icon={ClipboardList}
              />
            </div>

            {/* Risk category metrics */}

            <div>
              <div className='mb-4'>
                <h2 className='text-lg font-semibold'>
                  Risk Detection Summary
                </h2>

                <p className='text-sm text-muted-foreground'>
                  Operational alerts from the three trained
                  LightGBM classifiers
                </p>
              </div>

              <div className='grid gap-4 lg:grid-cols-3'>
                <RiskCard
                  name='Fraud'
                  model={
                    operationalModels?.fraud ?? 'Fraud V3'
                  }
                  count={metrics.alert_counts.fraud}
                  total={metrics.account_count}
                />

                <RiskCard
                  name='Anti-Money Laundering'
                  model={
                    operationalModels?.aml ?? 'AML Context V2'
                  }
                  count={metrics.alert_counts.aml}
                  total={metrics.account_count}
                />

                <RiskCard
                  name='Player Protection'
                  model={
                    operationalModels?.protection ??
                    'Protection Context V2'
                  }
                  count={metrics.alert_counts.protection}
                  total={metrics.account_count}
                />
              </div>
            </div>

            {/* Alert distribution chart */}

            <Card>
              <CardHeader>
                <CardTitle>
                  Alert Distribution
                </CardTitle>

                <CardDescription>
                  Number of accounts triggering each operational
                  risk category. An account may appear in multiple
                  categories.
                </CardDescription>
              </CardHeader>

              <CardContent>
                <div className='h-[300px] w-full'>
                  <ResponsiveContainer
                    width='100%'
                    height='100%'
                  >
                    <BarChart
                      data={chartData}
                      layout='vertical'
                      margin={{
                        top: 10,
                        right: 25,
                        left: 15,
                        bottom: 10,
                      }}
                    >
                      <CartesianGrid
                        strokeDasharray='3 3'
                        horizontal={false}
                        opacity={0.2}
                      />

                      <XAxis
                        type='number'
                        allowDecimals={false}
                      />

                      <YAxis
                        type='category'
                        dataKey='name'
                        width={90}
                      />

                      <Tooltip />

                      <Bar
                        dataKey='alerts'
                        name='Alerts'
                        fill='var(--primary)'
                        radius={[0, 4, 4, 0]}
                        maxBarSize={45}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Preview from selected inference scan */}

            {showingScan && (
              <Card>
                <CardHeader>
                  <CardTitle>
                    Recent Inference Results
                  </CardTitle>

                  <CardDescription>
                    Preview of the first {predictions.length}
                    {' '}accounts returned by the scan.
                    These rows are not ranked by priority.
                  </CardDescription>
                </CardHeader>

                <CardContent>
                  <div className='overflow-x-auto'>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Account</TableHead>
                          <TableHead>Fraud</TableHead>
                          <TableHead>AML</TableHead>
                          <TableHead>Protection</TableHead>
                          <TableHead>Alerts</TableHead>
                          <TableHead>Priority</TableHead>
                        </TableRow>
                      </TableHeader>

                      <TableBody>
                        {predictions.map((row) => (
                          <TableRow key={row.account_id}>
                            <TableCell className='font-mono font-medium'>
                              {row.account_id}
                            </TableCell>

                            <TableCell>
                              <ScoreCell
                                score={row.fraud_score}
                                alert={row.fraud_alert}
                              />
                            </TableCell>

                            <TableCell>
                              <ScoreCell
                                score={row.aml_score}
                                alert={row.aml_alert}
                              />
                            </TableCell>

                            <TableCell>
                              <ScoreCell
                                score={row.protection_score}
                                alert={row.protection_alert}
                              />
                            </TableCell>

                            <TableCell>
                              {row.alert_count > 0 ? (
                                <Badge variant='destructive'>
                                  {row.alert_count}
                                </Badge>
                              ) : (
                                <Badge variant='secondary'>
                                  0
                                </Badge>
                              )}
                            </TableCell>

                            <TableCell className='font-mono text-xs'>
                              {row.priority_score.toFixed(2)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>

                    {predictions.length === 0 && (
                      <p className='py-8 text-center text-sm text-muted-foreground'>
                        No prediction preview is available.
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Workflow card */}

            <Card>
              <CardHeader>
                <CardTitle>
                  Investigation Workflow
                </CardTitle>

                <CardDescription>
                  From uploaded data to human-reviewed decisions
                </CardDescription>
              </CardHeader>

              <CardContent className='grid gap-3 md:grid-cols-4'>
                {[
                  '01 · Data Intake',
                  '02 · Risk Detection',
                  '03 · Investigation',
                  '04 · Human Review',
                ].map((step) => (
                  <div
                    key={step}
                    className='rounded-lg border bg-muted/30 p-4 text-sm font-medium'
                  >
                    {step}
                  </div>
                ))}
              </CardContent>
            </Card>

            <p className='text-xs text-muted-foreground'>
              {metrics.warning ??
                'Model scores are research risk indicators and are not calibrated real-world probabilities.'}
              {' '}Alerts require human review. No automatic
              enforcement action is taken.
            </p>
          </>
        )}
      </Main>
    </>
  )
}
