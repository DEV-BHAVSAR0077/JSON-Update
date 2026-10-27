import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Download, FileJson, RotateCcw, Save, Search, ShieldCheck, X } from 'lucide-react'
import { JsonUploader } from './components/JsonUploader'
import { JsonNode } from './components/JsonNode'
import type { JsonPath, JsonValue, WorkspaceDocument, WorkspaceState } from './types'
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
import { EMPTY_WORKSPACE, loadWorkspace, saveWorkspace } from './lib/workspace'

type Message = { kind: 'error' | 'success'; text: string }
type PersistenceStatus = 'restoring' | 'saving' | 'saved' | 'error'

function createDocumentId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export default function App() {
  const [workspace, setWorkspace] = useState<WorkspaceState>(EMPTY_WORKSPACE)
  const [busy, setBusy] = useState(false)
  const [restoring, setRestoring] = useState(true)
  const [persistenceStatus, setPersistenceStatus] = useState<PersistenceStatus>('restoring')
  const [persistenceDisabled, setPersistenceDisabled] = useState(false)
  const [message, setMessage] = useState<Message | null>(null)
  const [showPreview, setShowPreview] = useState(false)
  const persistenceQueue = useRef<Promise<void>>(Promise.resolve())
  const persistenceVersion = useRef(0)

  const activeDocument = useMemo(
    () => workspace.documents.find((document) => document.id === workspace.activeDocumentId) ?? workspace.documents[0] ?? null,
    [workspace],
  )
  const hasAnyUnsavedChanges = workspace.documents.some((document) => document.isDirty)

  useEffect(() => {
    let mounted = true
    loadWorkspace()
      .then(({ workspace: restored, warning }) => {
        if (!mounted) return
        setWorkspace(restored)
        setPersistenceStatus('saved')
        if (warning) setMessage({ kind: 'error', text: warning })
      })
      .catch((error) => {
        if (!mounted) return
        setPersistenceDisabled(true)
        setPersistenceStatus('error')
        setMessage({ kind: 'error', text: `${error instanceof Error ? error.message : 'Browser storage is unavailable.'} This session will still work, but it cannot be restored after closing the page.` })
      })
      .finally(() => { if (mounted) setRestoring(false) })
    return () => { mounted = false }
  }, [])

  useEffect(() => {
    if (restoring || persistenceDisabled) return
    const version = ++persistenceVersion.current
    setPersistenceStatus('saving')
    persistenceQueue.current = persistenceQueue.current
      .catch(() => undefined)
      .then(() => saveWorkspace(workspace))
    persistenceQueue.current
      .then(() => {
        if (persistenceVersion.current === version) setPersistenceStatus('saved')
      })
      .catch((error) => {
        if (persistenceVersion.current !== version) return
        setPersistenceDisabled(true)
        setPersistenceStatus('error')
        setMessage({ kind: 'error', text: `${error instanceof Error ? error.message : 'Browser persistence failed.'} Your documents remain available in this session only.` })
      })
  }, [persistenceDisabled, restoring, workspace])

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!hasAnyUnsavedChanges) return
      event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [hasAnyUnsavedChanges])

  const updateDocument = (id: string, updater: (document: WorkspaceDocument) => WorkspaceDocument) => {
    setWorkspace((current) => ({
      ...current,
      documents: current.documents.map((document) => document.id === id ? updater(document) : document),
    }))
  }

  const loadFile = async (file: File) => {
    setMessage(null)
    if (!file.name.toLocaleLowerCase().endsWith('.json')) return setMessage({ kind: 'error', text: 'Choose a file with the .json extension.' })
    if (file.size > MAX_FILE_SIZE) return setMessage({ kind: 'error', text: 'This file is larger than the 5 MB limit.' })
    setBusy(true)
    try {
      const data = parseJsonText(await file.text())
      const document: WorkspaceDocument = {
        id: createDocumentId(),
        filename: file.name,
        size: file.size,
        original: data,
        working: data,
        savedJson: null,
        isDirty: false,
        searchQuery: '',
        updatedAt: Date.now(),
      }
      setWorkspace((current) => ({
        version: 1,
        documents: [...current.documents, document],
        activeDocumentId: document.id,
      }))
      setShowPreview(false)
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Could not read this JSON file.' })
    } finally {
      setBusy(false)
    }
  }

  const selectDocument = (id: string) => {
    setWorkspace((current) => ({ ...current, activeDocumentId: id }))
    setMessage(null)
  }

  const removeDocument = (document: WorkspaceDocument) => {
    if (document.isDirty && !window.confirm(`Remove ${document.filename} and discard its unsaved changes?`)) return
    setWorkspace((current) => {
      const index = current.documents.findIndex((item) => item.id === document.id)
      const documents = current.documents.filter((item) => item.id !== document.id)
      const activeDocumentId = current.activeDocumentId === document.id
        ? documents[Math.min(index, documents.length - 1)]?.id ?? null
        : current.activeDocumentId
      return { ...current, documents, activeDocumentId }
    })
    setMessage(null)
  }

  const edit = (updater: (value: JsonValue) => JsonValue) => {
    if (!activeDocument) return
    updateDocument(activeDocument.id, (document) => ({
      ...document,
      working: updater(document.working),
      isDirty: true,
      updatedAt: Date.now(),
    }))
    setMessage(null)
  }

  const save = () => {
    if (!activeDocument) return
    try {
      validateJsonTree(activeDocument.working)
      const savedJson = JSON.stringify(activeDocument.working, null, 2)
      updateDocument(activeDocument.id, (document) => ({ ...document, savedJson, isDirty: false, updatedAt: Date.now() }))
      setMessage({ kind: 'success', text: `${activeDocument.filename} saved. The updated JSON is ready to download.` })
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'The JSON could not be saved.' })
    }
  }

  const reset = () => {
    if (!activeDocument || (activeDocument.isDirty && !window.confirm('Discard all changes and restore the uploaded file?'))) return
    const isDirty = activeDocument.savedJson !== null && activeDocument.savedJson !== JSON.stringify(activeDocument.original, null, 2)
    updateDocument(activeDocument.id, (document) => ({ ...document, working: document.original, isDirty, updatedAt: Date.now() }))
    setMessage(null)
  }

  const download = () => {
    if (!activeDocument || !activeDocument.savedJson || activeDocument.isDirty) return
    const url = URL.createObjectURL(new Blob([activeDocument.savedJson], { type: 'application/json' }))
    const link = window.document.createElement('a')
    link.href = url
    link.download = downloadName(activeDocument.filename)
    link.click()
    URL.revokeObjectURL(url)
  }

  const updateSearch = (searchQuery: string) => {
    if (!activeDocument) return
    updateDocument(activeDocument.id, (document) => ({ ...document, searchQuery }))
  }

  const stats = useMemo(() => activeDocument ? getJsonStats(activeDocument.working) : null, [activeDocument])
  const preview = useMemo(() => activeDocument ? JSON.stringify(activeDocument.working, null, 2) : '', [activeDocument])

  if (restoring) {
    return <main className="loading-page" aria-live="polite"><img className="brand-logo" src="/json-dev-logo.png" alt="JSON Dev logo" /><strong>Restoring your workspace…</strong></main>
  }

  if (!activeDocument) {
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
        <div className="app-brand"><img className="brand-logo small" src="/json-dev-logo.png" alt="JSON Dev logo" /><span>JSON Dev</span></div>
        <div className="header-actions">
          <button className="button button-secondary" type="button" onClick={reset} disabled={!activeDocument.isDirty}><RotateCcw size={16} aria-hidden="true" /> Reset</button>
          <button className="button button-primary" type="button" onClick={save} disabled={!activeDocument.isDirty && activeDocument.savedJson !== null}><Save size={16} aria-hidden="true" /> Save changes</button>
          <button className="button button-dark" type="button" onClick={download} disabled={!activeDocument.savedJson || activeDocument.isDirty} title={activeDocument.isDirty ? 'Save your latest changes before downloading' : undefined}><Download size={16} aria-hidden="true" /> Download JSON</button>
        </div>
      </header>

      <main className="editor-layout">
        <aside className="editor-sidebar">
          <div className="file-list-heading"><div><h2>Files</h2><span>{workspace.documents.length}</span></div><JsonUploader compact onFile={loadFile} busy={busy} /></div>
          <div className="document-list" role="list" aria-label="Open JSON files">
            {workspace.documents.map((document, index) => {
              const active = document.id === activeDocument.id
              return (
                <div className={`file-card ${active ? 'active' : ''}`} role="listitem" key={document.id}>
                  <button className="file-select" type="button" onClick={() => selectDocument(document.id)} aria-current={active ? 'page' : undefined} aria-label={`Open ${document.filename}, document ${index + 1}`}>
                    <span className="file-icon"><FileJson size={20} aria-hidden="true" /></span>
                    <span className="file-details"><strong title={document.filename}>{document.filename}</strong><span>{formatBytes(document.size)} · Document {index + 1}</span></span>
                    <span className={`status-dot ${document.isDirty ? 'dirty' : 'clean'}`} title={document.isDirty ? 'Unsaved changes' : 'No unsaved changes'}><span className="sr-only">{document.isDirty ? 'Unsaved changes' : 'No unsaved changes'}</span></span>
                  </button>
                  <button className="file-remove" type="button" onClick={() => removeDocument(document)} aria-label={`Close ${document.filename}, document ${index + 1}`}><X size={14} aria-hidden="true" /></button>
                </div>
              )
            })}
          </div>
          <label className="search-box"><Search size={16} aria-hidden="true" /><span className="sr-only">Search active JSON</span><input value={activeDocument.searchQuery} onChange={(event) => updateSearch(event.target.value)} placeholder="Search keys or values…" /></label>
          <section className="stats-card" aria-label="JSON statistics">
            <h2>Document overview</h2>
            <dl>
              <div><dt>Properties</dt><dd>{stats?.properties}</dd></div>
              <div><dt>Objects</dt><dd>{stats?.objects}</dd></div>
              <div><dt>Arrays</dt><dd>{stats?.arrays}</dd></div>
              <div><dt>Max depth</dt><dd>{stats?.depth}</dd></div>
            </dl>
          </section>
          <div className={`local-note ${persistenceStatus === 'error' ? 'storage-error' : ''}`}><ShieldCheck size={17} aria-hidden="true" /><p><strong>{persistenceStatus === 'error' ? 'Session only' : persistenceStatus === 'saving' ? 'Saving workspace…' : 'Stored locally'}</strong><span>{persistenceStatus === 'error' ? 'Browser storage is unavailable.' : 'Data stays on this device and may be cleared by your browser.'}</span></p></div>
        </aside>

        <section className="editor-workspace" aria-labelledby="editor-title">
          <div className="workspace-heading">
            <div><span className="eyebrow">{activeDocument.filename}</span><h1 id="editor-title">Edit JSON</h1><p>Change values, types, and structure. Save when you’re ready.</p></div>
            <button className="button button-secondary" type="button" onClick={() => setShowPreview((current) => !current)}>{showPreview ? 'Hide' : 'Show'} JSON preview</button>
          </div>

          {message && <div className={`inline-message ${message.kind}`} role={message.kind === 'error' ? 'alert' : 'status'}>{message.kind === 'success' && <Check size={17} aria-hidden="true" />}{message.text}</div>}
          {activeDocument.isDirty && <div className="unsaved-banner"><span /> Unsaved changes in {activeDocument.filename}</div>}

          <div className={`workspace-grid ${showPreview ? 'with-preview' : ''}`}>
            <div className="tree-panel">
              <JsonNode
                key={activeDocument.id}
                root
                label="Root"
                value={activeDocument.working}
                path={[]}
                query={activeDocument.searchQuery}
                onChange={(path: JsonPath, value: JsonValue) => edit((root) => updateAtPath(root, path, value))}
                onRemove={(path: JsonPath) => edit((root) => removeAtPath(root, path))}
                onAddObject={(path: JsonPath, key: string, value: JsonValue) => edit((root) => addObjectField(root, path, key, value))}
                onAddArray={(path: JsonPath, value: JsonValue) => edit((root) => addArrayItem(root, path, value))}
                onMove={(path: JsonPath, from: number, to: number) => edit((root) => moveArrayItem(root, path, from, to))}
              />
            </div>
            {showPreview && <aside className="preview-panel"><div className="preview-heading"><strong>Live preview</strong><span>{activeDocument.isDirty ? 'Unsaved' : activeDocument.savedJson ? 'Saved' : 'Original'}</span></div><pre><code>{preview}</code></pre></aside>}
          </div>
        </section>
      </main>
    </div>
  )
}
