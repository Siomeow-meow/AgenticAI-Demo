import { useEffect, useState } from 'react'

const start = <T>(initial: T | (() => T)): T => (typeof initial === 'function' ? (initial as () => T)() : initial)

/** useState that persists to localStorage; falls back to memory if storage is unavailable. */
export function useLocalStorage<T>(key: string, initial: T | (() => T)) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw ? (JSON.parse(raw) as T) : start(initial)
    } catch {
      return start(initial)
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      /* storage unavailable or full */
    }
  }, [key, value])

  return [value, setValue] as const
}
