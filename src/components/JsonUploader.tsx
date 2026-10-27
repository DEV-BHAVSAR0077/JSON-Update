import { useRef, useState } from 'react'
import { FileJson, Plus, UploadCloud } from 'lucide-react'

interface JsonUploaderProps {
  onFile: (file: File) => void
  busy: boolean
  compact?: boolean
}

export function JsonUploader({ onFile, busy, compact = false }: JsonUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const accept = (files: FileList | null) => {
    const file = files?.[0]
    if (file) onFile(file)
    if (inputRef.current) inputRef.current.value = ''
  }

  if (compact) {
    return (
      <>
        <input ref={inputRef} className="sr-only" type="file" accept=".json,application/json" onChange={(event) => accept(event.target.files)} />
        <button className="button button-secondary" type="button" onClick={() => inputRef.current?.click()} disabled={busy}>
          <Plus size={16} aria-hidden="true" /> Add file
        </button>
      </>
    )
  }

  return (
    <main className="upload-page">
      <section className="upload-hero" aria-labelledby="upload-title">
        <div className="brand-lockup">
          <img className="brand-logo" src="/json-dev-logo.png" alt="JSON Dev logo" />
          <span>JSON Dev</span>
        </div>
        <div className="hero-copy">
          <span className="eyebrow">Browser-based developer tool</span>
          <h1 id="upload-title">Edit any JSON.<br /><span>Keep every type intact.</span></h1>
          <p>Upload, reshape, validate, and download nested JSON without sending your data anywhere.</p>
        </div>

        <div
          className={`drop-zone ${dragging ? 'is-dragging' : ''}`}
          onDragEnter={(event) => { event.preventDefault(); setDragging(true) }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false) }}
          onDrop={(event) => { event.preventDefault(); setDragging(false); accept(event.dataTransfer.files) }}
        >
          <input ref={inputRef} className="sr-only" type="file" accept=".json,application/json" onChange={(event) => accept(event.target.files)} />
          <span className="upload-icon"><FileJson size={28} aria-hidden="true" /></span>
          <div>
            <h2>{busy ? 'Reading your file…' : 'Drop your JSON file here'}</h2>
            <p>or choose one from your computer</p>
          </div>
          <button className="button button-primary" type="button" onClick={() => inputRef.current?.click()} disabled={busy}>
            <UploadCloud size={17} aria-hidden="true" /> {busy ? 'Processing…' : 'Browse files'}
          </button>
          <small>.json only · Maximum 5 MB</small>
        </div>

        <div className="privacy-note">
          <span className="privacy-dot" />
          <div><strong>Private by design</strong><p>Your file stays in this browser. Nothing is uploaded to a server.</p></div>
        </div>
      </section>

      <aside className="upload-example" aria-label="Product example">
        <div className="window-chrome"><i /><i /><i /><span>profile.json</span></div>
        <pre><code><span>{'{'}</span>{'\n'}  <b>"name"</b>: <em>"Avery"</em>,{'\n'}  <b>"active"</b>: <u>true</u>,{'\n'}  <b>"skills"</b>: [{'\n'}    <em>"React"</em>,{'\n'}    <em>"TypeScript"</em>{'\n'}  ]{'\n'}<span>{'}'}</span></code></pre>
        <div className="example-card">
          <div className="mini-type">STRING</div>
          <label>Name</label>
          <div className="fake-input">Avery</div>
          <div className="mini-type">BOOLEAN</div>
          <div className="fake-toggle"><span /> Active</div>
        </div>
      </aside>
    </main>
  )
}
