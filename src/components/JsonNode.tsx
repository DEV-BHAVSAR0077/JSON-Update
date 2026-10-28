import { memo, startTransition, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react'
import type { JsonObject, JsonPath, JsonType, JsonValue } from '../types'
import { defaultForType, isNonEmptyContainer, matchesSearch, typeOfJson } from '../lib/json'
import { createPluginValue, getDefaultPluginConfig, getRegisteredPlugin, getRegisteredPlugins, type PluginConfig } from '../lib/plugins'
import type { ConfirmationRequest } from './ConfirmDialog'
import { DraftTextInput } from './DraftTextInput'

const types: JsonType[] = ['string', 'number', 'boolean', 'null', 'object', 'array']
type CreationType = JsonType | 'plugin'

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
  onPendingChange: (pending: boolean) => void
  onRequestConfirmation: (request: ConfirmationRequest) => void
}

interface AddValueProps {
  objectMode: boolean
  existingKeys?: string[]
  onAdd: (key: string, value: JsonValue) => void
}

function AddValue({ objectMode, existingKeys = [], onAdd }: AddValueProps) {
  const [open, setOpen] = useState(false)
  const [key, setKey] = useState('')
  const [type, setType] = useState<CreationType>('string')
  const [pluginId, setPluginId] = useState('')
  const [pluginConfig, setPluginConfig] = useState<PluginConfig>({})
  const [error, setError] = useState('')
  const plugins = getRegisteredPlugins()
  const selectedPlugin = getRegisteredPlugin(pluginId)
  const generated = useMemo(() => {
    if (type !== 'plugin' || !pluginId) return null
    try {
      return { value: createPluginValue(pluginId, pluginConfig), error: '' }
    } catch (pluginError) {
      return { value: null, error: pluginError instanceof Error ? pluginError.message : 'Plugin could not generate valid JSON.' }
    }
  }, [pluginConfig, pluginId, type])
  const PluginConfigComponent = selectedPlugin?.ConfigComponent

  const close = () => {
    setOpen(false)
    setKey('')
    setType('string')
    setPluginId('')
    setPluginConfig({})
    setError('')
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    const property = key
    if (objectMode && !property.trim()) return setError('Enter a property name.')
    if (objectMode && existingKeys.includes(property)) return setError(`“${property}” already exists in this object.`)
    if (type === 'plugin' && !pluginId) return setError('Select a plugin.')
    if (type === 'plugin' && generated?.error) return setError(generated.error)
    try {
      onAdd(property, type === 'plugin' ? generated!.value : defaultForType(type))
      close()
    } catch (insertionError) {
      setError(insertionError instanceof Error ? insertionError.message : 'Could not add this field.')
    }
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
        <select value={type} onChange={(event) => { setType(event.target.value as CreationType); setError('') }}>
          {[...types, 'plugin'].map((item) => <option key={item}>{item}</option>)}
        </select>
      </label>
      <div className="add-form-actions">
        <button className="button button-primary button-small" type="submit">Add</button>
        <button className="button button-ghost button-small" type="button" onClick={close}>Cancel</button>
      </div>
      {type === 'plugin' && (
        <div className="plugin-fields">
          <label>
            <span>Select Plugin</span>
            <select value={pluginId} onChange={(event) => {
              const nextPlugin = getRegisteredPlugin(event.target.value)
              setPluginId(event.target.value)
              setPluginConfig(nextPlugin ? getDefaultPluginConfig(nextPlugin) : {})
              setError('')
            }}>
              <option value="">Choose a plugin</option>
              {plugins.map((plugin) => <option key={plugin.id} value={plugin.id}>{plugin.name}</option>)}
            </select>
          </label>
          {selectedPlugin && (
            <>
              <p className="plugin-description">{selectedPlugin.description}</p>
              {(selectedPlugin.configSchema?.length || PluginConfigComponent) && (
                <div className="plugin-config">
                  {selectedPlugin.configSchema?.map((field) => (
                    <label key={field.key}>
                      <span>{field.label}</span>
                      {field.type === 'select' ? (
                        <select value={String(pluginConfig[field.key] ?? '')} onChange={(event) => { setPluginConfig((current) => ({ ...current, [field.key]: event.target.value })); setError('') }}>
                          {field.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                      ) : (
                        <input
                          type={field.type}
                          min={field.min}
                          max={field.max}
                          step={field.step}
                          value={String(pluginConfig[field.key] ?? '')}
                          onChange={(event) => {
                            const value = field.type === 'number' && event.target.value !== '' ? Number(event.target.value) : event.target.value
                            setPluginConfig((current) => ({ ...current, [field.key]: value }))
                            setError('')
                          }}
                        />
                      )}
                    </label>
                  ))}
                  {PluginConfigComponent && <PluginConfigComponent config={pluginConfig} onChange={(config) => { setPluginConfig(config); setError('') }} />}
                </div>
              )}
              <div className="plugin-preview">
                <strong>Generated data preview</strong>
                {generated?.error
                  ? <p className="field-error" role="alert">{generated.error}</p>
                  : <pre aria-label="Generated plugin data preview"><code>{JSON.stringify(generated?.value, null, 2)}</code></pre>}
              </div>
            </>
          )}
        </div>
      )}
      {error && <p className="field-error" role="alert">{error}</p>}
    </form>
  )
}

function NumberInput({ label, value, onChange, onPendingChange }: { label: string; value: number; onChange: (value: number) => void; onPendingChange: (pending: boolean) => void }) {
  const [text, setText] = useState(String(value))
  const pending = useRef(false)
  const timeout = useRef<number | null>(null)
  useEffect(() => { if (!pending.current) setText(String(value)) }, [value])
  useEffect(() => () => {
    if (timeout.current !== null) window.clearTimeout(timeout.current)
  }, [])

  const clearPendingTimeout = () => {
    if (timeout.current === null) return
    window.clearTimeout(timeout.current)
    timeout.current = null
  }

  return (
    <input
      aria-label={`${label} value`}
      type="number"
      step="any"
      value={text}
      onChange={(event) => {
        setText(event.target.value)
        const next = Number(event.target.value)
        pending.current = true
        onPendingChange(true)
        clearPendingTimeout()
        if (event.target.value !== '' && Number.isFinite(next)) {
          timeout.current = window.setTimeout(() => {
            timeout.current = null
            pending.current = false
            startTransition(() => onChange(next))
            onPendingChange(false)
          }, 250)
        }
      }}
      onBlur={() => {
        const next = Number(text)
        clearPendingTimeout()
        pending.current = false
        if (text === '' || !Number.isFinite(next)) setText(String(value))
        else if (next !== value) onChange(next)
        onPendingChange(false)
      }}
    />
  )
}

function samePath(left: JsonPath, right: JsonPath): boolean {
  return left.length === right.length && left.every((segment, index) => segment === right[index])
}

function sameProps(left: JsonNodeProps, right: JsonNodeProps): boolean {
  return left.label === right.label
    && left.value === right.value
    && left.query === right.query
    && left.root === right.root
    && samePath(left.path, right.path)
    && left.onChange === right.onChange
    && left.onRemove === right.onRemove
    && left.onAddObject === right.onAddObject
    && left.onAddArray === right.onAddArray
    && left.onMove === right.onMove
    && left.onPendingChange === right.onPendingChange
    && left.onRequestConfirmation === right.onRequestConfirmation
}

function JsonNodeComponent(props: JsonNodeProps) {
  const { label, value, path, query, root = false, onChange, onRemove, onAddObject, onAddArray, onMove, onPendingChange, onRequestConfirmation } = props
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
    if (isNonEmptyContainer(value)) {
      onRequestConfirmation({
        title: `Remove ${label}?`,
        message: `This will permanently remove ${label} and everything inside it from the current document.`,
        confirmLabel: 'Remove',
        onConfirm: () => onRemove(path),
      })
      return
    }
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
        {type === 'string' && <DraftTextInput aria-label={`${label} value`} value={value as string} onValueChange={(next) => onChange(path, next)} onPendingChange={onPendingChange} />}
        {type === 'number' && <NumberInput label={label} value={value as number} onChange={(next) => onChange(path, next)} onPendingChange={onPendingChange} />}
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

export const JsonNode = memo(JsonNodeComponent, sameProps)
