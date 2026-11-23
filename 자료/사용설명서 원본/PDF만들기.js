const puppeteer = require('puppeteer-core');
const OUT = 'C:/Users/User/work/이미지자동화/결과물/해냄에듀 책 미리보기_사용설명서.pdf';
(async () => {
  const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--allow-file-access-from-files'] });
  const p = await b.newPage();
  await p.goto('file:///' + __dirname.replace(/\\/g, '/') + '/manual.html', { waitUntil: 'networkidle0' });
  await p.evaluate(() => document.fonts.ready);
  await p.pdf({
    path: OUT, format: 'A4', printBackground: true, preferCSSPageSize: true,
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate: '<div style="width:100%;font-size:8px;color:#8a8d94;padding:0 17mm;display:flex;justify-content:space-between;font-family:\'Malgun Gothic\',sans-serif"><span>해냄에듀 책 미리보기 사용설명서</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
  });
  // 미리보기용 페이지 이미지
  await p.goto('about:blank');
  await b.close();
  console.log('saved', OUT);
})();
