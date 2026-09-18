import { AUTH_PASSWORD } from '../../playwright.config';
import { expect, test } from '../fixtures/test';

/**
 * Runs against the second server, the one booted with `ACCESS_PASSWORD` set.
 *
 * Authentication is decided per request from the environment, so the only
 * honest way to cover both states is to have both running. Everything here is
 * invisible to the default deployment, where `/login` redirects away instantly.
 */
test.describe('dashboard login', () => {
  test('sends an unauthenticated visitor to the login page', async ({
    page,
  }) => {
    await page.goto('/');

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByLabel('Password')).toBeVisible();
  });

  test('reports that auth is required', async ({ request }) => {
    const response = await request.get('/v1/super-agents/auth/status');

    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({
      authRequired: true,
      authenticated: false,
    });
  });

  test('rejects the wrong password', async ({ page }) => {
    await page.goto('/login');

    await page.getByLabel('Password').fill('definitely-not-the-password');
    await page.getByRole('button', { name: 'Login' }).click();

    // Still on /login is the assertion that matters; a wrong password must not
    // reach the dashboard regardless of how the error is presented.
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByLabel('Password')).toBeVisible();
  });

  test('accepts the right password and lands on the dashboard', async ({
    page,
  }) => {
    await page.goto('/login');

    await page.getByLabel('Password').fill(AUTH_PASSWORD);
    await page.getByRole('button', { name: 'Login' }).click();

    await expect(page).toHaveURL(/\/agents$/);
    await expect(
      page.getByRole('heading', { name: 'Agents', exact: true }),
    ).toBeVisible();
  });

  test('keeps the session across a reload', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Password').fill(AUTH_PASSWORD);
    await page.getByRole('button', { name: 'Login' }).click();
    await expect(page).toHaveURL(/\/agents$/);

    // The session is a JWT cookie, so a reload must not bounce back to /login.
    await page.reload();

    await expect(page).toHaveURL(/\/agents$/);
  });

  test('rejects the wrong password at the API', async ({ request }) => {
    const response = await request.post('/v1/super-agents/auth/login', {
      data: { password: 'definitely-not-the-password' },
    });

    expect(response.status()).toBe(401);
    expect(await response.json()).toEqual({ error: 'Invalid password' });
  });
});
