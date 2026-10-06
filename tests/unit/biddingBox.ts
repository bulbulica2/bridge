import type { VueWrapper } from '@vue/test-utils'

// Makes a call through the bidding box as a player does (#160): a level and
// a strain (or Pass, X, XX), then the confirm. `call` is the bid's code:
// '2C', '3NT', 'P', 'X', 'XX'.
export async function bidWith(wrapper: VueWrapper, call: string) {
  const box = wrapper.get('.bidding-box')
  const bid = /^(\d)(C|D|H|S|NT)$/.exec(call)
  if (bid) {
    await box.get(`button[data-level="${bid[1]}"]`).trigger('click')
    await box.get(`button[data-strain="${bid[2]}"]`).trigger('click')
  } else {
    await box.get(`button[data-call="${call}"]`).trigger('click')
  }
  await box.get('.confirm-call').trigger('click')
}
