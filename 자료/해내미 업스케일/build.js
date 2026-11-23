// 해내미 업스케일 빌드: src/template.html + 모델·프로파일 → 결과물/해내미 업스케일.html
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const A = (f) => path.join(__dirname, 'assets', f);
const gz = (f) => zlib.gzipSync(fs.readFileSync(A(f)), { level: 9 }).toString('base64');
const payload = {
  models: {
    photo: { param: fs.readFileSync(A('upscayl-lite-4x.param'), 'utf8'), bin: gz('upscayl-lite-4x.bin') },
    illust: { param: fs.readFileSync(A('realesr-animevideov3-x4.param'), 'utf8'), bin: gz('realesr-animevideov3-x4.bin') },
  },
  icc: { jc2001c: gz('JapanColor2001Coated.icc'), jc2001u: gz('JapanColor2001Uncoated.icc'), fogra39: gz('CoatedFOGRA39.icc') },
  srgb: fs.readFileSync(A('sRGB.icc')).toString('base64'),
};
let html = fs.readFileSync(path.join(__dirname, 'src', 'template.html'), 'utf8');
const rep = (k, v) => { if (!html.includes(k)) throw new Error('missing ' + k); html = html.split(k).join(v); };
rep('/*__WORKER__*/', fs.readFileSync(path.join(__dirname, 'src', 'worker.js'), 'utf8'));
rep('/*__JPEGJS__*/', fs.readFileSync(A('jpeg-js-decoder.js'), 'utf8'));
rep('/*__PAYLOAD__*/null', JSON.stringify(payload));
// 외부 라이브러리를 파일 안에 넣음 (인터넷 없이 작동). 출처: jsDelivr/cdnjs에서 받은 assets/vendor/
const V = (f) => fs.readFileSync(A('vendor/' + f), 'utf8').replace(/\/\/# sourceMappingURL=.*$/m, '').replace(/<\/script/gi, '<\\/script');
rep('/*__TFJS__*/', V('tf.min.js'));
rep('/*__PAKO__*/', V('pako.min.js'));
rep('/*__UTIF__*/', V('UTIF.js'));
rep('/*__JSZIP__*/', V('jszip.min.js'));
rep('/*__LCMS__*/null', JSON.stringify({ js: V('lcms.js').split('new URL("lcms.wasm",import.meta.url).href').join('"lcms.wasm"') /* blob:에선 URL 계산 불가, wasm은 wasmBinary로 직접 넘김 */, wasm: fs.readFileSync(A('vendor/lcms.wasm')).toString('base64') }));
rep('/*__LOGO__*/', fs.readFileSync(A('haenaem-logo.png')).toString('base64'));
const out = path.join(__dirname, '..', '..', '결과물', '해내미 업스케일.html');
fs.writeFileSync(out, html);
console.log('built', out, (html.length / 1e6).toFixed(2) + 'MB');
// 디자인 사본 (같은 기능 + 디자인 시안 + 해냄에듀 로고)
const design = require('./src/design/apply.js')(html, path.join(__dirname, 'assets'));
const out2 = path.join(__dirname, '..', '..', '결과물', '해내미 업스케일_디자인.html');
fs.writeFileSync(out2, design);
console.log('built', out2, (design.length / 1e6).toFixed(2) + 'MB');
