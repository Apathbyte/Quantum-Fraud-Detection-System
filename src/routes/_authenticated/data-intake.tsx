
import { useEffect, useState, type ChangeEvent } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  LoaderCircle,
  ShieldCheck,
  UploadCloud,
} from 'lucide-react'

import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ThemeSwitch } from '@/components/theme-switch'
import { ConfigDrawer } from '@/components/config-drawer'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/card'
import {
  Alert,
  AlertTitle,
  AlertDescription,
} from '@/components/ui/alert'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'

// ============================================================
// API response types
// ============================================================

type RiskCategory = 'fraud' | 'aml' | 'protection'

type DatasetResponse = {
  id: string
  filename: string
  status: string
  file_size: number
  sha256: string
  row_count: number
  columns: string[]
  detected_format: string
  ready_for_inference: boolean
  message: string
}

type ScanStart = {
  scan_id: string
  status: string
  status_url: string
}

type ScanSummary = {
  scan_id: string
  dataset_id: string
  status: string
  source: string
  account_count: number
  alerted_accounts: number
  alert_counts: Record<RiskCategory, number>
  priority_policy: string
  warning: string
}

type ScanStatus = {
  id: string
  dataset_id: string
  status: string
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

type PredictionResults = {
  scan_id: string
  rows: Prediction[]
}

type Phase =
  | 'idle'
  | 'uploading'
  | 'starting'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'

// ============================================================
// API helper
// ============================================================

function describeError(data: unknown, status: number): string {
  if (data && typeof data === 'object' && 'detail' in data) {
    const detail = data.detail

    if (typeof detail === 'string') return detail

    if (detail && typeof detail === 'object') {
      const info = detail as {
        message?: string
        first_missing?: string[]
        missing_count?: number
      }

      if (info.message) {
        const missing = info.first_missing?.length
          ? ` Missing features: ${info.first_missing.join(', ')}`
          : ''

        return info.message + missing
      }
    }
  }

  return `Request failed (HTTP ${status}).`
}

async function apiRequest<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const response = await fetch(endpoint, options)

  const contentType = response.headers.get('content-type') ?? ''

  if (!contentType.includes('application/json')) {
    throw new Error(
      'The server returned a non-JSON response. ' +
        'Check that FastAPI is running and the Vite /api proxy is configured.'
    )
  }

  const result: unknown = await response.json()

  if (!response.ok) {
    throw new Error(describeError(result, response.status))
  }

  return result as T
}

async function uploadCsv(file: File): Promise<DatasetResponse> {
  const form = new FormData()
  form.append('file', file)

  return apiRequest<DatasetResponse>('/api/datasets', {
    method: 'POST',
    body: form,
  })
}

async function createScan(datasetId: string): Promise<ScanStart> {
  return apiRequest<ScanStart>('/api/scans', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      dataset_id: datasetId,
    }),
  })
}

async function fetchScan(
  scanId: string,
  signal: AbortSignal
): Promise<ScanStatus> {
  return apiRequest<ScanStatus>(
    `/api/scans/${encodeURIComponent(scanId)}`,
    { signal }
  )
}

async function fetchPredictions(
  scanId: string,
  signal: AbortSignal
): Promise<PredictionResults> {
  return apiRequest<PredictionResults>(
    `/api/scans/${encodeURIComponent(scanId)}/results?limit=20`,
    { signal }
  )
}

// ============================================================
// Formatting
// ============================================================

const formatter = new Intl.NumberFormat('en-CA')

function Score({
  value,
  alert,
}: {
  value: number
  alert: boolean
}) {
  return (
    <div className='flex items-center gap-2'>
      <span className='font-mono tabular-nums'>
        {value.toFixed(5)}
      </span>

      {alert && (
        <Badge variant='destructive'>Alert</Badge>
      )}
    </div>
  )
}

// ============================================================
// Main Data Intake page
// ============================================================

function DataIntakePage() {
  const [file, setFile] = useState<File | null>(null)
  const [dataset, setDataset] =
    useState<DatasetResponse | null>(null)

  const [scanId, setScanId] = useState<string | null>(null)
  const [summary, setSummary] =
    useState<ScanSummary | null>(null)

  const [predictions, setPredictions] = useState<Prediction[]>([])
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)

  const processing = (
    ['uploading', 'starting', 'queued', 'running'] as Phase[]
  ).includes(phase)

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null

    setFile(selected)
    setDataset(null)
    setScanId(null)
    setSummary(null)
    setPredictions([])
    setError(null)
    setPhase('idle')
  }

  async function handleRunRiskScan() {
    if (!file || processing) return

    if (!file.name.toLowerCase().endsWith('.csv')) {
      setError('Please select a CSV file.')
      return
    }

    if (file.size > 100 * 1024 * 1024) {
      setError('The maximum supported file size is 100 MiB.')
      return
    }

    try {
      setError(null)
      setDataset(null)
      setScanId(null)
      setSummary(null)
      setPredictions([])

      // Phase 1: Upload the CSV to FastAPI.
      setPhase('uploading')

      const uploaded = await uploadCsv(file)
      setDataset(uploaded)

      // Phase 2: Create an inference job.
      // The backend checks all required model features.
      setPhase('starting')

      const scan = await createScan(uploaded.id)

      // Phase 3: Poll the backend until inference completes.
      setScanId(scan.scan_id)
      setPhase('queued')
    } catch (err) {
      setPhase('failed')
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to start the risk scan.'
      )
    }
  }

  // ==========================================================
  // Poll FastAPI for scan completion
  // ==========================================================

  useEffect(() => {
    if (!scanId) return

    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined

    async function poll() {
      if (!scanId) return

      try {
        const status = await fetchScan(scanId, controller.signal)

        if (controller.signal.aborted) return

        if (
          status.status === 'failed' ||
          status.status === 'interrupted'
        ) {
          setPhase('failed')
          setError(status.error ?? 'Model inference failed.')
          return
        }

        if (status.status === 'completed') {
          if (!status.summary) {
            throw new Error(
              'The scan completed, but its summary is unavailable.'
            )
          }

          const result = await fetchPredictions(
            scanId,
            controller.signal
          )

          if (controller.signal.aborted) return

          setSummary(status.summary)
          setPredictions(result.rows)
          setPhase('completed')

          // Used by the Command Centre in the next milestone.
          localStorage.setItem('qguard:selected-scan', scanId)

          return
        }

        setPhase(
          status.status === 'running' ? 'running' : 'queued'
        )

        timer = setTimeout(() => {
          void poll()
        }, 1200)
      } catch (err) {
        if (controller.signal.aborted) return

        setPhase('failed')
        setError(
          err instanceof Error
            ? err.message
            : 'Unable to retrieve inference results.'
        )
      }
    }

    void poll()

    return () => {
      controller.abort()
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [scanId])

  const phaseLabel: Record<Phase, string> = {
    idle: 'Ready for upload',
    uploading: 'Uploading and validating CSV',
    starting: 'Preparing inference job',
    queued: 'Waiting for inference',
    running: 'Running trained models',
    completed: 'Inference completed',
    failed: 'Processing failed',
  }

  return (
    <>
      <Header>
        <div className='me-auto flex items-center gap-2'>
          <ShieldCheck className='size-5' />
          <span className='font-semibold'>Q-Guard Operations</span>
        </div>
        <ThemeSwitch />
        <ConfigDrawer />
      </Header>

      <Main className='space-y-6'>
        {/* PAGE HEADING */}
        <div>
          <p className='text-xs font-medium uppercase tracking-widest text-muted-foreground'>
            Operations / Data Intake
          </p>

          <h1 className='mt-2 text-3xl font-bold tracking-tight'>
            Data Intake & Risk Scan
          </h1>

          <p className='mt-2 text-sm text-muted-foreground'>
            Upload account features, execute the trained detection
            models, and review the generated risk assessments.
          </p>
        </div>

        {/* INPUT REQUIREMENTS */}
        <Alert>
          <ShieldCheck />
          <AlertTitle>Operational inference</AlertTitle>
          <AlertDescription>
            The backend runs Fraud V3, AML Context V2 and
            Protection Context V2 using LightGBM. Upload a
            prepared account-feature CSV with the 63 required
            columns. Raw transaction events are not yet supported
            for direct inference.
          </AlertDescription>
        </Alert>

        {/* UPLOAD CARD */}
        <Card>
          <CardHeader>
            <CardTitle className='flex items-center gap-2'>
              <UploadCloud className='size-5' />
              Upload Dataset
            </CardTitle>

            <CardDescription>
              Select a CSV to validate and process using
              the Q-Guard Python inference backend.
            </CardDescription>
          </CardHeader>

          <CardContent className='space-y-5'>
            <div className='space-y-2'>
              <label
                htmlFor='qguard-upload'
                className='text-sm font-medium'
              >
                Account-feature CSV
              </label>

              <Input
                id='qguard-upload'
                type='file'
                accept='.csv,text/csv'
                disabled={processing}
                onChange={onFileChange}
              />

              <p className='text-xs text-muted-foreground'>
                Maximum file size: 100 MiB.
              </p>
            </div>

            {file && (
              <div className='flex items-center gap-3 rounded-lg border p-4'>
                <FileSpreadsheet className='size-6 text-muted-foreground' />

                <div className='min-w-0'>
                  <p className='truncate font-medium'>
                    {file.name}
                  </p>
                  <p className='text-xs text-muted-foreground'>
                    {(file.size / 1024).toFixed(1)} KiB
                  </p>
                </div>

                <Badge variant='outline' className='ms-auto'>
                  CSV
                </Badge>
              </div>
            )}

            {/* PRIMARY ACTION */}
            <Button
              size='lg'
              type='button'
              disabled={!file || processing}
              onClick={() => void handleRunRiskScan()}
            >
              {processing ? (
                <LoaderCircle className='size-4 animate-spin' />
              ) : (
                <ShieldCheck className='size-4' />
              )}

              {processing
                ? phaseLabel[phase]
                : 'Upload & Run Risk Scan'}
            </Button>

            {error && (
              <Alert variant='destructive'>
                <AlertTriangle />
                <AlertTitle>Unable to process dataset</AlertTitle>
                <AlertDescription>
                  {error}
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        {/* DATASET VALIDATION */}
        {dataset && (
          <Card>
            <CardHeader>
              <CardTitle>Dataset Validation</CardTitle>
              <CardDescription>
                File received and registered by FastAPI.
              </CardDescription>
            </CardHeader>

            <CardContent className='grid gap-4 sm:grid-cols-2'>
              <div>
                <p className='text-xs text-muted-foreground'>
                  Records
                </p>
                <p className='text-2xl font-bold'>
                  {formatter.format(dataset.row_count)}
                </p>
              </div>

              <div>
                <p className='text-xs text-muted-foreground'>
                  Columns
                </p>
                <p className='text-2xl font-bold'>
                  {dataset.columns.length}
                </p>
              </div>

              <div>
                <p className='text-xs text-muted-foreground'>
                  Detected schema
                </p>
                <p className='text-sm font-medium'>
                  {dataset.detected_format}
                </p>
              </div>

              <div>
                <p className='text-xs text-muted-foreground'>
                  Validation
                </p>
                <Badge variant='secondary'>
                  {dataset.status}
                </Badge>
              </div>

              <div className='sm:col-span-2'>
                <p className='text-xs text-muted-foreground'>
                  SHA-256 file fingerprint
                </p>
                <p className='break-all font-mono text-xs'>
                  {dataset.sha256}
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* INFERENCE STATUS */}
        {scanId && (
          <Card>
            <CardHeader>
              <div className='flex flex-wrap items-center justify-between gap-3'>
                <CardTitle>Inference Status</CardTitle>
                <Badge
                  variant={
                    phase === 'failed'
                      ? 'destructive'
                      : phase === 'completed'
                        ? 'default'
                        : 'secondary'
                  }
                >
                  {phaseLabel[phase]}
                </Badge>
              </div>

              <CardDescription>
                Scan ID: {scanId}
              </CardDescription>
            </CardHeader>

            <CardContent>
              <div role='status' className='flex items-center gap-3'>
                {processing && (
                  <LoaderCircle className='size-5 animate-spin' />
                )}

                {phase === 'completed' && (
                  <CheckCircle2 className='size-5 text-primary' />
                )}

                <p className='text-sm'>
                  {phase === 'completed'
                    ? 'All three LightGBM models completed inference.'
                    : phase === 'failed'
                      ? 'The scan did not complete.'
                      : 'Processing your uploaded dataset...'}
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* SUMMARY */}
        {summary && (
          <>
            <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-5'>
              {[
                {
                  label: 'Scored Accounts',
                  value: summary.account_count,
                },
                {
                  label: 'Flagged Accounts',
                  value: summary.alerted_accounts,
                },
                {
                  label: 'Fraud Alerts',
                  value: summary.alert_counts.fraud,
                },
                {
                  label: 'AML Alerts',
                  value: summary.alert_counts.aml,
                },
                {
                  label: 'Protection Alerts',
                  value: summary.alert_counts.protection,
                },
              ].map((item) => (
                <Card key={item.label}>
                  <CardHeader>
                    <CardTitle className='text-sm'>
                      {item.label}
                    </CardTitle>
                  </CardHeader>

                  <CardContent>
                    <div className='text-3xl font-bold tabular-nums'>
                      {formatter.format(item.value)}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* PREDICTION PREVIEW */}
            <Card>
              <CardHeader>
                <CardTitle>Model Predictions</CardTitle>
                <CardDescription>
                  Preview of the first {predictions.length} accounts.
                  Scores come directly from the trained Python models.
                </CardDescription>
              </CardHeader>

              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Account</TableHead>
                      <TableHead>Fraud</TableHead>
                      <TableHead>AML</TableHead>
                      <TableHead>Protection</TableHead>
                      <TableHead>Alerts</TableHead>
                    </TableRow>
                  </TableHeader>

                  <TableBody>
                    {predictions.map((row) => (
                      <TableRow key={row.account_id}>
                        <TableCell className='font-mono font-medium'>
                          {row.account_id}
                        </TableCell>

                        <TableCell>
                          <Score
                            value={row.fraud_score}
                            alert={row.fraud_alert}
                          />
                        </TableCell>

                        <TableCell>
                          <Score
                            value={row.aml_score}
                            alert={row.aml_alert}
                          />
                        </TableCell>

                        <TableCell>
                          <Score
                            value={row.protection_score}
                            alert={row.protection_alert}
                          />
                        </TableCell>

                        <TableCell>{row.alert_count}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <p className='text-xs text-muted-foreground'>
              {summary.warning}
            </p>
          </>
        )}
      </Main>
    </>
  )
}

// ============================================================
// TanStack Router registration
// ============================================================

export const Route = createFileRoute('/_authenticated/data-intake')({
  component: DataIntakePage,
})
