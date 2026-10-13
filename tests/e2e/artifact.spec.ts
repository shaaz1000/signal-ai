import { expect, test, type Page } from '@playwright/test';

/**
 * The Claude Artifact build, served the way the Artifact host serves it. It
 * has no server: everything comes from one snapshot file, so loading, failure
 * and refresh are all client-side states and are tested here.
 */
const ARTIFACT = 'http://localhost:3101/';
const results = (page: Page) => page.getByRole('main').getByRole('article');

test('loads the snapshot and says it is a snapshot of fixture data', async ({ page }) => {
  await page.goto(ARTIFACT);
  await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
  await expect(page.getByText('demonstration fixtures for interface development')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reload snapshot' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Read the brief' })).toBeVisible();
});

test('shows a loading skeleton while the snapshot is in flight', async ({ page }) => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/snapshot.json', async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto(ARTIFACT);
  await expect(page.getByRole('status').filter({ hasText: 'Loading the discovery snapshot' })).toBeAttached();
  await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toHaveCount(0);
  release();
  await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
});

test('explains a failed request and recovers on retry', async ({ page }) => {
  await page.route('**/snapshot.json', (route) => route.fulfill({ status: 503, body: 'unavailable' }));
  await page.goto(ARTIFACT);
  await expect(page.getByRole('alert')).toContainText('The discovery snapshot could not be loaded');
  await expect(page.getByRole('alert')).toContainText('HTTP 503');
  await page.unroute('**/snapshot.json');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
});

test('rejects a snapshot in the wrong format instead of rendering it', async ({ page }) => {
  await page.route('**/snapshot.json', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"hello":"world"}' }));
  await page.goto(ARTIFACT);
  await expect(page.getByRole('alert')).toContainText('not in the expected format');
});

test('keeps showing data when a later refresh fails', async ({ page }) => {
  await page.goto(ARTIFACT);
  await expect(page.getByRole('link', { name: 'Read the brief' })).toBeVisible();
  await page.route('**/snapshot.json', (route) => route.abort());
  await page.getByRole('button', { name: 'Reload snapshot' }).click();
  await expect(page.getByRole('link', { name: 'Read the brief' })).toBeVisible();
});

test('routes with bare hash links, including deep links to a section and an item', async ({ page }) => {
  await page.goto(`${ARTIFACT}#radar`);
  await expect(page.getByRole('heading', { level: 1, name: 'GitHub Radar' })).toBeVisible();
  await results(page).first().getByRole('link').first().click();
  await expect(page).toHaveURL(/#d-[a-f0-9]{12}$/);
  await expect(page.getByRole('heading', { level: 2, name: 'What is it?' })).toBeVisible();
  const deepLink = page.url();
  await page.goto('about:blank');
  await page.goto(deepLink);
  await expect(page.getByRole('heading', { level: 2, name: 'What is it?' })).toBeVisible();
  await page.goBack();
  await page.goto(`${ARTIFACT}#d-000000000000`);
  await expect(page.getByRole('heading', { name: 'That discovery is not in this snapshot' })).toBeVisible();
});

test('searches, filters and keeps the filters while navigating', async ({ page }) => {
  await page.goto(`${ARTIFACT}#discover`);
  await page.getByRole('searchbox', { name: /Search titles/ }).fill('tiny-agent');
  await expect(results(page)).toHaveCount(1);
  await page.getByRole('button', { name: 'Reset filters' }).click();
  await page.getByRole('button', { name: 'Agents', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Agents', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.goto(`${ARTIFACT}#radar`);
  await expect(page.getByRole('heading', { level: 1, name: 'GitHub Radar' })).toBeVisible();
  await page.goto(`${ARTIFACT}#discover`);
  await expect(page.getByRole('button', { name: 'Agents', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('saves bookmarks and the theme in the browser across reloads', async ({ page }) => {
  await page.goto(`${ARTIFACT}#discover`);
  await page.getByRole('button', { name: /^Save / }).first().click();
  await page.goto(`${ARTIFACT}#settings`);
  await page.getByRole('radio', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.goto(`${ARTIFACT}#bookmarks`);
  await expect(page.getByRole('main').getByRole('listitem')).toHaveCount(1);
  await expect(page.getByText('Saved in this browser only')).toBeVisible();
});

test('never contacts another host', async ({ page }) => {
  const hosts = new Set<string>();
  page.on('request', (r) => hosts.add(new URL(r.url()).host));
  await page.goto(ARTIFACT);
  await expect(page.getByRole('link', { name: 'Read the brief' })).toBeVisible();
  await page.goto(`${ARTIFACT}#radar`);
  await expect(results(page).first()).toBeVisible();
  // React comes from the one CDN the Artifact content policy allows; data comes from the page's own origin.
  expect([...hosts].sort()).toEqual(['cdnjs.cloudflare.com', 'localhost:3101']);
});

for (const token of ['today', 'discover', 'radar', 'research', 'gems', 'weekly', 'bookmarks', 'settings', 'status', 'more']) {
  test(`no horizontal overflow on #${token}`, async ({ page }) => {
    await page.goto(`${ARTIFACT}#${token}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  });
}
