import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Download, FileJson, Minus, Plus, RotateCcw, Save, Search, X } from 'lucide-react'
import { DraftTextInput } from './components/DraftTextInput'
import { ConfirmDialog, type ConfirmationRequest } from './components/ConfirmDialog'
import { JsonUploader } from './components/JsonUploader'
import { JsonNode } from './components/JsonNode'
import type { JsonPath, JsonValue, WorkspaceDocument, WorkspaceState, WorkspaceValue } from './types'
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
import { resolveWorkspacePlugins } from './lib/pluginExecution'
import { collectPluginNodeIds, hasPluginNodes, hydrateWorkspacePlugins, workspacePreviewValue } from './lib/pluginNodes'

type Message = { kind: 'error' | 'success'; text: string }
type PersistenceStatus = 'restoring' | 'saving' | 'saved' | 'error'
const MIN_PREVIEW_FONT_SIZE = 9
const MAX_PREVIEW_FONT_SIZE = 20

function createDocumentId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export default function App() {
  const [workspace, setWorkspace] = useState<WorkspaceState>(EMPTY_WORKSPACE)
  const [busy, setBusy] = useState(false)
  const [restoring, setRestoring] = useState(true)
  const [, setPersistenceStatus] = useState<PersistenceStatus>('restoring')
  const [persistenceDisabled, setPersistenceDisabled] = useState(false)
  const [message, setMessage] = useState<Message | null>(null)
  const [showPreview, setShowPreview] = useState(false)
  const [previewFontSize, setPreviewFontSize] = useState(11)
  const [hasPendingEdit, setHasPendingEdit] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmation, setConfirmation] = useState<ConfirmationRequest | null>(null)
  const persistenceQueue = useRef<Promise<void>>(Promise.resolve())
  const persistenceVersion = useRef(0)
  const workspaceRef = useRef(workspace)
  workspaceRef.current = workspace

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
        setWorkspace(hydrateWorkspacePlugins(restored))
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
    const timeout = window.setTimeout(() => {
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
    }, 300)
    return () => window.clearTimeout(timeout)
  }, [persistenceDisabled, restoring, workspace])

  useEffect(() => {
    if (!message) return
    const timeout = window.setTimeout(() => setMessage(null), 10_000)
    return () => window.clearTimeout(timeout)
  }, [message])

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!hasAnyUnsavedChanges && !hasPendingEdit) return
      event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [hasAnyUnsavedChanges, hasPendingEdit])

  const updateDocument = useCallback((id: string, updater: (document: WorkspaceDocument) => WorkspaceDocument) => {
    setWorkspace((current) => ({
      ...current,
      documents: current.documents.map((document) => document.id === id ? updater(document) : document),
    }))
  }, [])
  const requestConfirmation = useCallback((request: ConfirmationRequest) => setConfirmation(request), [])

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
        pluginNodeIds: [],
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
    const remove = () => {
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
    if (document.isDirty) {
      requestConfirmation({
        title: `Remove ${document.filename}?`,
        message: 'This file has unsaved changes. Removing it will permanently discard those changes.',
        confirmLabel: 'Remove file',
        onConfirm: remove,
      })
      return
    }
    remove()
  }

  const activeDocumentId = activeDocument?.id
  const edit = useCallback((updater: (value: WorkspaceValue) => WorkspaceValue) => {
    if (!activeDocumentId) return
    updateDocument(activeDocumentId, (document) => {
      const working = updater(document.working)
      return {
        ...document,
        working,
        pluginNodeIds: collectPluginNodeIds(working),
        isDirty: true,
        updatedAt: Date.now(),
      }
    })
    setMessage(null)
  }, [activeDocumentId, updateDocument])

  const save = () => {
    if (!activeDocument || saving) return
    const source = activeDocument
    if (!hasPluginNodes(source.working)) {
      try {
        validateJsonTree(source.working as JsonValue)
        const savedJson = JSON.stringify(source.working, null, 2)
        updateDocument(source.id, (document) => ({ ...document, savedJson, isDirty: false, updatedAt: Date.now() }))
        setMessage({ kind: 'success', text: 'Saved !' })
      } catch {
        setMessage({ kind: 'error', text: 'Failed' })
      }
      return
    }

    setSaving(true)
    setMessage(null)
    void resolveWorkspacePlugins(source.working)
      .then((resolved) => {
        validateJsonTree(resolved)
        const latest = workspaceRef.current.documents.find((document) => document.id === source.id)
        if (!latest || latest.working !== source.working) throw new Error('The document changed while plugins were running. Save it again.')
        const savedJson = JSON.stringify(resolved, null, 2)
        updateDocument(source.id, (document) => ({ ...document, savedJson, isDirty: false, updatedAt: Date.now() }))
        setMessage({ kind: 'success', text: 'Saved !' })
      })
      .catch((error) => {
        setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Plugin execution failed.' })
      })
      .finally(() => setSaving(false))
  }

  const reset = () => {
    if (!activeDocument) return
    const restore = () => {
      const isDirty = activeDocument.savedJson !== null && activeDocument.savedJson !== JSON.stringify(activeDocument.original, null, 2)
      updateDocument(activeDocument.id, (document) => ({ ...document, working: document.original, pluginNodeIds: [], isDirty, updatedAt: Date.now() }))
      setMessage(null)
    }
    if (activeDocument.isDirty) {
      requestConfirmation({
        title: 'Reset changes?',
        message: `Discard all changes and restore the uploaded version of ${activeDocument.filename}?`,
        confirmLabel: 'Reset',
        onConfirm: restore,
      })
      return
    }
    restore()
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

  const updateSearch = useCallback((searchQuery: string) => {
    if (!activeDocumentId) return
    updateDocument(activeDocumentId, (document) => ({ ...document, searchQuery }))
  }, [activeDocumentId, updateDocument])
  const changeValue = useCallback((path: JsonPath, value: WorkspaceValue) => edit((root) => updateAtPath(root, path, value)), [edit])
  const removeValue = useCallback((path: JsonPath) => edit((root) => removeAtPath(root, path)), [edit])
  const addObjectValue = useCallback((path: JsonPath, key: string, value: WorkspaceValue) => edit((root) => addObjectField(root, path, key, value)), [edit])
  const addArrayValue = useCallback((path: JsonPath, value: WorkspaceValue) => edit((root) => addArrayItem(root, path, value)), [edit])
  const moveArrayValue = useCallback((path: JsonPath, from: number, to: number) => edit((root) => moveArrayItem(root, path, from, to)), [edit])
  const handlePendingEdit = useCallback((pending: boolean) => {
    setHasPendingEdit(pending)
    if (pending) setMessage(null)
  }, [])
  const working = activeDocument?.working
  const deferredWorking = useDeferredValue(working)
  const stats = useMemo(() => deferredWorking === undefined ? null : getJsonStats(deferredWorking), [deferredWorking])
  const preview = useMemo(() => {
    if (!showPreview || working === undefined || !activeDocument) return ''
    if (!activeDocument.isDirty && activeDocument.savedJson) return activeDocument.savedJson
    return JSON.stringify(workspacePreviewValue(working), null, 2)
  }, [activeDocument, showPreview, working])

  if (restoring) {
    return <main className="loading-page" aria-live="polite"><img className="brand-logo" src="/json-dev-logo.png" alt="JSON Studio logo" /><strong>Restoring your workspace…</strong></main>
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
        <div className="app-brand"><img className="brand-logo small" src="/json-dev-logo.png" alt="JSON Studio logo" /><span>JSON Studio</span></div>
        <div className="header-actions">
          <button className="button button-secondary" type="button" onClick={reset} disabled={!activeDocument.isDirty && !hasPendingEdit}><RotateCcw size={16} aria-hidden="true" /> Reset</button>
          <button className="button button-primary" type="button" onClick={save} disabled={saving || (!hasPendingEdit && !activeDocument.isDirty && activeDocument.savedJson !== null)}><Save size={16} aria-hidden="true" /> {saving ? 'Saving…' : 'Save changes'}</button>
          <button className="button button-dark" type="button" onClick={download} disabled={saving || !activeDocument.savedJson || activeDocument.isDirty || hasPendingEdit} title={activeDocument.isDirty || hasPendingEdit ? 'Save your latest changes before downloading' : undefined}><Download size={16} aria-hidden="true" /> Download JSON</button>
        </div>
      </header>

      <main className="editor-layout">
        <aside className="editor-sidebar">
          <label className="search-box"><Search size={16} aria-hidden="true" /><span className="sr-only">Search active JSON</span><DraftTextInput value={activeDocument.searchQuery} onValueChange={updateSearch} placeholder="Search keys or values…" /></label>
          <section className="stats-card" aria-label="JSON statistics">
            <h2>Document overview</h2>
            <dl>
              <div><dt>Properties</dt><dd>{stats?.properties}</dd></div>
              <div><dt>Objects</dt><dd>{stats?.objects}</dd></div>
              <div><dt>Arrays</dt><dd>{stats?.arrays}</dd></div>
              <div><dt>Max depth</dt><dd>{stats?.depth}</dd></div>
            </dl>
          </section>
          <section className="files-section" aria-labelledby="files-heading">
            <div className="file-list-heading"><div><h2 id="files-heading">Files</h2><span>{workspace.documents.length}</span></div><JsonUploader compact onFile={loadFile} busy={busy} /></div>
            <div className="document-list" role="list" aria-label="Open JSON files">
              {workspace.documents.map((document, index) => {
                const active = document.id === activeDocument.id
                const dirty = document.isDirty || (active && hasPendingEdit)
                return (
                  <div className={`file-card ${active ? 'active' : ''}`} role="listitem" key={document.id}>
                    <button className="file-select" type="button" onClick={() => selectDocument(document.id)} aria-current={active ? 'page' : undefined} aria-label={`Open ${document.filename}, document ${index + 1}`}>
                      <span className="file-icon"><FileJson size={20} aria-hidden="true" /></span>
                      <span className="file-details"><strong title={document.filename}>{document.filename}</strong><span>{formatBytes(document.size)} · Document {index + 1}</span></span>
                      <span className={`status-dot ${dirty ? 'dirty' : 'clean'}`} title={dirty ? 'Unsaved changes' : 'No unsaved changes'}><span className="sr-only">{dirty ? 'Unsaved changes' : 'No unsaved changes'}</span></span>
                    </button>
                    <button className="file-remove" type="button" onClick={() => removeDocument(document)} aria-label={`Close ${document.filename}, document ${index + 1}`}><X size={14} aria-hidden="true" /></button>
                  </div>
                )
              })}
            </div>
          </section>
          {/* <div className={`local-note ${persistenceStatus === 'error' ? 'storage-error' : ''}`}><ShieldCheck size={17} aria-hidden="true" /><p><strong>{persistenceStatus === 'error' ? 'Session only' : persistenceStatus === 'saving' ? 'Saving workspace…' : 'Stored locally'}</strong><span>{persistenceStatus === 'error' ? 'Browser storage is unavailable.' : 'Data stays on this device and may be cleared by your browser.'}</span></p></div> */}
        </aside>

        <section className="editor-workspace" aria-labelledby="editor-title">
          <div className="workspace-heading">
            <div><span className="eyebrow">{activeDocument.filename}</span><h1 id="editor-title">Edit JSON</h1><p>Change values, types, and structure. Save when you’re ready.</p></div>
            <div className="workspace-actions">
              {message && <div className={`inline-message ${message.kind}`} role={message.kind === 'error' ? 'alert' : 'status'}>{message.kind === 'success' && <Check size={17} aria-hidden="true" />}{message.text}{message.kind === 'error' && <X size={17} aria-hidden="true" />}</div>}
              <button className="button button-secondary" type="button" onClick={() => setShowPreview((current) => !current)}>{showPreview ? 'Hide' : 'Show'} JSON preview</button>
            </div>
          </div>

          {(activeDocument.isDirty || hasPendingEdit) && <div className="unsaved-banner"><span /> Unsaved changes in {activeDocument.filename}</div>}

          <div className={`workspace-grid ${showPreview ? 'with-preview' : ''}`}>
            <div className="tree-panel">
              <JsonNode
                key={activeDocument.id}
                root
                label="Root"
                value={activeDocument.working}
                path={[]}
                query={activeDocument.searchQuery}
                onChange={changeValue}
                onRemove={removeValue}
                onAddObject={addObjectValue}
                onAddArray={addArrayValue}
                onMove={moveArrayValue}
                onPendingChange={handlePendingEdit}
                onRequestConfirmation={requestConfirmation}
              />
            </div>
            {showPreview && (
              <aside className="preview-panel">
                <div className="preview-heading">
                  <div className="preview-title">
                    <strong>Live preview</strong>
                    <div className="preview-font-controls" role="group" aria-label="Preview font size">
                      <button type="button" onClick={() => setPreviewFontSize((size) => Math.max(MIN_PREVIEW_FONT_SIZE, size - 1))} disabled={previewFontSize === MIN_PREVIEW_FONT_SIZE} aria-label="Decrease preview font size"><Minus size={14} aria-hidden="true" /></button>
                      <output className="preview-font-size" aria-live="polite">{previewFontSize}</output>
                      <button type="button" onClick={() => setPreviewFontSize((size) => Math.min(MAX_PREVIEW_FONT_SIZE, size + 1))} disabled={previewFontSize === MAX_PREVIEW_FONT_SIZE} aria-label="Increase preview font size"><Plus size={14} aria-hidden="true" /></button>
                    </div>
                  </div>
                  <span className="preview-status">{activeDocument.isDirty || hasPendingEdit ? 'Unsaved' : activeDocument.savedJson ? 'Saved' : 'Original'}</span>
                </div>
                <pre style={{ fontSize: previewFontSize }}><code>{preview}</code></pre>
              </aside>
            )}
          </div>
        </section>
      </main>
      {confirmation && (
        <ConfirmDialog
          title={confirmation.title}
          message={confirmation.message}
          confirmLabel={confirmation.confirmLabel}
          onCancel={() => setConfirmation(null)}
          onConfirm={() => {
            const action = confirmation.onConfirm
            setConfirmation(null)
            action()
          }}
        />
      )}
    </div>
  )
}
