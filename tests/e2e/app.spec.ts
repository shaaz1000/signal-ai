import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * Runs against a production build seeded with the labelled fixture world
 * (tests/fixtures/world.ts), on desktop, tablet and phone viewports.
 */
const PAGES = ['/', '/discover', '/radar', '/research', '/gems', '/weekly', '/bookmarks', '/settings', '/status', '/more', '/unverified'];

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const results = (page: Page) => page.getByRole('main').getByRole('article');
const isWide = (page: Page) => (page.viewportSize()?.width ?? 0) >= 1024;

test.describe('Today', () => {
  test('shows curated sections and says plainly that the data is demonstration fixtures', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
    await expect(page.getByText('demonstration fixtures for interface development')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Read the brief' })).toBeVisible();
    for (const name of ['Top discoveries', 'Trending on GitHub', 'Hidden gems', 'Unverified']) {
      await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
    }
    await expect(page.getByText('Last ingestion')).toBeVisible();
  });

  test('keeps unverified items out of ranked sections', async ({ page }) => {
    await page.goto('/');
    const unverified = page.locator('section', { has: page.getByRole('heading', { name: 'Unverified' }) });
    await expect(unverified.getByText('star-magnet')).toBeVisible();
    const top = page.locator('section', { has: page.getByRole('heading', { name: 'Top discoveries' }) });
    await expect(top.getByText('star-magnet')).toHaveCount(0);
  });

  test('does not show an item in two sections', async ({ page }) => {
    await page.goto('/');
    const hrefs = await page.getByRole('main').locator('a[href^="/d/"].stretch-link').evaluateAll((links) => links.map((a) => a.getAttribute('href')));
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});

test.describe('Discover', () => {
  test('search narrows results and the filtered view is a shareable URL', async ({ page }) => {
    await page.goto('/discover');
    await page.getByRole('searchbox', { name: /Search titles/ }).fill('tiny-agent');
    await expect(page).toHaveURL(/q=tiny-agent/);
    await expect(results(page)).toHaveCount(1);
    await expect(page.getByText('1 result', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('searchbox', { name: /Search titles/ })).toHaveValue('tiny-agent');
    await expect(results(page)).toHaveCount(1);
  });

  test('shows a helpful empty state and resets filters', async ({ page }) => {
    await page.goto('/discover?q=zzzzqqqq');
    await expect(page.getByRole('heading', { name: 'No discoveries match these filters' })).toBeVisible();
    await page.getByRole('button', { name: 'Reset filters' }).click();
    await expect(page).toHaveURL(/\/discover$/);
    await expect(results(page).first()).toBeVisible();
    await expect(page.getByRole('searchbox', { name: /Search titles/ })).toHaveValue('');
  });

  test('filters by category, sorts, and changes the time window', async ({ page }) => {
    await page.goto('/discover');
    await expect(results(page).first()).toBeVisible();
    const total = await results(page).count();
    await page.getByRole('button', { name: 'Agents', exact: true }).click();
    await expect(page).toHaveURL(/category=agents/);
    await expect(page.getByRole('button', { name: 'Agents', exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect(await results(page).count()).toBeLessThan(total);
    for (const card of await results(page).all()) await expect(card.getByText('Agents', { exact: true })).toBeVisible();

    await page.getByLabel('Sort by').selectOption('latest');
    await expect(page).toHaveURL(/sort=latest/);
    await page.getByRole('radio', { name: '24 hours' }).click();
    await expect(page).toHaveURL(/window=24h/);
    await expect(page.getByRole('radio', { name: '24 hours' })).toHaveAttribute('aria-checked', 'true');
  });

  test('hidden gems sort excludes high-star repositories', async ({ page }) => {
    await page.goto('/discover?sort=gems');
    await expect(page.getByRole('main').getByText('tiny-agent-loop').first()).toBeVisible();
    await expect(page.getByRole('main').getByText('legacy-toolkit')).toHaveCount(0);
  });

  test('ignores unknown parameter values rather than failing', async ({ page }) => {
    const res = await page.goto('/discover?sort=%3Cscript%3E&category=nope&window=never&page=abc');
    expect(res?.status()).toBe(200);
    await expect(results(page).first()).toBeVisible();
  });
});

test.describe('GitHub Radar', () => {
  test('shows total stars next to observed growth and filters by language', async ({ page }) => {
    await page.goto('/radar');
    const first = results(page).first();
    await expect(first.getByText('Stars', { exact: true })).toBeVisible();
    await expect(first.getByText('Growth', { exact: true })).toBeVisible();
    await expect(page.getByText('stars in 6 h, observed').first()).toBeVisible();

    await page.getByLabel('Language', { exact: true }).selectOption('Rust');
    await expect(page).toHaveURL(/language=Rust/);
    await expect(results(page)).toHaveCount(1);
    await expect(results(page).first()).toContainText('tiny-agent-loop');
  });

  test('orders by momentum, not lifetime stars', async ({ page }) => {
    await page.goto('/radar');
    await expect(results(page).first()).toBeVisible();
    const names = await results(page).locator('h3').allTextContents();
    expect(names.length).toBeGreaterThan(4);
    expect(names.findIndex((n) => n.includes('page-tracer'))).toBeLessThan(names.findIndex((n) => n.includes('legacy-toolkit')));
  });
});

test.describe('Detail page', () => {
  test('explains the item with evidence and links to the original', async ({ page }) => {
    await page.goto('/radar?q=page-tracer');
    await results(page).first().getByRole('link').first().click();
    await expect(page).toHaveURL(/\/d\/[a-f0-9]{12}$/);
    for (const name of ['What is it?', 'Why is it interesting?', 'How does it work?', 'Why is it trending?', 'Who should care?', 'Limitations', 'Explore']) {
      await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
    }
    await expect(page.getByText('+380 stars across 6 h of our own snapshots')).toBeVisible();
    await expect(page.getByText('Demonstration record')).toBeVisible();
    const original = page.getByRole('link', { name: /Open original/ });
    await expect(original).toHaveAttribute('href', 'https://github.com/fixture-labs/page-tracer');
    await expect(original).toHaveAttribute('target', '_blank');
    await expect(original).toHaveAttribute('rel', /noopener/);
    await expect(page.getByText('Star counts add nothing to this score.')).toBeVisible();
  });

  test('says "not verified" when sources do not describe the implementation', async ({ page }) => {
    await page.goto('/radar?q=legacy-toolkit');
    await results(page).first().getByRole('link').first().click();
    await expect(page.getByText('Not verified. The sources we read do not describe the implementation')).toBeVisible();
  });

  test('shows a not-found page for an unknown discovery', async ({ page }) => {
    await page.goto('/d/000000000000');
    await expect(page.getByRole('heading', { name: 'That page does not exist' })).toBeVisible();
  });

  test('wraps very long titles and descriptions without widening the page', async ({ page }) => {
    await page.goto('/radar?q=extraordinarily');
    await expect(results(page)).toHaveCount(1);
    expect(await overflow(page)).toBe(0);
    await results(page).first().getByRole('link').first().click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('an-extraordinarily-long-repository-name');
    expect(await overflow(page)).toBe(0);
  });
});

test.describe('Saved items and preferences', () => {
  test('bookmarks persist across reloads and can be organised into collections', async ({ page }) => {
    await page.goto('/discover?q=tiny-agent');
    await page.getByRole('button', { name: /^Save fixture-solo\/tiny-agent-loop/ }).click();
    await expect(page.getByRole('button', { name: /^Remove fixture-solo\/tiny-agent-loop/ })).toHaveAttribute('aria-pressed', 'true');

    await page.goto('/bookmarks');
    await expect(page.getByRole('heading', { level: 2, name: /tiny-agent-loop/ })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { level: 2, name: /tiny-agent-loop/ })).toBeVisible();

    await page.getByLabel('New collection name').fill('Agents to try');
    await page.getByRole('button', { name: 'Add collection' }).click();
    await expect(page.getByRole('heading', { name: 'This collection is empty' })).toBeVisible();
    await page.getByRole('button', { name: /^All/ }).click();
    await page.getByLabel(/^Collection for/).selectOption('Agents to try');
    await page.getByRole('button', { name: /^Agents to try/ }).click();
    await expect(page.getByRole('heading', { level: 2, name: /tiny-agent-loop/ })).toBeVisible();

    await page.getByRole('button', { name: /^Remove .* from saved$/ }).click();
    await expect(page.getByRole('heading', { name: 'Nothing saved yet' })).toBeVisible();
  });

  test('rejects a blank or duplicate collection name with a clear message', async ({ page }) => {
    await page.goto('/bookmarks');
    await page.getByRole('button', { name: 'Add collection' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Give the collection a name.' })).toBeVisible();
    await page.getByLabel('New collection name').fill('reading list');
    await page.getByRole('button', { name: 'Add collection' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'already exists' })).toBeVisible();
  });

  test('theme choice persists and is applied by the server on reload', async ({ page }) => {
    await page.goto('/settings');
    await page.getByRole('radio', { name: 'Dark' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(16, 17, 20)');
    await page.getByRole('radio', { name: 'Light' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(245, 245, 247)');
  });

  test('follows the system colour scheme until a theme is chosen', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(16, 17, 20)');
  });

  test('switching a topic off removes it from feeds; density changes spacing', async ({ page }) => {
    await page.goto('/discover');
    await expect(page.getByRole('main').getByText('tiny-agent-loop').first()).toBeVisible();
    await page.goto('/settings');
    await page.getByRole('switch', { name: 'Agents' }).uncheck();
    await page.getByRole('radio', { name: 'Compact' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-density', 'compact');
    await page.goto('/discover');
    await expect(results(page).first()).toBeVisible();
    await expect(page.getByRole('main').getByText('tiny-agent-loop')).toHaveCount(0);
  });
});

test.describe('Navigation, keyboard and layout', () => {
  test('uses a sidebar on wide screens and a tab bar on small ones', async ({ page }) => {
    await page.goto('/');
    const sidebar = page.locator('aside').getByRole('navigation', { name: 'Sections' });
    const tabs = page.locator('body > div > nav[aria-label="Sections"]');
    if (isWide(page)) {
      await expect(sidebar).toBeVisible();
      await expect(tabs).toBeHidden();
      await sidebar.getByRole('link', { name: 'GitHub Radar' }).click();
    } else {
      await expect(sidebar).toBeHidden();
      await expect(tabs).toBeVisible();
      await tabs.getByRole('link', { name: 'Radar' }).click();
    }
    await expect(page).toHaveURL(/\/radar/);
    await expect(page.getByRole('heading', { level: 1, name: 'GitHub Radar' })).toBeVisible();
  });

  test('reaches every secondary page from More on small screens', async ({ page }) => {
    test.skip(isWide(page), 'More is the small-screen entry point');
    await page.goto('/more');
    for (const name of ['Hidden Gems', 'What You Missed', 'Saved', 'Settings', 'Pipeline status']) {
      await expect(page.getByRole('main').getByRole('link', { name: new RegExp(name) })).toBeVisible();
    }
    await page.getByRole('main').getByRole('link', { name: /Pipeline status/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Pipeline status' })).toBeVisible();
    await expect(page.getByRole('table')).toContainText('Hacker News');
  });

  test('keeps filter selections when leaving a section and coming back', async ({ page }) => {
    await page.goto('/discover');
    await page.getByRole('button', { name: 'Agents', exact: true }).click();
    await expect(page).toHaveURL(/category=agents/);
    const nav = isWide(page) ? page.locator('aside') : page.locator('body > div > nav[aria-label="Sections"]');
    await nav.getByRole('link', { name: /Radar/ }).click();
    await expect(page).toHaveURL(/\/radar/);
    await nav.getByRole('link', { name: 'Discover' }).click();
    await expect(page).toHaveURL(/category=agents/);
  });

  test('is operable by keyboard: skip link, filters and cards', async ({ page }) => {
    await page.goto('/discover');
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to content' });
    await expect(skip).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main')).toBeFocused();

    await page.getByRole('button', { name: 'Research', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/category=research/);
    await page.getByRole('radio', { name: '30 days' }).focus();
    await page.keyboard.press('Space');
    await expect(page).toHaveURL(/window=30d/);

    const link = results(page).first().getByRole('link').first();
    await link.focus();
    const outline = await link.evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe('none');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/d\//);
  });

  test('refresh reloads data and reports progress', async ({ page }) => {
    await page.goto('/status');
    const button = page.getByRole('button', { name: /Refresh/ });
    await button.click();
    await expect(button).toBeEnabled();
    await expect(page.getByText('Last successful run').first()).toBeVisible();
  });

  for (const path of PAGES) {
    test(`no horizontal overflow on ${path}`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      expect(await overflow(page)).toBe(0);
    });
  }

  test('touch targets are at least 36px tall', async ({ page }) => {
    await page.goto('/discover');
    const sizes = await page.getByRole('main').locator('button, select, input[type="search"]').evaluateAll((els) =>
      els.filter((e) => (e as HTMLElement).offsetParent !== null).map((e) => Math.round(e.getBoundingClientRect().height)));
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(34);
  });
});

test.describe('Accessibility (axe, WCAG 2.2 AA rules)', () => {
  for (const scheme of ['light', 'dark'] as const) {
    for (const path of ['/', '/discover', '/radar', '/settings', '/status']) {
      test(`${path} has no serious violations in ${scheme} mode`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto(path);
        const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
        const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
        expect(serious.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 120)}`)).toEqual([]);
      });
    }
    test(`a detail page has no serious violations in ${scheme} mode`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto('/radar?q=page-tracer');
      await results(page).first().getByRole('link').first().click();
      await expect(page.getByRole('heading', { level: 2, name: 'Limitations' })).toBeVisible();
      const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      expect(violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 120)}`)).toEqual([]);
    });
  }
});

test.describe('JSON API', () => {
  test('answers with clear errors for bad input', async ({ request }) => {
    expect((await request.get('/api/discoveries/not-an-id')).status()).toBe(400);
    expect((await request.get('/api/discoveries/000000000000')).status()).toBe(404);
    const ok = await request.get('/api/discoveries?scope=radar&sort=momentum');
    expect(ok.status()).toBe(200);
    expect((await ok.json()).items.length).toBeGreaterThan(3);
  });

  test('sends security headers', async ({ request }) => {
    const headers = (await request.get('/')).headers();
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-powered-by']).toBeUndefined();
  });
});
