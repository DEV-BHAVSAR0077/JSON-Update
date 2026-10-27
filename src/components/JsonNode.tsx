import { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react'
import type { JsonObject, JsonPath, JsonType, JsonValue } from '../types'
import { defaultForType, isNonEmptyContainer, matchesSearch, typeOfJson } from '../lib/json'

const types: JsonType[] = ['string', 'number', 'boolean', 'null', 'object', 'array']

interface JsonNodeProps {
  label: string
  value: JsonValue
  path: JsonPath
  query: string
  root?: boolean
  onChange: (path: JsonPath, value: JsonValue) => void
  onRemove: (path: JsonPath) => void
  onAddObject: (path: JsonPath, key: string, value: JsonValue) => void
  onAddArray: (path: JsonPath, value: JsonValue) => void
  onMove: (path: JsonPath, from: number, to: number) => void
}

interface AddValueProps {
  objectMode: boolean
  existingKeys?: string[]
  onAdd: (key: string, value: JsonValue) => void
}

function AddValue({ objectMode, existingKeys = [], onAdd }: AddValueProps) {
  const [open, setOpen] = useState(false)
  const [key, setKey] = useState('')
  const [type, setType] = useState<JsonType>('string')
  const [error, setError] = useState('')

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    const property = key
    if (objectMode && !property.trim()) return setError('Enter a property name.')
    if (objectMode && existingKeys.includes(property)) return setError(`“${property}” already exists in this object.`)
    onAdd(property, defaultForType(type))
    setKey('')
    setType('string')
    setError('')
    setOpen(false)
  }

  if (!open) {
    return <button className="add-button" type="button" onClick={() => setOpen(true)}><Plus size={15} aria-hidden="true" /> {objectMode ? 'Add field' : 'Add item'}</button>
  }

  return (
    <form className="add-form" onSubmit={submit}>
      {objectMode && (
        <label>
          <span>Property name</span>
          <input autoFocus value={key} onChange={(event) => { setKey(event.target.value); setError('') }} aria-invalid={Boolean(error)} />
        </label>
      )}
      <label>
        <span>Initial type</span>
        <select value={type} onChange={(event) => setType(event.target.value as JsonType)}>{types.map((item) => <option key={item}>{item}</option>)}</select>
      </label>
      <div className="add-form-actions">
        <button className="button button-primary button-small" type="submit">Add</button>
        <button className="button button-ghost button-small" type="button" onClick={() => { setOpen(false); setError('') }}>Cancel</button>
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
    </form>
  )
}

function NumberInput({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  return (
    <input
      aria-label={`${label} value`}
      type="number"
      step="any"
      value={text}
      onChange={(event) => {
        setText(event.target.value)
        const next = Number(event.target.value)
        if (event.target.value !== '' && Number.isFinite(next)) onChange(next)
      }}
      onBlur={() => { if (text === '' || !Number.isFinite(Number(text))) setText(String(value)) }}
    />
  )
}

export function JsonNode(props: JsonNodeProps) {
  const { label, value, path, query, root = false, onChange, onRemove, onAddObject, onAddArray, onMove } = props
  const type = typeOfJson(value)
  const [expanded, setExpanded] = useState(true)
  const structured = type === 'object' || type === 'array'
  const entries: Array<readonly [string | number, JsonValue]> = type === 'object'
    ? Object.entries(value as JsonObject)
    : type === 'array'
      ? (value as JsonValue[]).map((item, index) => [index, item] as const)
      : []
  const visibleEntries = entries.filter(([key, item]) => matchesSearch(String(key), item, query))

  useEffect(() => { if (query) setExpanded(true) }, [query])

  const remove = () => {
    if (isNonEmptyContainer(value) && !window.confirm(`Remove ${label} and everything inside it?`)) return
    onRemove(path)
  }

  if (structured) {
    return (
      <section className={`json-node json-${type} ${root ? 'json-root' : ''}`} aria-label={`${label} ${type}`}>
        <header className="node-header">
          <button className="collapse-button" type="button" onClick={() => setExpanded((current) => !current)} aria-expanded={expanded} aria-label={`${expanded ? 'Collapse' : 'Expand'} ${label}`}>
            <ChevronDown className={expanded ? '' : 'collapsed'} size={18} aria-hidden="true" />
          </button>
          <div className="node-heading">
            <strong title={label}>{label}</strong>
            <span className={`type-pill type-${type}`}>{type}</span>
            <span className="item-count">{entries.length} {type === 'array' ? (entries.length === 1 ? 'item' : 'items') : (entries.length === 1 ? 'field' : 'fields')}</span>
          </div>
          <select className="type-select" aria-label={`Change ${label} type`} value={type} onChange={(event) => onChange(path, defaultForType(event.target.value as JsonType))}>
            {types.map((item) => <option key={item}>{item}</option>)}
          </select>
          {!root && <button className="icon-button danger" type="button" onClick={remove} aria-label={`Remove ${label}`}><Trash2 size={16} aria-hidden="true" /></button>}
        </header>
        {expanded && (
          <div className="node-body">
            {visibleEntries.length ? visibleEntries.map(([key, item], index) => (
              <div className="child-wrap" key={String(key)}>
                {type === 'array' && (
                  <div className="reorder-controls" aria-label={`Reorder item ${index + 1}`}>
                    <button type="button" disabled={Number(key) === 0} onClick={() => onMove(path, Number(key), Number(key) - 1)} aria-label={`Move item ${Number(key) + 1} up`}><ChevronUp size={14} /></button>
                    <button type="button" disabled={Number(key) === entries.length - 1} onClick={() => onMove(path, Number(key), Number(key) + 1)} aria-label={`Move item ${Number(key) + 1} down`}><ChevronDown size={14} /></button>
                  </div>
                )}
                <JsonNode {...props} root={false} label={type === 'array' ? `Item ${Number(key) + 1}` : String(key)} value={item} path={[...path, key]} />
              </div>
            )) : <div className="empty-state">{query ? 'No matching fields in this section.' : `This ${type} is empty.`}</div>}
            {!query && (type === 'object'
              ? <AddValue objectMode existingKeys={Object.keys(value as JsonObject)} onAdd={(key, item) => onAddObject(path, key, item)} />
              : <AddValue objectMode={false} onAdd={(_key, item) => onAddArray(path, item)} />)}
          </div>
        )}
      </section>
    )
  }

  return (
    <div className={`primitive-row ${root ? 'json-root primitive-root' : ''}`}>
      <div className="primitive-label">
        <strong title={label}>{label}</strong>
        <span className={`type-pill type-${type}`}>{type}</span>
      </div>
      <div className="primitive-control">
        {type === 'string' && <input aria-label={`${label} value`} type="text" value={value as string} onChange={(event) => onChange(path, event.target.value)} />}
        {type === 'number' && <NumberInput label={label} value={value as number} onChange={(next) => onChange(path, next)} />}
        {type === 'boolean' && (
          <label className="switch">
            <input aria-label={`${label} value`} type="checkbox" checked={value as boolean} onChange={(event) => onChange(path, event.target.checked)} />
            <span className="switch-track"><span /></span><em>{value ? 'True' : 'False'}</em>
          </label>
        )}
        {type === 'null' && <span className="null-value">null</span>}
      </div>
      <select className="type-select" aria-label={`Change ${label} type`} value={type} onChange={(event) => onChange(path, defaultForType(event.target.value as JsonType))}>
        {types.map((item) => <option key={item}>{item}</option>)}
      </select>
      {!root && <button className="icon-button danger" type="button" onClick={remove} aria-label={`Remove ${label}`}><Trash2 size={16} aria-hidden="true" /></button>}
    </div>
  )
}
