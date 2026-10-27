import { useEffect, useMemo, useState } from 'react'
import { Braces, Check, Download, FileJson, RotateCcw, Save, Search, ShieldCheck } from 'lucide-react'
import { JsonUploader } from './components/JsonUploader'
import { JsonNode } from './components/JsonNode'
import type { JsonPath, JsonValue } from './types'
import {
  MAX_FILE_SIZE,
  addArrayItem,
  addObjectField,
  downloadName,
  formatBytes,
  getJsonStats,
  moveArrayItem,
  parseJsonText,
  removeAtPath,
  updateAtPath,
  validateJsonTree,
} from './lib/json'

interface DocumentState {
  filename: string
  size: number
  original: JsonValue
  working: JsonValue
}

export default function App() {
  const [document, setDocument] = useState<DocumentState | null>(null)
  const [savedJson, setSavedJson] = useState<string | null>(null)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null)
  const [query, setQuery] = useState('')
  const [showPreview, setShowPreview] = useState(false)

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges) return
      event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [hasUnsavedChanges])

  const loadFile = async (file: File) => {
    if (document && hasUnsavedChanges && !window.confirm('Replace this file and discard your unsaved changes?')) return
    setMessage(null)
    if (!file.name.toLocaleLowerCase().endsWith('.json')) return setMessage({ kind: 'error', text: 'Choose a file with the .json extension.' })
    if (file.size > MAX_FILE_SIZE) return setMessage({ kind: 'error', text: 'This file is larger than the 5 MB limit.' })
    setBusy(true)
    try {
      const data = parseJsonText(await file.text())
      setDocument({ filename: file.name, size: file.size, original: data, working: data })
      setSavedJson(null)
      setHasUnsavedChanges(false)
      setQuery('')
      setShowPreview(false)
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Could not read this JSON file.' })
    } finally {
      setBusy(false)
    }
  }

  const edit = (updater: (value: JsonValue) => JsonValue) => {
    setDocument((current) => current ? { ...current, working: updater(current.working) } : current)
    setHasUnsavedChanges(true)
    setMessage(null)
  }

  const save = () => {
    if (!document) return
    try {
      validateJsonTree(document.working)
      setSavedJson(JSON.stringify(document.working, null, 2))
      setHasUnsavedChanges(false)
      setMessage({ kind: 'success', text: 'Changes saved. Your updated JSON is ready to download.' })
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'The JSON could not be saved.' })
    }
  }

  const reset = () => {
    if (!document || (hasUnsavedChanges && !window.confirm('Discard all changes and restore the uploaded file?'))) return
    const differsFromSaved = savedJson !== null && savedJson !== JSON.stringify(document.original, null, 2)
    setDocument({ ...document, working: document.original })
    setHasUnsavedChanges(differsFromSaved)
    setMessage(null)
  }

  const download = () => {
    if (!document || !savedJson || hasUnsavedChanges) return
    const url = URL.createObjectURL(new Blob([savedJson], { type: 'application/json' }))
    const link = window.document.createElement('a')
    link.href = url
    link.download = downloadName(document.filename)
    link.click()
    URL.revokeObjectURL(url)
  }

  const stats = useMemo(() => document ? getJsonStats(document.working) : null, [document])
  const preview = useMemo(() => document ? JSON.stringify(document.working, null, 2) : '', [document])

  if (!document) {
    return (
      <>
        <JsonUploader onFile={loadFile} busy={busy} />
        {message && <div className="toast toast-error" role="alert">{message.text}</div>}
      </>
    )
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-brand"><span className="brand-mark small"><Braces size={20} aria-hidden="true" /></span><span>JSON Studio</span></div>
        <div className="header-actions">
          <JsonUploader compact onFile={loadFile} busy={busy} />
          <button className="button button-secondary" type="button" onClick={reset} disabled={!hasUnsavedChanges}><RotateCcw size={16} aria-hidden="true" /> Reset</button>
          <button className="button button-primary" type="button" onClick={save} disabled={!hasUnsavedChanges && savedJson !== null}><Save size={16} aria-hidden="true" /> Save changes</button>
          <button className="button button-dark" type="button" onClick={download} disabled={!savedJson || hasUnsavedChanges} title={hasUnsavedChanges ? 'Save your latest changes before downloading' : undefined}><Download size={16} aria-hidden="true" /> Download JSON</button>
        </div>
      </header>

      <main className="editor-layout">
        <aside className="editor-sidebar">
          <div className="file-card">
            <span className="file-icon"><FileJson size={22} aria-hidden="true" /></span>
            <div><strong>{document.filename}</strong><span>{formatBytes(document.size)}</span></div>
            <span className={`status-dot ${hasUnsavedChanges ? 'dirty' : 'clean'}`} title={hasUnsavedChanges ? 'Unsaved changes' : 'No unsaved changes'} />
          </div>
          <label className="search-box"><Search size={16} aria-hidden="true" /><span className="sr-only">Search JSON</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search keys or values…" /></label>
          <section className="stats-card" aria-label="JSON statistics">
            <h2>Document overview</h2>
            <dl>
              <div><dt>Properties</dt><dd>{stats?.properties}</dd></div>
              <div><dt>Objects</dt><dd>{stats?.objects}</dd></div>
              <div><dt>Arrays</dt><dd>{stats?.arrays}</dd></div>
              <div><dt>Max depth</dt><dd>{stats?.depth}</dd></div>
            </dl>
          </section>
          <div className="local-note"><ShieldCheck size={17} aria-hidden="true" /><p><strong>Local editing</strong><span>Your data never leaves this device.</span></p></div>
        </aside>

        <section className="editor-workspace" aria-labelledby="editor-title">
          <div className="workspace-heading">
            <div><span className="eyebrow">Dynamic tree editor</span><h1 id="editor-title">Edit JSON</h1><p>Change values, types, and structure. Save when you’re ready.</p></div>
            <button className="button button-secondary" type="button" onClick={() => setShowPreview((current) => !current)}>{showPreview ? 'Hide' : 'Show'} JSON preview</button>
          </div>

          {message && <div className={`inline-message ${message.kind}`} role={message.kind === 'error' ? 'alert' : 'status'}>{message.kind === 'success' && <Check size={17} aria-hidden="true" />}{message.text}</div>}
          {hasUnsavedChanges && <div className="unsaved-banner"><span /> Unsaved changes</div>}

          <div className={`workspace-grid ${showPreview ? 'with-preview' : ''}`}>
            <div className="tree-panel">
              <JsonNode
                root
                label="Root"
                value={document.working}
                path={[]}
                query={query}
                onChange={(path: JsonPath, value: JsonValue) => edit((root) => updateAtPath(root, path, value))}
                onRemove={(path: JsonPath) => edit((root) => removeAtPath(root, path))}
                onAddObject={(path: JsonPath, key: string, value: JsonValue) => edit((root) => addObjectField(root, path, key, value))}
                onAddArray={(path: JsonPath, value: JsonValue) => edit((root) => addArrayItem(root, path, value))}
                onMove={(path: JsonPath, from: number, to: number) => edit((root) => moveArrayItem(root, path, from, to))}
              />
            </div>
            {showPreview && <aside className="preview-panel"><div className="preview-heading"><strong>Live preview</strong><span>{hasUnsavedChanges ? 'Unsaved' : savedJson ? 'Saved' : 'Original'}</span></div><pre><code>{preview}</code></pre></aside>}
          </div>
        </section>
      </main>
    </div>
  )
}
