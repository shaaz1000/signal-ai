import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/** Learn, Story Mode, languages, Creator Studio and the protected endpoints, on the fixture world. */
const results = (page: Page) => page.getByRole('main').getByRole('article');
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

async function openLearn(page: Page, query: string) {
  await page.goto(`/discover?q=${query}`);
  await results(page).first().getByRole('link').first().click();
  await page.getByRole('link', { name: 'Understand how it works' }).first().click();
  await expect(page).toHaveURL(/\/learn\/[a-f0-9]{12}/);
}

test.describe('Understand how it works', () => {
  test('explains at five depths and keeps sources apart from general background', async ({ page }) => {
    await openLearn(page, 'page-tracer');
    const tabs = page.getByRole('tablist');
    for (const name of ['Explain it simply', 'Everyday analogy', 'How it works', 'Deep technical breakdown', 'Real-world usage']) {
      await expect(tabs.getByRole('tab', { name })).toBeAttached();
    }
    await tabs.getByRole('tab', { name: 'How it works' }).click();
    const panel = page.getByRole('tabpanel');
    await expect(panel.getByText('From the sources')).toBeVisible();
    await expect(panel).toContainText('A headless browser captures the DOM');
    await expect(panel.getByText('How this kind of technology works (general)')).toBeVisible();
    await expect(panel.getByText('It is not a claim about this project', { exact: false })).toBeVisible();
  });

  test('says when the sources do not explain the mechanism', async ({ page }) => {
    await openLearn(page, 'legacy-toolkit');
    await page.getByRole('tablist').getByRole('tab', { name: 'How it works' }).click();
    await expect(page.getByRole('tabpanel')).toContainText('The sources do not describe this project’s own implementation');
    await expect(page.getByRole('tabpanel').getByText('From the sources')).toHaveCount(0);
  });

  test('remembers the chosen depth', async ({ page }) => {
    await openLearn(page, 'tiny-agent');
    await page.getByRole('tablist').getByRole('tab', { name: 'Deep technical breakdown' }).click();
    await expect(page.getByRole('tab', { name: 'Deep technical breakdown' })).toHaveAttribute('aria-selected', 'true');
    await page.reload();
    await expect(page.getByRole('tab', { name: 'Deep technical breakdown' })).toHaveAttribute('aria-selected', 'true');
  });

  test('steps through an illustrative diagram, by button and by keyboard, with a text alternative', async ({ page }) => {
    await openLearn(page, 'tiny-agent');
    await expect(page.getByRole('heading', { name: 'The agent loop' })).toBeVisible();
    await expect(page.getByText('Illustrative: shows how this kind of system generally works')).toBeVisible();
    await expect(page.getByText('Step 1 of 7', { exact: true })).toBeVisible();
    const next = page.getByRole('button', { name: 'Next step' });
    await next.click();
    await expect(page.getByText('Step 2 of 7', { exact: true })).toBeVisible();
    await next.focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByText('Step 3 of 7', { exact: true })).toBeVisible();
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByText('Step 2 of 7', { exact: true })).toBeVisible();

    // A node can be inspected; its detail appears as text.
    await page.getByRole('button', { name: /Human approval/ }).first().click();
    await expect(page.getByText('For risky actions a person confirms before the tool runs.')).toBeVisible();

    await page.getByText('Read as text').click();
    await expect(page.locator('details').getByText('A user goal goes to a model that plans a step')).toBeVisible();
  });

  test('uses a simulated image, never a real scan, for medical imaging', async ({ page }) => {
    await openLearn(page, 'X-ray');
    await expect(page.getByRole('heading', { name: 'From scan to clinical review' })).toBeVisible();
    await expect(page.getByText('Simulated image for illustration')).toBeVisible();
    await expect(page.getByRole('main').locator('img')).toHaveCount(0);
    await page.getByRole('tablist').getByRole('tab', { name: 'Real-world usage' }).click();
    await expect(page.getByRole('tabpanel')).toContainText('Stated maturity: Clinical trial');
  });

  test('does not widen the page on any viewport', async ({ page }) => {
    await openLearn(page, 'tiny-agent');
    expect(await overflow(page)).toBe(0);
    await page.getByRole('radio', { name: 'Story Mode' }).click();
    expect(await overflow(page)).toBe(0);
  });
});

test.describe('Story Mode', () => {
  test.beforeEach(async ({ page }) => {
    await openLearn(page, 'tiny-agent');
    await page.getByRole('radio', { name: 'Story Mode' }).click();
  });

  test('does not autoplay, and gives the whole story as a transcript without playing', async ({ page }) => {
    await expect(page.getByText('Scene 1 of 8', { exact: true })).toBeVisible();
    await page.waitForTimeout(1500);
    await expect(page.getByText('Scene 1 of 8', { exact: true })).toBeVisible();
    await page.getByText('Transcript', { exact: true }).click();
    for (const name of ['The problem', 'The innovation', 'Under the hood', 'Conceptual demonstration', 'Real-world applications', 'Limitations', 'Why it matters', 'What is next']) {
      await expect(page.getByRole('main').getByText(new RegExp(`Scene \\d: ${name}`)).first()).toBeAttached();
    }
  });

  test('navigates scenes by button and keyboard and reports progress', async ({ page }) => {
    await page.getByRole('button', { name: 'Next scene' }).click();
    await expect(page.getByText('Scene 2 of 8', { exact: true })).toBeVisible();
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', /\d+/);
    await page.getByRole('button', { name: 'Next scene' }).focus();
    await page.keyboard.press('End');
    await expect(page.getByText('Scene 8 of 8', { exact: true })).toBeVisible();
    await page.keyboard.press('Home');
    await expect(page.getByText('Scene 1 of 8', { exact: true })).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByText('Scene 2 of 8', { exact: true })).toBeVisible();
  });

  test('plays, advances on its own, pauses and changes speed', async ({ page }) => {
    await page.getByRole('radio', { name: '2x' }).click();
    await expect(page.getByRole('radio', { name: '2x' })).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
    await expect(page.getByText('Scene 2 of 8', { exact: true })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Pause' }).click();
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  });

  test('marks conceptual scenes as illustrative', async ({ page }) => {
    await expect(page.getByText('Illustrative', { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Next scene' }).click();
    // Scene 2 restates the record itself.
    await expect(page.getByRole('main')).toContainText('A 300-line agent loop');
  });

  test('under reduced motion nothing plays by itself and the transcript is open', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload();
    await page.getByRole('radio', { name: 'Story Mode' }).click();
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Next scene' })).toBeVisible();
    await expect(page.getByText(/Scene 8: What is next/).first()).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length)).toBe(0);
  });
});

test.describe('Languages', () => {
  test('switches general explanations and labels to Hindi and back instantly, and says what stays in English', async ({ page }) => {
    await openLearn(page, 'tiny-agent');
    await page.getByLabel('Language').selectOption('hi');
    const panel = page.getByRole('tabpanel');
    await expect(panel).toContainText(/[ऀ-ॿ]{3,}/);
    await expect(page.getByText('General explanations and labels are shown in Hindi.')).toBeVisible();
    await expect(page.getByText('shown in the original English', { exact: false })).toBeVisible();
    // Source text is never silently replaced.
    await expect(panel).toContainText('A 300-line agent loop that drives a browser');
    await expect(page.locator('article[lang="hi"]')).toBeVisible();

    await page.getByLabel('Show the original alongside').check();
    await expect(page.getByRole('heading', { name: 'Original (English)' })).toBeVisible();
    await expect(page.getByRole('main')).toContainText('An AI agent is a program that is given a goal');

    await page.getByLabel('Language').selectOption('en');
    await expect(page.getByRole('tabpanel').first()).not.toContainText(/[ऀ-ॿ]/);
  });

  test('offers Hinglish in Latin script and keeps the choice across pages', async ({ page }) => {
    await openLearn(page, 'tiny-agent');
    await page.getByLabel('Language').selectOption('hinglish');
    const panel = page.getByRole('tabpanel');
    await expect(panel).toContainText(/\b(hai|aur|ek|ko)\b/);
    await expect(panel).not.toContainText(/[ऀ-ॿ]/);
    await page.reload();
    await expect(page.getByLabel('Language')).toHaveValue('hinglish');
    await expect(page.getByRole('tabpanel')).toContainText(/\b(hai|aur|ek|ko)\b/);
  });

  test('is honest about a language with no bundled text and no provider', async ({ page }) => {
    await openLearn(page, 'tiny-agent');
    await page.getByLabel('Language').selectOption('fr');
    await expect(page.getByText('French is not bundled with this build.')).toBeVisible();
    await expect(page.getByText('No translation provider is configured on this server.')).toBeVisible();
    await expect(page.getByRole('tabpanel')).toContainText('An AI agent is a program');
  });
});

test.describe('Creator Studio and Content Radar', () => {
  test('drafts every format from the record, with sources and cautions', async ({ page }) => {
    await page.goto('/content');
    await expect(page.getByRole('heading', { level: 1, name: 'Content Radar' })).toBeVisible();
    await expect(page.getByRole('main').getByText('star-magnet')).toHaveCount(0); // unverified: never recommended
    await page.getByRole('main').getByRole('link', { name: 'Open in Studio' }).first().click();
    await expect(page).toHaveURL(/\/studio\/[a-f0-9]{12}/);
    await expect(page.getByRole('heading', { level: 1, name: 'Creator Studio' })).toBeVisible();
    for (const format of ['hooks', 'script-30', 'shorts', 'linkedin', 'article', 'explainer', 'deep-dive']) {
      await page.getByLabel('Format').selectOption(format);
      await expect(page.getByLabel('Draft').locator('section').first()).toBeVisible();
    }
    await page.getByLabel('Format').selectOption('story-video');
    await expect(page.getByLabel('Draft')).toContainText('Scene 1: The problem');
    await expect(page.getByLabel('Draft')).toContainText('no video file is rendered');
    await page.getByLabel('Tone').selectOption('documentary');
    await expect(page.getByRole('heading', { name: 'Sources to cite' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Do not state as fact' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copy draft' })).toBeVisible();
    expect(await overflow(page)).toBe(0);
  });
});

test.describe('Trending, models and industries', () => {
  test('lists trends with the evidence behind each status', async ({ page }) => {
    await page.goto('/trending');
    await expect(page.getByRole('heading', { level: 1, name: 'Trending' })).toBeVisible();
    await expect(page.getByText('2 days of snapshots').first()).toBeVisible();
    await expect(page.getByText('Trend score').first()).toBeVisible();
    await page.getByRole('radio', { name: 'Categories' }).click();
    await expect(page.getByRole('main').getByRole('listitem').first()).toBeVisible();
  });

  test('shows model facts and marks publisher claims', async ({ page }) => {
    await page.goto('/models');
    const card = results(page).filter({ hasText: 'small-coder-3b' });
    await expect(card.getByText('Open weights')).toBeVisible();
    await expect(card.getByText('apache-2.0')).toBeVisible();
    await expect(card.getByText('Publisher’s claims')).toBeVisible();
  });

  test('filters by industry and shows the stated maturity of a medical study', async ({ page }) => {
    await page.goto('/industries');
    await page.getByRole('button', { name: 'Healthcare and medicine' }).click();
    await expect(page).toHaveURL(/industry=healthcare/);
    const card = results(page).filter({ hasText: 'Chest X-ray' });
    await expect(card.getByText('Clinical trial')).toBeVisible();
    await card.getByRole('link').first().click();
    await expect(page.getByText('Stated maturity')).toBeVisible();
    await expect(page.getByRole('main')).toContainText('source says');
  });
});

test.describe('Protected generation endpoints', () => {
  test('never run paid work for an anonymous caller', async ({ request }) => {
    const id = (await (await request.get('/api/discoveries?q=tiny-agent')).json()).items[0].id as string;
    for (const [path, body] of [
      ['/api/translate', { discoveryId: id, language: 'hi' }],
      ['/api/generate', { discoveryId: id, kind: 'draft', variant: 'article:newsroom' }],
    ] as const) {
      const res = await request.post(path, { data: body });
      expect([401, 501, 503], `${path} -> ${res.status()}`).toContain(res.status());
      expect((await res.json()).code).toBeTruthy();
    }
    expect((await request.post('/api/translate', { data: { discoveryId: id, language: 'klingon' } })).status()).toBe(400);
    expect((await request.post('/api/translate', { data: 'not json', headers: { 'content-type': 'application/json' } })).status()).toBe(400);
    expect((await request.post('/api/admin/flags', { data: { key: 'generation_disabled', value: true } })).status()).toBeGreaterThanOrEqual(401);
    const me = await (await request.get('/api/me')).json();
    expect(me).toMatchObject({ signedIn: false, translationAvailable: false, generationAvailable: false });
    const cached = await request.get(`/api/content/${id}`);
    expect(cached.status()).toBe(200); // reading stored content needs no account
  });

  test('rejects a wrong access token with a clear message', async ({ page }) => {
    await page.goto('/account');
    await page.getByLabel('Access token').fill('definitely-not-a-token');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert').filter({ hasText: /not accepted|Too many attempts/ })).toBeVisible();
  });
});

test.describe('Accessibility of the new pages (axe)', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`Learn, Story Mode and Studio have no serious violations in ${scheme} mode`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      const scan = async (label: string) => {
        const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
        expect(violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${label} ${v.id}: ${v.nodes[0]?.html.slice(0, 110)}`)).toEqual([]);
      };
      await openLearn(page, 'tiny-agent');
      await expect(page.getByText('Step 1 of 7', { exact: true })).toBeVisible();
      await scan('learn');
      await page.getByRole('radio', { name: 'Story Mode' }).click();
      await expect(page.getByText('Scene 1 of 8', { exact: true })).toBeVisible();
      // Let the scene text finish fading in; a scan mid-fade measures the half-transparent colour.
      await page.waitForTimeout(600);
      await scan('story');
      await page.getByRole('link', { name: 'Create content' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Creator Studio' })).toBeVisible();
      await scan('studio');
      await page.goto('/trending');
      await expect(page.getByRole('heading', { level: 1, name: 'Trending' })).toBeVisible();
      await scan('trending');
    });
  }
});
