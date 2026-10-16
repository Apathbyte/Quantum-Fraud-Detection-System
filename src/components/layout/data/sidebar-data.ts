
import {
  ShieldCheck,
  LayoutDashboard,
  ListFilter,
  UserRound,
  ChartNoAxesCombined,
  Network,
  Database,
  ClipboardCheck,
  Palette,
} from 'lucide-react'

import { type SidebarData } from '../types'

export const sidebarData: SidebarData = {
  user: {
    name: 'Demo Investigator',
    email: 'Local demonstration',
    avatar: '',
  },

  teams: [
    {
      name: 'Q-Guard',
      logo: ShieldCheck,
      plan: 'Investigation Platform',
    },
  ],

  navGroups: [
    {
      title: 'Investigation',
      items: [
        {
          title: 'Command Centre',
          url: '/',
          icon: LayoutDashboard,
        },
        {
          title: 'Investigation Queue',
          url: '/cases',
          icon: ListFilter,
        },
        {
          title: 'Account 360°',
          url: '/account-360',
          icon: UserRound,
        },
        {
          title: 'Historical Context',
          url: '/historical-context',
          icon: ChartNoAxesCombined,
        },
        {
          title: 'Relationship Explorer',
          url: '/relationships',
          icon: Network,
        },
      ],
    },
    {
      title: 'Operations',
      items: [
        {
          title: 'Data Intake',
          url: '/data-intake',
          icon: Database,
        },
        {
          title: 'Decisions & Audit',
          url: '/decisions',
          icon: ClipboardCheck,
        },
      ],
    },
    {
      title: 'Preferences',
      items: [
        {
          title: 'Appearance',
          url: '/settings/appearance',
          icon: Palette,
        },
      ],
    },
  ],
}
