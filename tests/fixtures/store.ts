import type { On } from 'claude-code'

/**
 * Answers `$.store` from a map the test can read afterwards, so a test can
 * see what the court saved and what it left alone.
 *
 * @param on the test's `on`
 * @param entries what the store holds at the start
 */
export const memoryStore = (on: On, entries: Readonly<Record<string, unknown>> = {}): Map<string, unknown> => {
  const saved = new Map<string, unknown>(Object.entries(entries))
  on('store.get', ($, e) => ({ value: saved.get(e.key) }))
  on('store.set', ($, e) => {
    saved.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.delete', ($, e) => {
    saved.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...saved.keys()] }))
  return saved
}
