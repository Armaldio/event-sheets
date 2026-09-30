import { expect, test } from '@playwright/test'

test('previews the event sheet and exposes trace, targets, variables, and diagnostics', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Developer tools' })).toBeVisible()
  await page.locator('[data-node-id="construct:event-checkpoint"] .event-select').click()
  await expect(page.getByLabel('Current selection state')).toContainText('construct:event-checkpoint')

  await page.getByRole('button', { name: 'Run preview' }).click()

  await expect(page.locator('[data-test="execution-trace"]')).toContainText('Player.set-x')
  await expect(page.locator('[data-test="action-targets"]')).toContainText('player-1')
  await expect(page.locator('[data-test="action-targets"]')).toContainText('190')
  await expect(page.locator('[data-test="runtime-variables"]')).toContainText('score')
  await expect(page.locator('[data-test="debug-diagnostics"]')).toContainText('construct.runtime.unsupported-action')
  expect(pageErrors).toEqual([])
})

test('streams source into a rendered editor without browser warnings', async ({ page }) => {
  const consoleWarnings: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'warning' || message.type() === 'error') consoleWarnings.push(message.text())
  })

  await page.goto('/')
  await page.getByRole('button', { name: 'Start stream' }).click()
  const nextChunk = page.getByRole('button', { name: 'Next chunk' })
  for (let step = 0; step < 100 && await nextChunk.isEnabled(); step += 1) {
    await nextChunk.click()
  }

  await expect(page.getByRole('status')).toContainText('Stream complete')
  await expect(page.locator('[data-node-id="construct:event-checkpoint"]')).toBeVisible()
  expect(consoleWarnings).toEqual([])
})
