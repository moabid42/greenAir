import {test, expect} from '@playwright/test';

test('capture EcoMAB screens and exercise key controls', async ({page}, info) => {
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/');await expect(page.getByText('Sport suitability')).toBeVisible();
  await page.screenshot({path:info.outputPath('01-map.png')});
  if(info.project.name==='desktop'){expect(errors).toEqual([]);return;}
  await page.getByRole('button',{name:'Map layers'}).click();
  await page.getByRole('button',{name:/Air quality/}).click();
  await expect(page.getByText('Citywide context displayed uniformly', {exact:false})).toBeVisible();
  await page.screenshot({path:info.outputPath('02-environment.png')});
  await page.getByRole('button',{name:'Back to map'}).click();
  await page.getByRole('button',{name:/Best available time/}).click();
  await page.screenshot({path:info.outputPath('03-best-time.png')});
  await page.getByRole('button',{name:'Devices',exact:true}).click();
  for(const name of ['WHOOP','Apple Watch']) {
    const card=page.locator('.card').filter({has:page.getByRole('heading',{name,exact:true})});
    await card.getByRole('button',{name:'Play sample session'}).click();
    await expect(card).toContainText('simulated playback');
  }
  await page.getByRole('button',{name:'Analytics',exact:true}).click();
  await expect(page.getByLabel('Wearable session')).toBeVisible();
  await page.screenshot({path:info.outputPath('04-analytics.png')});
  await page.getByRole('button',{name:'AI Companion',exact:true}).last().click();
  await expect(page.getByRole('heading',{name:'Model & privacy'})).toBeVisible();
  await page.screenshot({path:info.outputPath('05-ai.png')});
  expect(errors).toEqual([]);
});
