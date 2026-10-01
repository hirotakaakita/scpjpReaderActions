const { spawn } = require('child_process');
const { LANGUAGES } = require('./languages');

function runPage(lang, page) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['partial-crawler.js', lang, page], {
      stdio: 'inherit',
      env: process.env,
    });
    child.once('error', reject);
    child.once('exit', code => {
      if (code === 0) resolve();
      else reject(new Error(`ページ処理に失敗しました: ${lang}/${page} (exit ${code})`));
    });
  });
}

async function main() {
  const lang = process.argv[2];
  const config = LANGUAGES[lang];
  if (!config) {
    console.error(`不正な言語コード: ${lang || '(未指定)'}`);
    process.exitCode = 1;
    return;
  }

  console.log(`=== 言語サイト単位のクロール開始: ${lang} (${config.pages.length}ページ) ===`);
  for (const page of config.pages) {
    await runPage(lang, page.path);
  }
  console.log(`=== 言語サイト単位のクロール完了: ${lang} ===`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
