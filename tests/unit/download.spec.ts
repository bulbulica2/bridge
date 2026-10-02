import { afterEach, describe, expect, test, vi } from 'vitest'
import { copyText, downloadFile } from '@/utils/download'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('downloadFile', () => {
  test('clicks a hidden download link for a Blob, then lets the URL go', () => {
    vi.useFakeTimers()
    const createObjectURL = vi.fn(() => 'blob:board')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe('board-7.pbn')
      expect(this.href).toBe('blob:board')
      expect(document.body.contains(this)).toBe(true)
    })

    downloadFile('board-7.pbn', '[Board "7"]', 'text/plain')

    expect(click).toHaveBeenCalled()
    expect((createObjectURL.mock.calls[0] as unknown as [Blob])[0].type).toBe('text/plain')
    expect(document.querySelector('a[download]')).toBeNull()
    expect(revokeObjectURL).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1000)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:board')
    click.mockRestore()
  })
})

describe('copyText', () => {
  test('writes to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })

    await copyText('Board 7')

    expect(writeText).toHaveBeenCalledWith('Board 7')
  })

  test('rejects when there is no clipboard', async () => {
    vi.stubGlobal('navigator', {})

    await expect(copyText('Board 7')).rejects.toThrow('Clipboard unavailable')
  })
})
