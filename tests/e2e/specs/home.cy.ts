// Guest smoke test: runs without bridge_backend (CI has none), so the
// session check is stubbed as "not logged in" instead of waiting on a
// refused connection to localhost:8000.
describe('Home as a guest', () => {
  beforeEach(() => {
    cy.intercept('GET', '**/api/user', { statusCode: 401, body: { message: 'Unauthenticated.' } })
  })

  it('redirects / to /home and offers Log in and Create account', () => {
    cy.visit('/')
    cy.location('pathname').should('eq', '/home')
    cy.contains('ion-content h1', 'Bridge').should('be.visible')
    cy.contains('ion-button', 'Log in').should('be.visible')
    cy.contains('ion-button', 'Create account').should('be.visible')
  })

  it('goes to the Login page from Log in', () => {
    cy.visit('/home')
    cy.contains('ion-button', 'Log in').click()
    cy.location('pathname').should('eq', '/login')
    cy.contains('ion-title', 'Login').should('be.visible')
    cy.get('input[type="password"]').should('be.visible')
  })
})
