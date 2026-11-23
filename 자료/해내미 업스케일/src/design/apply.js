// 기본 template.html(기능)에 디자인을 입혀 "디자인 사본" HTML을 만듭니다.
// 기능 코드는 그대로 두고, 스타일·창 틀·머리글·뷰어 색만 바꿉니다.
const fs = require('fs'), path = require('path');

const SPARK = (size, fill) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24"><path d="M12 1C12.8 8.2 15.8 11.2 23 12C15.8 12.8 12.8 15.8 12 23C11.2 15.8 8.2 12.8 1 12C8.2 11.2 11.2 8.2 12 1Z" fill="${fill}" stroke="#16141a" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
const SMILEY = (size) => `<svg width="${size}" height="${size}" viewBox="0 0 60 60"><circle cx="33" cy="33" r="25" fill="#16141a"/><circle cx="29" cy="29" r="25" fill="#fcfc6b" stroke="#16141a" stroke-width="2"/><ellipse cx="22" cy="24" rx="2.6" ry="4.4" fill="#16141a"/><ellipse cx="36" cy="24" rx="2.6" ry="4.4" fill="#16141a"/><path d="M15 33c4 9 24 9 28 0" fill="none" stroke="#16141a" stroke-width="2.6" stroke-linecap="round"/></svg>`;
const BURST = (size, fill) => {
  let d = ''; const n = 14;
  for (let i = 0; i < n * 2; i++) { const r = i % 2 ? 9 : 22, a = Math.PI * i / n; d += (i ? 'L' : 'M') + (24 + r * Math.cos(a)).toFixed(1) + ' ' + (24 + r * Math.sin(a)).toFixed(1); }
  return `<svg width="${size}" height="${size}" viewBox="0 0 48 48"><path d="${d}Z" fill="${fill}" stroke="#16141a" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
};
const HEARTS = `<svg width="92" height="40" viewBox="0 0 92 40"><path d="M4 3h84a3 3 0 0 1 3 3v22a3 3 0 0 1-3 3H58l-6 7-3-7H4a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3z" fill="#ffffee" stroke="#16141a" stroke-width="1.8"/>${[0, 1, 2].map(i => `<path transform="translate(${12 + i * 24} 9)" d="M8 15S0 10 0 4.6A4.3 4.3 0 0 1 8 2.4 4.3 4.3 0 0 1 16 4.6C16 10 8 15 8 15z" fill="${i === 2 ? '#16141a' : '#f34e4a'}" stroke="#16141a" stroke-width="1.4"/>`).join('')}</svg>`;
const FOLDER = `<svg width="46" height="38" viewBox="0 0 46 38"><path d="M3 6h14l4 4h20a2 2 0 0 1 2 2v22a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill="#f7ee7f" stroke="#16141a" stroke-width="2" stroke-linejoin="round"/><path d="M3 15h40" stroke="#16141a" stroke-width="2"/><path d="M23 30V19m-5 5 5-5 5 5" fill="none" stroke="#16141a" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const WINBTN = '<span class="b"><i>_</i><i>□</i><i>×</i></span>';

module.exports = function applyDesign(html, assetsDir) {
  const b64 = (f) => fs.readFileSync(path.join(assetsDir, f)).toString('base64');
  const css = fs.readFileSync(path.join(__dirname, 'design.css'), 'utf8');
  const rep = (a, b) => { if (!html.includes(a)) throw new Error('디자인 적용 실패, 찾을 수 없음: ' + a.slice(0, 70)); html = html.replace(a, b); };

  // 1) 스타일 교체
  html = html.replace(/<style>[\s\S]*?<\/style>/, () => '<style>\n' + css + '</style>');
  rep('<title>해내미 업스케일</title>', '<title>해내미 업스케일</title>');

  // 2) 머리글 (해냄에듀 로고 + 타이틀 레터링)
  rep(/<aside>\s*(?:<div class="brand">[\s\S]*?<\/div>\s*)?<h1>해내미 업스케일<\/h1>\s*<p class="sub">[^<]*<\/p>/.exec(html)[0],
    `<header class="hd">
  <span class="logo"><img src="data:image/png;base64,${b64('haenaem-logo.png')}" alt="해냄에듀"></span>
  <img class="title" src="data:image/png;base64,${b64('title.png')}" alt="해내미 업스케일">
  <span class="tags"><span>AI 화질 개선</span><span>화면용 · 인쇄용</span><span>RGB ↔ CMYK</span></span>
  <span class="deco">${SPARK(22, '#ffffff')}${BURST(40, '#f47ab2')}${HEARTS}${SPARK(30, '#fcfc6b')}${SMILEY(46)}</span>
</header>
<aside>`);

  // 3) 단계별 섹션을 레트로 창으로 감싸기
  const colors = ['w-pink', 'w-green', 'w-lav', 'w-yellow'];
  let k = 0;
  html = html.replace(/<section>\s*<h2>(\d+)\.\s*([^<]*)<\/h2>([\s\S]*?)<\/section>/g, (m, n, t, body) =>
    `<section class="win ${colors[k++ % 4]}"><div class="win-t"><span class="n">${n}</span>${t}${WINBTN}</div><div class="win-b">${body}</div></section>`);
  rep('<span>JPG · PNG · TIFF · WEBP · BMP (CMYK JPG/TIFF 포함, 여러 장 가능)</span>', '<span>JPG · PNG · TIFF · WEBP · BMP (CMYK JPG/TIFF 포함, 여러 장 가능)</span>');
  rep('<b>이미지를 끌어다 놓거나 클릭</b>', FOLDER + '<b>이미지를 끌어다 놓거나 클릭</b>');

  // 4) 엔진 상태 → Information 창
  rep('<div class="engine" id="engine">', `<section class="win w-mint"><div class="win-t">Information${WINBTN}</div><div class="win-b"><div class="engine" id="engine">`);
  rep(/(이미지는 외부로 전송되지 않습니다\.<\/div>\s*<\/div>)/.exec(html)[1], '이미지는 외부로 전송되지 않습니다.</div>\n  </div></div></section>');

  // 5) 미리보기 → Artboard 창
  rep('<main>\n  <div class="toolbar">', `<main>
 <section class="win w-art"><div class="win-t">미리보기 · Artboard${WINBTN}</div><div class="win-body">
  <div class="toolbar">`);
  rep('<div class="empty" id="empty"><b>이미지를 넣어 주세요</b><span>왼쪽에 끌어다 놓거나, 이 화면에 바로 놓아도 됩니다.</span></div>',
    `<div class="empty" id="empty">${SMILEY(84)}<div class="card" id="emptyMsg"><b>이미지를 넣어 주세요</b><span>왼쪽에 끌어다 놓거나, 이 화면에 바로 놓아도 됩니다.</span></div></div>`);
  rep(`      <div class="ovbox">
        <b id="ovTitle">처리 중</b>
        <div class="step" id="ovStep"></div>
        <div class="bar"><i id="ovBar"></i></div>
        <button class="btn wide" id="cancelBtn">취소</button>
      </div>`, `      <div class="ovbox">
        <div class="win-t">Loading…${WINBTN}</div>
        <div class="in">
        <b id="ovTitle">처리 중</b>
        <div class="step" id="ovStep"></div>
        <div class="bar"><i id="ovBar"></i></div>
        <button class="btn wide" id="cancelBtn">취소</button>
        </div>
      </div>`);
  rep('  </div>\n</main>', '  </div>\n </div></section>\n</main>');

  // 6) 스크립트: 빈 화면 문구 위치, 뷰어 색
  html = html.split("emp.innerHTML = ").join("$('#emptyMsg').innerHTML = ");
  rep("ctx.fillStyle = '#fff'; ctx.fillRect(V.x, V.y, dw, dh); ctx.fillStyle = '#e4e4e4';", "ctx.fillStyle = '#fff3fc'; ctx.fillRect(V.x, V.y, dw, dh); ctx.fillStyle = '#ffe6f0';");
  rep("ctx.restore();\n  const splitX", "ctx.restore();\n  ctx.save(); ctx.strokeStyle = '#16141a'; ctx.lineWidth = 2 * d; ctx.strokeRect(V.x - d, V.y - d, dw + 2 * d, dh + 2 * d); ctx.restore();\n  const splitX");
  rep("ctx.fillStyle = '#fff'; ctx.fillRect(splitX - 1 * d, 0, 2 * d, H);", "ctx.fillStyle = '#16141a'; ctx.fillRect(splitX - 1.5 * d, 0, 3 * d, H);");
  rep("ctx.beginPath(); ctx.arc(splitX, H / 2, 14 * d, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();", "ctx.beginPath(); ctx.arc(splitX + 2 * d, H / 2 + 2 * d, 16 * d, 0, Math.PI * 2); ctx.fillStyle = '#16141a'; ctx.fill(); ctx.beginPath(); ctx.arc(splitX, H / 2, 16 * d, 0, Math.PI * 2); ctx.fillStyle = '#fcfc6b'; ctx.fill();");
  rep("ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = d; ctx.stroke();", "ctx.strokeStyle = '#16141a'; ctx.lineWidth = 2 * d; ctx.stroke();");
  rep("ctx.fillStyle = '#333'; ctx.font = `${11 * d}px sans-serif`;", "ctx.fillStyle = '#16141a'; ctx.font = `700 ${11 * d}px sans-serif`;");
  rep("ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(bx, 10 * d, tw, 22 * d); ctx.fillStyle = '#fff';",
    "ctx.fillStyle = '#16141a'; ctx.fillRect(bx + 3 * d, 13 * d, tw, 24 * d); ctx.fillStyle = al === 'r' ? '#d3c6f4' : '#fcb9ef'; ctx.fillRect(bx, 10 * d, tw, 24 * d); ctx.strokeStyle = '#16141a'; ctx.lineWidth = 2 * d; ctx.strokeRect(bx, 10 * d, tw, 24 * d); ctx.fillStyle = '#16141a';");
  rep("ctx.fillText(txt, bx + 7 * d, 21 * d); };", "ctx.fillText(txt, bx + 7 * d, 22.5 * d); };");
  return html;
};
