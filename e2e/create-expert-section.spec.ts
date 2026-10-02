import { test, expect, type Page } from '@playwright/test'
import { tauriMockInit, DEFAULT_ASSISTANT_REPLY, DEFAULT_MODEL_NAME, type TauriMockOptions } from './support/tauri-mock'
import { routeCloud, seedOnboardingDone, appReady } from './support/cloud-mock'

/**
 * Der Expert-Abschnitt in Create, Spur fuer Spur.
 *
 * Der Kundenfall dahinter ist die Discord-Meldung vom 08.09.2026, "Expert
 * section shows nothing", Windows 11. Der Abschnitt ist in ParamGroups.tsx an
 * zwei Bedingungen gehaengt, die nichts miteinander zu tun haben:
 *
 *   isMlxLocal = !isCloud && isMlxImageHost()
 *   showExpert = !isMlxLocal && (!isCloud || isEdit)
 *
 * Beide Bedingungen konnten bisher nur gelesen, nicht gemessen werden. Genau
 * das ist die Luecke, in die die Meldung faellt: ein Nutzer, der den Abschnitt
 * nicht sieht, kann nicht unterscheiden, ob er absichtlich weg ist (Cloud ohne
 * Edit, lokaler Mac) oder ob er kaputt ist. Die drei Faelle hier messen die
 * drei Lagen, aus denen die Meldung kommen kann, und jeder haelt die Spur
 * fest, in der er misst.
 *
 * Die Plattform wird in jedem Fall auf 'windows' gepinnt. Ohne den Pin liest
 * isMlxImageHost() den Entwicklerrechner (Mac), und dann sagt die Spezifikation
 * etwas ueber diesen Laptop statt ueber die Windows-Maschine des Melders.
 */

const WINDOWS_OPTS: TauriMockOptions = {
  assistantReply: DEFAULT_ASSISTANT_REPLY,
  modelName: DEFAULT_MODEL_NAME,
  platform: 'windows',
}

/** Die Schublade selbst. ParamGroups wird nur hier gerendert. */
function drawer(page: Page) {
  return page.locator('aside').filter({ hasText: 'Advanced settings' })
}

/** Der Kopf des Expert-Abschnitts. Fehlt showExpert, fehlt der Kopf. */
function expertHead(page: Page) {
  return drawer(page).getByRole('button', { name: 'Expert', exact: true })
}

/**
 * Der Pfeil im Kopf. Section.tsx haengt ihm 'rotate-90' an, solange der
 * Abschnitt offen ist. Der Pfeil ist damit die einzige Stelle, an der ein
 * zugeklappter Abschnitt von einem fehlenden zu unterscheiden ist: die Kinder
 * liegen im zugeklappten Zustand nicht im DOM (AnimatePresence).
 */
function expertChevron(page: Page) {
  return expertHead(page).locator('svg.lucide-chevron-right')
}

/** Eine beschriftete Zeile im Abschnitt, egal ob Slider oder Select. */
function row(page: Page, label: string) {
  return drawer(page).getByText(label, { exact: true })
}

/** Der Select, der zu einem Feld gehoert: Beschriftungszeile, dann Bedienteil. */
function fieldSelect(page: Page, label: string) {
  return row(page, label)
    .locator('xpath=../following-sibling::div[1]')
    .locator('button[aria-haspopup="listbox"]')
}

/**
 * Die Schublade oeffnen und warten, bis sie wirklich gefuellt ist.
 *
 * 'Quality' ist die Positivkontrolle dieser Spezifikation: der Abschnitt steht
 * unter keiner Bedingung und ist defaultOpen. Sieht ein Fall ihn, dann ist die
 * Schublade offen und ParamGroups gerendert, und ein fehlender Expert-Kopf ist
 * eine Aussage ueber showExpert statt ueber eine leere Schublade.
 */
async function openDrawer(page: Page) {
  await page.getByRole('button', { name: 'Advanced settings' }).click()
  await expect(drawer(page).getByRole('button', { name: 'Quality', exact: true })).toBeVisible({ timeout: 15_000 })
}

/**
 * Die Schublade schliessen.
 *
 * Ueber den X-Knopf, nie ueber Escape: Drawer.tsx haengt an Escape, und der
 * Select in ParamGroups ebenfalls, also schliesst eine Escape-Taste hier mehr
 * als gemeint. Noetig ist das Schliessen, weil der Scrim der Schublade
 * (absolute inset-0 z-40) ueber der IntentBar liegt: ein Klick auf eine Spur
 * bei offener Schublade trifft den Scrim, nicht die Spur.
 */
async function bootCreate(page: Page) {
  await page.addInitScript(tauriMockInit, WINDOWS_OPTS)
  await seedOnboardingDone(page)
  await routeCloud(page, { license: 'active', access: true, mediaLive: true })
  await page.goto('/')
  await expect(appReady(page)).toBeVisible({ timeout: 20_000 })
  // Ab der Create-Ansicht ist dieser Name doppelt (der Generieren-Knopf im
  // Composer heisst auch Create), also aus dem Chat heraus und first().
  await page.getByRole('button', { name: /^Create$/ }).first().click()
}

/**
 * Fall 2, lokal auf Windows.
 *
 * Das ist die Maschine des Melders. Hier ist "nichts da" immer falsch: der
 * Kopf muss stehen, und hinter ihm muss die volle ComfyUI-Leiste liegen. Der
 * Fall trennt dabei die zwei Zustaende, die von aussen gleich aussehen. Der
 * Abschnitt ist defaultOpen={false}, und ein zugeklappter Abschnitt haelt
 * seine Kinder nicht im DOM. Wer nur nach 'Sampler' sucht, findet also auch
 * bei heilem Abschnitt nichts und meldet dasselbe wie bei kaputtem. Deshalb
 * wird hier erst der Pfeil gelesen (ohne rotate-90 = zu), dann geklickt, und
 * erst danach der Inhalt verlangt. Zuletzt oeffnet der Sampler-Select: seine
 * Liste steht selbst ohne ComfyUI auf SAMPLERS_FALLBACK, ein leeres Feld waere
 * also ein Fehler und keine fehlende Verbindung.
 */
test('windows lokal: Expert steht da, ist zu, und traegt nach dem Klick die ComfyUI-Regler', async ({ page }) => {
  await bootCreate(page)
  await expect(page.getByRole('radio', { name: 'Image', exact: true })).toBeChecked({ timeout: 15_000 })

  await openDrawer(page)
  await expect(expertHead(page)).toBeVisible()

  // Zu: der Pfeil steht, die Kinder fehlen. Beides gehoert zusammen.
  await expect(expertChevron(page)).not.toHaveClass(/rotate-90/)
  await expect(row(page, 'Sampler')).toHaveCount(0)

  await expertHead(page).click()
  await expect(expertChevron(page)).toHaveClass(/rotate-90/)
  await expect(row(page, 'Sampler')).toBeVisible()
  await expect(row(page, 'Scheduler')).toBeVisible()
  await expect(row(page, 'VAE')).toBeVisible()
  await expect(row(page, 'Skip CLIP layers')).toBeVisible()

  // Die Vorgabeliste traegt den Standardsampler, auch ohne laufendes ComfyUI.
  await fieldSelect(page, 'Sampler').click()
  await expect(page.getByRole('option', { name: 'dpmpp_2m', exact: true })).toBeVisible()
})

