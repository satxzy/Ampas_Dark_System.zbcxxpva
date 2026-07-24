// upload_github.js
// Upload semua file dalam folder ke GitHub repo baru.
// Bisa bikin banyak repo sekaligus (--count)

const https = require('https');
const fs = require('fs');
const path = require('path');

// --- Baca argumen ---
const args = process.argv.slice(2);
let token = '';
let baseName = 'repo';
let folder = '.';
let isPrivate = false;
let count = 1; // default 1 repo

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--token' && args[i + 1]) token = args[++i];
  else if (args[i] === '--name' && args[i + 1]) baseName = args[++i];
  else if (args[i] === '--folder' && args[i + 1]) folder = args[++i];
  else if (args[i] === '--private') isPrivate = true;
  else if (args[i] === '--count' && args[i + 1]) {
    count = parseInt(args[++i], 10);
    if (isNaN(count) || count < 1) count = 1;
  }
}

if (!token) {
  console.log('Gunakan: node upload_github.js --token <ghp_xxx> [--name reponame] [--folder ./dir] [--private] [--count jumlah]');
  process.exit(1);
}

// Warna sederhana
const c = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

function github(method, apiPath, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.github.com',
      path: apiPath,
      method,
      headers: {
        Authorization: `token ${token}`,
        'User-Agent': 'nodejs-uploader',
        'Content-Type': 'application/json',
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(data)); } catch { resolve(data); }
        } else {
          reject(new Error(`Gagal: ${res.statusCode} - ${data}`));
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function getAllFiles(dir, ignoreBase = []) {
  const ignore = new Set(ignoreBase);
  const results = [];
  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of items) {
    const full = path.join(dir, item.name);
    if (ignore.has(full)) continue;
    if (item.isDirectory()) {
      if (item.name === '.git' || item.name === 'node_modules') continue;
      results.push(...getAllFiles(full, ignoreBase));
    } else {
      results.push(full);
    }
  }
  return results;
}

function randomSuffix() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789.-~';
  let s = '';
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return '.' + s;
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
  return (bytes / 1073741824).toFixed(2) + ' GB';
}

async function createAndUpload(repoIndex) {
  // Dapatkan username (cukup sekali, tapi kita panggil di awal main, simpan)
  // Karena fungsi ini dipanggil loop, kita perlu owner dari luar
  // Kita akan passing owner dari luar
  return async function(owner) {
    const repoName = baseName + randomSuffix();
    console.log(`\n[Repo ${repoIndex}/${count}] Buat: ${c.cyan}${repoName}${c.reset}`);

    let repo;
    try {
      repo = await github('POST', '/user/repos', {
        name: repoName,
        private: isPrivate,
        auto_init: true,
      });
    } catch (e) {
      if (e.message.includes('422')) {
        const newName = baseName + randomSuffix();
        console.log(`${c.yellow}  Nama sudah ada, coba ${newName}${c.reset}`);
        repo = await github('POST', '/user/repos', {
          name: newName,
          private: isPrivate,
          auto_init: true,
        });
      } else {
        throw e;
      }
    }

    const branch = repo.default_branch;
    const repoUrl = repo.html_url;

    // Baca file (sama untuk semua repo, bisa dibaca sekali di main untuk efisiensi)
    const scriptPath = __filename;
    const files = getAllFiles(folder, [scriptPath]);
    if (files.length === 0) {
      console.log(`  ${c.yellow}Gak ada file.${c.reset}`);
      return { url: repoUrl, files: 0, size: 0 };
    }

    const fileInfos = files.map(f => {
      const stat = fs.statSync(f);
      return { abs: f, size: stat.size };
    });

    let uploadedFiles = 0;
    let uploadedBytes = 0;

    for (const f of fileInfos) {
      const rel = path.relative(folder, f.abs).replace(/\\/g, '/');
      const content = fs.readFileSync(f.abs);
      const b64 = content.toString('base64');

      await github('PUT', `/repos/${owner}/${repo.name}/contents/${rel}`, {
        message: `Add ${rel}`,
        content: b64,
        branch: branch,
      });

      uploadedFiles++;
      uploadedBytes += f.size;
      const pct = ((uploadedFiles / files.length) * 100).toFixed(0);
      process.stdout.write(`\r  Upload: ${pct}% (${uploadedFiles}/${files.length})`);
    }
    process.stdout.write('\r' + ' '.repeat(50) + '\r');
    console.log(`  ${c.green}Selesai${c.reset} -> ${repoUrl}`);
    return { url: repoUrl, files: uploadedFiles, size: uploadedBytes };
  };
}

(async () => {
  try {
    console.log('Cek token...');
    const user = await github('GET', '/user');
    const owner = user.login;
    console.log(`${c.green}Login sebagai ${owner}${c.reset}`);

    const scriptPath = __filename;
    const files = getAllFiles(folder, [scriptPath]);
    if (files.length === 0 && count > 0) {
      console.log(`${c.yellow}Folder kosong, tetap akan buat repo kosong.${c.reset}`);
    } else {
      console.log(`Ditemukan ${files.length} file (total ${formatSize(files.reduce((s,f) => s + fs.statSync(f).size, 0))})`);
    }

    console.log(`Membuat ${count} repo...`);

    const startTotal = Date.now();
    const results = [];

    for (let i = 1; i <= count; i++) {
      const uploadFn = await createAndUpload(i);
      const res = await uploadFn(owner);
      results.push(res);
      // Jeda kecil antar repo untuk aman dari rate limit
      if (i < count) await new Promise(r => setTimeout(r, 2000));
    }

    const waktuTotal = ((Date.now() - startTotal) / 1000).toFixed(1);
    console.log(`\n${c.green}Semua selesai!${c.reset}`);
    console.log(`Total repo : ${results.length}`);
    console.log(`Total waktu: ${waktuTotal} detik`);
    console.log('List repo:');
    results.forEach((r, i) => {
      console.log(`  ${i+1}. ${r.url} (${r.files} file, ${formatSize(r.size)})`);
    });
  } catch (e) {
    console.log(`${c.red}Error: ${e.message}${c.reset}`);
    process.exit(1);
  }
})();