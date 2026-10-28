import { startTransition, useEffect, useState } from 'react'
import type { InputHTMLAttributes } from 'react'

interface DraftTextInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onBlur' | 'onChange' | 'type' | 'value'> {
  value: string
  onValueChange: (value: string) => void
}

export function DraftTextInput({ value, onValueChange, ...props }: DraftTextInputProps) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])

  return (
    <input
      {...props}
      type="text"
      value={text}
      onChange={(event) => {
        const next = event.target.value
        setText(next)
        startTransition(() => onValueChange(next))
      }}
      onBlur={() => { if (text !== value) onValueChange(text) }}
    />
  )
}
