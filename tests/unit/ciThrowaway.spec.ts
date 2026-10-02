// THROWAWAY (#87): proves CI goes red. Reverted before merge.
describe('CI throwaway', () => {
  it('fails on purpose', () => {
    if (true) {}
    expect(1).toBe(2)
  })
})
