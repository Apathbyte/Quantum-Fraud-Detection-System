
import { useEffect, useState } from 'react'
import { ShieldCheck, Users, Flag, ClipboardList, Activity } from 'lucide-react'

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
import { Badge } from '@/components/ui/badge'

type DashboardManifest = {
  status: string
  account_count: number
  unique_alerted_accounts: number
  queue_limit: number
  dataset: string
  alert_counts: {
    fraud: number
    aml: number
    protection: number
  }
  operational_models: {
    fraud: string
    aml: string
    protection: string
  }
  thresholds: {
    fraud: number
    aml: number
    protection: number
  }
  warning: string
}

export function Dashboard() {
  const [manifest, setManifest] = useState<DashboardManifest | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    async function loadManifest() {
      try {
        const response = await fetch('/demo/dashboard_manifest.json', {
          signal: controller.signal,
          cache: 'no-store',
        })

        if (!response.ok) {
          throw new Error(`Manifest request failed: ${response.status}`)
        }

        const data: DashboardManifest = await response.json()

        if (data.status !== 'PASSED') {
          throw new Error('Dashboard manifest validation status is not PASSED')
        }

        setManifest(data)
      } catch (err) {
        if (controller.signal.aborted) return
        setError(err instanceof Error ? err.message : 'Unable to load data')
      }
    }

    void loadManifest()

    return () => controller.abort()
  }, [])

  const stats = manifest
    ? [
        {
          label: 'Monitored accounts',
          value: manifest.account_count,
          icon: Users,
        },
        {
          label: 'Flagged accounts',
          value: manifest.unique_alerted_accounts,
          icon: Flag,
        },
        {
          label: 'Investigation queue',
          value: manifest.queue_limit,
          icon: ClipboardList,
        },
      ]
    : []

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
        <div className='flex flex-wrap items-start justify-between gap-3'>
          <div>
            <p className='mb-1 text-xs font-medium uppercase tracking-widest text-muted-foreground'>
              Investigation Workspace / Overview
            </p>
            <h1 className='text-3xl font-bold tracking-tight'>
              Command Centre
            </h1>
            <p className='mt-2 text-sm text-muted-foreground'>
              Operational fraud, AML, and player protection monitoring.
            </p>
          </div>
          <Badge variant='outline'>
            Synthetic demonstration
          </Badge>
        </div>

        {error && (
          <Card>
            <CardContent>
              <p role='alert' className='text-sm text-destructive'>
                {error}
              </p>
            </CardContent>
          </Card>
        )}

        {!manifest && !error && (
          <p role='status' className='text-sm text-muted-foreground'>
            Loading Q-Guard dashboard snapshot...
          </p>
        )}

        <div className='grid gap-4 md:grid-cols-3'>
          {stats.map(({ label, value, icon: Icon }) => (
            <Card key={label}>
              <CardHeader className='flex flex-row items-center justify-between'>
                <CardTitle className='text-sm font-medium'>
                  {label}
                </CardTitle>
                <Icon className='size-4 text-muted-foreground' />
              </CardHeader>
              <CardContent>
                <div className='text-3xl font-bold tabular-nums'>
                  {value.toLocaleString()}
                </div>
                <p className='mt-2 text-xs text-muted-foreground'>
                  Prepared retrospective dataset
                </p>
              </CardContent>
            </Card>
          ))}
        </div>

        {manifest && (
          <>
            <div className='grid gap-4 lg:grid-cols-3'>
              {([
                ['Fraud', 'fraud'],
                ['AML', 'aml'],
                ['Player protection', 'protection'],
              ] as const).map(([label, key]) => (
                <Card key={key}>
                  <CardHeader>
                    <CardTitle className='flex items-center gap-2'>
                      <Activity className='size-4' />
                      {label}
                    </CardTitle>
                    <CardDescription>
                      {manifest.operational_models[key]}
                    </CardDescription>
                  </CardHeader>

                  <CardContent className='space-y-3'>
                    <div className='text-3xl font-bold tabular-nums'>
                      {manifest.alert_counts[key].toLocaleString()}
                    </div>
                    <p className='text-sm text-muted-foreground'>
                      Accounts triggering this alert category
                    </p>
                    <div className='border-t pt-3 text-xs text-muted-foreground'>
                      Validated alert threshold:{' '}
                      {manifest.thresholds[key].toFixed(4)}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Detection workflow</CardTitle>
                <CardDescription>
                  From operational alerts to investigator decisions
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className='grid gap-3 md:grid-cols-4'>
                  {[
                    '01 · Data intake',
                    '02 · Risk detection',
                    '03 · Investigation queue',
                    '04 · Human review',
                  ].map((step) => (
                    <div
                      key={step}
                      className='rounded-lg border bg-muted/30 p-4 text-sm font-medium'
                    >
                      {step}
                    </div>
                  ))}
                </div>

                <p className='mt-5 text-xs text-muted-foreground'>
                  {manifest.warning}
                </p>
              </CardContent>
            </Card>
          </>
        )}
      </Main>
    </>
  )
}
