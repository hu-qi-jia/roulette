interface ToggleProps {
  checked: boolean
  label: string
  onChange: () => void
}

export function Toggle({ checked, label, onChange }: ToggleProps): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`toggle switch ${checked ? 'on' : ''}`}
      onClick={onChange}
    />
  )
}
