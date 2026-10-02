// THROWAWAY (#87): proves e2e goes red and uploads screenshots. Reverted before merge.
describe('CI throwaway', () => {
  it('fails on purpose', () => {
    cy.intercept('GET', '**/api/user', { statusCode: 401, body: {} })
    cy.visit('/home')
    cy.contains('ion-content h1', 'Not on this page', { timeout: 1000 })
  })
})
