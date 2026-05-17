'use strict';
// Find the EW chart bounding box in the source screenshot by scanning
// pixels for the EW cream backdrop color (#f3edd9 ish: R~243 G~237 B~217).
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const imgPath = path.resolve(process.argv[2]);
  const dataUrl = `data:image/png;base64,${fs.readFileSync(imgPath).toString('base64')}`;
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 2000, height: 867 } });
  const page = await ctx.newPage();
  await page.setContent(`<html><body style="margin:0;padding:0"><img id="src" src="${dataUrl}" /></body></html>`);
  await page.waitForFunction(() => {
    const i = document.getElementById('src');
    return i && i.complete && i.naturalWidth > 0;
  });
  const box = await page.evaluate(() => {
    const img = document.getElementById('src');
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const cx = c.getContext('2d');
    cx.drawImage(img, 0, 0);
    const data = cx.getImageData(0, 0, c.width, c.height).data;
    let minX = c.width, minY = c.height, maxX = 0, maxY = 0, hit = 0;
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        const i = (y * c.width + x) * 4;
        const r = data[i], g = data[i+1], b = data[i+2];
        // EW cream: R 235-250, G 225-245, B 200-225
        if (r >= 230 && r <= 252 && g >= 220 && g <= 245 && b >= 195 && b <= 230 && r > b + 10) {
          hit++;
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
    return { minX, minY, maxX, maxY, hit, w: c.width, h: c.height };
  });
  console.log(JSON.stringify(box, null, 2));
  console.log(`crop px : left=${box.minX} top=${box.minY} width=${box.maxX-box.minX} height=${box.maxY-box.minY}`);
  console.log(`crop pct: left=${(100*box.minX/box.w).toFixed(2)} top=${(100*box.minY/box.h).toFixed(2)} width=${(100*(box.maxX-box.minX)/box.w).toFixed(2)} height=${(100*(box.maxY-box.minY)/box.h).toFixed(2)}`);
  await browser.close();
})();
