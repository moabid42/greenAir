import { test, expect } from '@playwright/test';

test('map shell, scenario controls and demo device lifecycle', async ({page}, testInfo) => {
  const errors=[]; page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/');
  await expect(page.getByText('Sport suitability')).toBeVisible();
  await expect(page.locator('#status')).toHaveText('Example conditions');
  const map=page.locator('#map'); await expect(map).toHaveCount(1);
  await page.locator('.slider').fill('1');
  await expect(page.locator('#map')).toHaveCount(1);
  await page.getByRole('button',{name:'Devices',exact:true}).click();
  const whoop=page.locator('.card').filter({has:page.getByRole('heading',{name:'WHOOP'})});
  await whoop.getByRole('button',{name:'Play sample session'}).click();
  await expect(whoop).toContainText('simulated playback');
  await whoop.getByRole('button',{name:'Disconnect'}).click();
  await expect(whoop).toContainText('history retained');
  page.once('dialog',dialog=>dialog.accept());
  await whoop.getByRole('button',{name:'Forget & erase history'}).click();
  await expect(whoop).toContainText('Not connected');
  await page.screenshot({path:testInfo.outputPath('screen.png')});
  expect(errors).toEqual([]);
});
