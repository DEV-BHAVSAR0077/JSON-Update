import { startTransition, useEffect, useRef, useState } from 'react'
import type { InputHTMLAttributes } from 'react'

const EDIT_DEBOUNCE_MS = 250

interface DraftTextInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onBlur' | 'onChange' | 'type' | 'value'> {
  value: string
  onValueChange: (value: string) => void
  onPendingChange?: (pending: boolean) => void
}

export function DraftTextInput({ value, onValueChange, onPendingChange, ...props }: DraftTextInputProps) {
  const [text, setText] = useState(value)
  const latestText = useRef(value)
  const pending = useRef(false)
  const timeout = useRef<number | null>(null)

  useEffect(() => {
    if (pending.current) return
    latestText.current = value
    setText(value)
  }, [value])
  useEffect(() => () => {
    if (timeout.current !== null) window.clearTimeout(timeout.current)
  }, [])

  const clearPendingTimeout = () => {
    if (timeout.current === null) return
    window.clearTimeout(timeout.current)
    timeout.current = null
  }

  const flush = () => {
    clearPendingTimeout()
    pending.current = false
    if (latestText.current !== value) onValueChange(latestText.current)
    onPendingChange?.(false)
  }

  return (
    <input
      {...props}
      type="text"
      value={text}
      onChange={(event) => {
        const next = event.target.value
        pending.current = true
        latestText.current = next
        setText(next)
        onPendingChange?.(true)
        clearPendingTimeout()
        timeout.current = window.setTimeout(() => {
          timeout.current = null
          pending.current = false
          startTransition(() => onValueChange(next))
          onPendingChange?.(false)
        }, EDIT_DEBOUNCE_MS)
      }}
      onBlur={flush}
    />
  )
}
