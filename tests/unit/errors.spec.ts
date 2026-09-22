import { AxiosError, AxiosHeaders } from 'axios'
import { describe, expect, test } from 'vitest'
import { errorMessage, fieldErrors, statusOf } from '@/utils/errors'

function axiosError(status: number, data: unknown): AxiosError {
  const config = { headers: new AxiosHeaders() }
  const error = new AxiosError('Request failed', 'ERR_BAD_REQUEST', config)
  error.response = { status, data, statusText: '', headers: {}, config }
  return error
}

// No response at all: the request never reached the server.
function networkError(): AxiosError {
  return new AxiosError('Network Error', 'ERR_NETWORK', { headers: new AxiosHeaders() })
}

describe('errorMessage', () => {
  test('prefers the first field error of a 422', () => {
    const e = axiosError(422, {
      message: 'The given data was invalid.',
      errors: { seat: ['The selected seat is invalid.'] },
    })

    expect(errorMessage(e, 'fallback')).toBe('The selected seat is invalid.')
  })

  test('uses the message of a game-envelope error', () => {
    const e = axiosError(409, { status: 409, message: 'Seat E is already taken.', data: [] })

    expect(errorMessage(e, 'fallback')).toBe('Seat E is already taken.')
  })

  test('uses the message of a bare auth/policy error', () => {
    const e = axiosError(403, { message: 'Only the table creator can remove other players.' })

    expect(errorMessage(e, 'fallback')).toBe('Only the table creator can remove other players.')
  })

  test('reports an unreachable server when there is no response', () => {
    expect(errorMessage(networkError(), 'fallback')).toBe(
      'Cannot reach the server. Please try again later.',
    )
  })

  test('falls back when the response carries no message', () => {
    expect(errorMessage(axiosError(500, {}), 'fallback')).toBe('fallback')
  })

  test('falls back for an error axios never produced', () => {
    expect(errorMessage(new Error('boom'), 'fallback')).toBe('fallback')
  })
})

describe('statusOf', () => {
  test('returns the status of an axios error', () => {
    expect(statusOf(axiosError(404, {}))).toBe(404)
  })

  test('returns null when the request never got a response', () => {
    expect(statusOf(networkError())).toBeNull()
  })

  test('returns null for a non-axios error', () => {
    expect(statusOf(new Error('boom'))).toBeNull()
  })
})

describe('fieldErrors', () => {
  test('keeps the first message of each field of a 422', () => {
    const e = axiosError(422, {
      message: 'The name field is required. (and 1 more error)',
      errors: {
        name: ['The name field is required.'],
        description: ['The description field must not be greater than 1000 characters.', 'Other.'],
      },
    })

    expect(fieldErrors(e)).toEqual({
      name: 'The name field is required.',
      description: 'The description field must not be greater than 1000 characters.',
    })
  })

  test('is empty for anything that is not a validation error', () => {
    expect(fieldErrors(axiosError(401, { message: 'Unauthenticated.' }))).toEqual({})
    expect(fieldErrors(networkError())).toEqual({})
    expect(fieldErrors(new Error('boom'))).toEqual({})
  })
})
