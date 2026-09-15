// Store unit test template, modeled on tests/unit/authStore.spec.ts.
// Save as tests/unit/<domain>Store.spec.ts. Tests live under tests/, not next to source.
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { use__Domain__Store } from '@/stores/__domain__'
import * as __domain__Service from '@/services/__domain__'

vi.mock('@/services/__domain__', () => ({
  list__Items__: vi.fn(),
  create__Item__: vi.fn(),
}))

describe('__domain__ store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  test('create adds the new item', async () => {
    const item = { id: 1 }
    vi.mocked(__domain__Service.create__Item__).mockResolvedValue(item)

    const store = use__Domain__Store()
    await store.create({})

    expect(__domain__Service.create__Item__).toHaveBeenCalledWith({})
    expect(store.items).toEqual([item])
  })

  test('failed create leaves state unchanged', async () => {
    vi.mocked(__domain__Service.create__Item__).mockRejectedValue(new Error('422'))

    const store = use__Domain__Store()
    await expect(store.create({})).rejects.toThrow()

    expect(store.items).toEqual([])
  })
})
