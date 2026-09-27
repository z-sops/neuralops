'use client'

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { ActType, FamiliesResponse } from '@/lib/neuralops-types'
import { hueForActType, hue } from './colors'

interface ActBadgeProps {
  type: ActType
  families?: FamiliesResponse | null
  className?: string
}

// Colored act-type badge — color comes from the act family (six hues).
export function ActBadge({ type, families, className }: ActBadgeProps) {
  const h = hueForActType(type, families)
  return (
    <Badge
      variant="outline"
      className={cn('font-mono text-[10px] uppercase tracking-wide', hue.badge[h], className)}
    >
      {type}
    </Badge>
  )
}

interface StatusDotProps {
  h: keyof typeof hue.dot
  pulse?: boolean
  className?: string
}

export function StatusDot({ h, pulse = false, className }: StatusDotProps) {
  return (
    <span className={cn('relative inline-flex size-2.5', className)}>
      {pulse && (
        <span
          className={cn(
            'absolute inline-flex h-full w-full animate-ping rounded-full opacity-75',
            hue.dot[h],
          )}
        />
      )}
      <span className={cn('relative inline-flex size-2.5 rounded-full', hue.dot[h])} />
    </span>
  )
}
