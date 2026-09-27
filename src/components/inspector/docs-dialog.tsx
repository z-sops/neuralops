'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  Download,
  FileText,
  FolderArchive,
  Loader2,
  ExternalLink,
  BookOpen,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

interface DocsFile {
  name: string
  size: number
}

interface DocsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

// Human-readable label for special files
function fileLabel(name: string): string {
  if (name === 'README.md') return 'Start here'
  if (name === 'NeuralOps-MCP-Full-Summary.md') return 'Complete summary (single file)'
  const m = name.match(/^(\d+)-(.+)\.md$/)
  if (m) return `${m[1]}. ${m[2].replace(/-/g, ' ')}`
  return name.replace(/\.md$/, '').replace(/-/g, ' ')
}

export function DocsDialog({ open, onOpenChange }: DocsDialogProps) {
  const [files, setFiles] = useState<DocsFile[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [content, setContent] = useState<string>('')
  const [loadingContent, setLoadingContent] = useState(false)

  const loadingList = open && files === null

  // Load one file's content (called from click handlers and after the list loads).
  const selectFile = useCallback(async (name: string) => {
    setSelected(name)
    setLoadingContent(true)
    setContent('')
    try {
      const res = await fetch(`/api/download?file=${encodeURIComponent(name)}`)
      if (!res.ok) throw new Error('Failed to fetch')
      setContent(await res.text())
    } catch {
      toast.error(`Could not load ${name}`)
    } finally {
      setLoadingContent(false)
    }
  }, [])

  // Fetch the file list the first time the dialog opens.
  useEffect(() => {
    if (!open || files !== null) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/download?list=1')
        const data = await res.json()
        if (cancelled) return
        // Sort: README first, then numbered, then Full-Summary, then others
        const sorted = ((data.files ?? []) as DocsFile[]).sort((a, b) => {
          if (a.name === 'README.md') return -1
          if (b.name === 'README.md') return 1
          if (a.name === 'NeuralOps-MCP-Full-Summary.md') return 1
          if (b.name === 'NeuralOps-MCP-Full-Summary.md') return -1
          return a.name.localeCompare(b.name)
        })
        setFiles(sorted)
        if (sorted.length > 0) void selectFile(sorted[0].name)
      } catch {
        if (!cancelled) {
          setFiles([])
          toast.error('Could not load docs file list')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, files, selectFile])

  const downloadZip = () => {
    // Direct browser download of the zip
    const a = document.createElement('a')
    a.href = '/api/download'
    a.download = 'NeuralOps-MCP.zip'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    toast.success('Downloading NeuralOps-MCP.zip')
  }

  const downloadCurrentFile = () => {
    if (!selected) return
    const a = document.createElement('a')
    a.href = `/api/download?file=${encodeURIComponent(selected)}`
    a.download = selected
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    toast.success(`Downloading ${selected}`)
  }

  const openInNewTab = () => {
    if (!selected) return
    window.open(`/api/download?file=${encodeURIComponent(selected)}`, '_blank')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[85vh] w-full max-w-5xl flex-col gap-0 p-0 sm:max-w-5xl"
      >
        <DialogHeader className="border-b border-border/60 px-5 py-3.5">
          <DialogTitle className="flex items-center gap-2 text-base">
            <BookOpen className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
            NeuralOps MCP — Documentation
          </DialogTitle>
          <DialogDescription className="text-xs">
            Browse the complete product summary. Download individual files or the full package as a ZIP.
          </DialogDescription>
        </DialogHeader>

        {/* Action bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-muted/30 px-5 py-2.5">
          <div className="flex items-center gap-2 text-[11px] font-mono text-muted-foreground">
            <span>{(files ?? []).length} files</span>
            <span aria-hidden>·</span>
            <span>{(files ?? []).reduce((s, f) => s + f.size, 0) > 0 ? formatBytes((files ?? []).reduce((s, f) => s + f.size, 0)) : '—'}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={openInNewTab}
              disabled={!selected}
              className="gap-1.5"
            >
              <ExternalLink className="size-3.5" aria-hidden />
              <span className="hidden sm:inline">Open in tab</span>
              <span className="sm:hidden">Tab</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={downloadCurrentFile}
              disabled={!selected}
              className="gap-1.5"
            >
              <FileText className="size-3.5" aria-hidden />
              <span className="hidden sm:inline">Download file</span>
              <span className="sm:hidden">File</span>
            </Button>
            <Button
              size="sm"
              onClick={downloadZip}
              className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-600"
            >
              <FolderArchive className="size-3.5" aria-hidden />
              <span className="hidden sm:inline">Download ZIP</span>
              <span className="sm:hidden">ZIP</span>
            </Button>
          </div>
        </div>

        {/* Body: file list + content viewer */}
        <div className="flex flex-1 min-h-0 flex-col sm:flex-row">
          {/* File list */}
          <div className="border-b border-border/60 sm:border-b-0 sm:border-r sm:w-64 sm:flex-shrink-0">
            <div className="flex items-center justify-between px-4 py-2 border-b border-border/40">
              <span className="text-[11px] font-mono uppercase tracking-wide text-muted-foreground">
                Files
              </span>
              {loadingList && (
                <Loader2 className="size-3 animate-spin text-muted-foreground" />
              )}
            </div>
            <ScrollArea className="h-48 sm:h-[calc(85vh-180px)]">
              <ul className="py-1">
                {(files ?? []).map((f) => (
                  <li key={f.name}>
                    <button
                      onClick={() => void selectFile(f.name)}
                      className={cn(
                        'flex w-full items-start gap-2 px-3 py-1.5 text-left text-[12px] transition-colors',
                        'hover:bg-accent/50',
                        selected === f.name
                          ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                          : 'text-foreground/80'
                      )}
                    >
                      <FileText
                        className={cn(
                          'mt-0.5 size-3.5 flex-shrink-0',
                          selected === f.name
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-muted-foreground'
                        )}
                        aria-hidden
                      />
                      <span className="flex-1 min-w-0">
                        <span className="block truncate font-medium">
                          {fileLabel(f.name)}
                        </span>
                        <span className="block truncate font-mono text-[10px] text-muted-foreground">
                          {f.name} · {formatBytes(f.size)}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </ScrollArea>
          </div>

          {/* Content viewer */}
          <div className="flex-1 min-w-0 bg-muted/10">
            <div className="flex items-center justify-between border-b border-border/40 px-4 py-2">
              <span className="truncate font-mono text-[11px] text-muted-foreground">
                {selected || 'No file selected'}
              </span>
              {loadingContent && (
                <Loader2 className="size-3 animate-spin text-muted-foreground" />
              )}
            </div>
            <ScrollArea className="h-[calc(85vh-225px)] sm:h-[calc(85vh-180px)]">
              <pre className="whitespace-pre-wrap break-words p-4 font-mono text-[11.5px] leading-relaxed text-foreground/90">
                {content || (loadingContent ? 'Loading…' : 'Select a file to view its content.')}
              </pre>
            </ScrollArea>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
