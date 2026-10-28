import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  use: {baseURL: 'http://127.0.0.1:4173', screenshot:'only-on-failure'},
  projects: [
    {name:'mobile', use:{...devices['Desktop Chrome'], viewport:{width:390,height:844}}},
    {name:'desktop', use:{...devices['Desktop Chrome'], viewport:{width:1440,height:900}}}
  ],
  webServer:{command:'npm run dev -- --host 127.0.0.1 --port 4173 --strictPort',url:'http://127.0.0.1:4173',reuseExistingServer:true,timeout:30000}
});
