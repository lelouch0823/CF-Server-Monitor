import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildGithubPageCsp, transformGithubPageHtml } from '../scripts/build-github-page.js';
import { buildBackgroundStyle } from '../src/utils/csp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const INSTALL_SCRIPTS = [
  { file: 'public/install.sh', outerShell: 'bash', innerShell: 'bash' },
  { file: 'public/install-alpine.sh', outerShell: 'sh', innerShell: 'bash' },
  { file: 'public/install-mac.sh', outerShell: 'bash', innerShell: 'bash' },
  { file: 'public/install-openwrt.sh', outerShell: 'sh', innerShell: 'sh' },
  { file: 'public/install-synology.sh', outerShell: 'bash', innerShell: 'bash' }
];

function readProjectFile(relPath) {
  return fs.readFileSync(path.join(rootDir, relPath), 'utf8');
}

function extractInnerProbeScript(relPath) {
  const content = readProjectFile(relPath);
  const matched = content.match(/<<\s*'PROBE_EOF'[^\n]*\n([\s\S]*?)\nPROBE_EOF/);
  assert.ok(matched, `Failed to extract PROBE_EOF from ${relPath}`);
  return matched[1];
}

function extractShellFunction(scriptContent, funcName) {
  const re = new RegExp(`(^|\\n)(${funcName}\\s*\\(\\s*\\)\\s*[\\({][\\s\\S]*?\\n[\\)}])(?=\\n|$)`);
  const matched = scriptContent.match(re);
  assert.ok(matched, `Failed to extract function ${funcName}`);
  return matched[2];
}

test('all 6 Unix/Linux shell scripts and 5 inner probe scripts pass syntax checks', () => {
  const hasDash = fs.existsSync('/bin/dash');
  for (const item of INSTALL_SCRIPTS) {
    const fullPath = path.join(rootDir, item.file);
    execFileSync(item.outerShell, ['-n', fullPath]);
    if (hasDash && item.outerShell === 'sh') {
      execFileSync('/bin/dash', ['-n', fullPath]);
    }
    const inner = extractInnerProbeScript(item.file);
    execFileSync(item.innerShell, ['-n'], { input: inner });
    if (hasDash && item.innerShell === 'sh') {
      execFileSync('/bin/dash', ['-n'], { input: inner });
    }
  }
  execFileSync('sh', ['-n', path.join(rootDir, 'public/uninstall.sh')]);
  if (hasDash) {
    execFileSync('/bin/dash', ['-n', path.join(rootDir, 'public/uninstall.sh')]);
  }
});

test('Unix/Linux probe scripts eliminate curl -d secret exposure and enforce LC_ALL=C, AUTO_UPDATE_DELAY_SECONDS, and safe curl flags', () => {
  for (const { file } of INSTALL_SCRIPTS) {
    const outer = readProjectFile(file);
    const inner = extractInnerProbeScript(file);

    // Locale isolation in both outer installer and inner probe
    assert.match(outer, /export LC_ALL=C LANG=C/);
    assert.match(inner, /export LC_ALL=C LANG=C/);

    // Explicit AUTO_UPDATE_DELAY_SECONDS=60 in inner script (prevents set -u crash on macOS)
    assert.match(inner, /^AUTO_UPDATE_DELAY_SECONDS=60$/m, `${file} inner script must define AUTO_UPDATE_DELAY_SECONDS=60`);

    // Support CF_PROBE_SECRET env var in installer
    assert.match(outer, /CF_PROBE_SECRET/);

    // Zero curl -d / --data usage anywhere; must use --data-binary @- via stdin and -- before URL
    const curlDashDRe = /\bcurl\b(?:[^\n;|`]|\\\n)*?\s(?:-d|--data|--data-raw|--data-ascii)(?:=|\s)/;
    assert.doesNotMatch(outer, curlDashDRe);
    assert.doesNotMatch(inner, curlDashDRe);

    const dataBinaryMatches = inner.match(/--data-binary @-/g) || [];
    assert.equal(dataBinaryMatches.length, 2, `${file} must pass payload via --data-binary @- in both report loop and send_correction_confirm`);

    // Every curl invocation in inner script puts target URL after --
    const curlCalls = inner.match(/curl\s+[^\n]+(?:\n\s+[^\n]+)*/g) || [];
    assert.ok(curlCalls.length >= 4, `${file} should contain curl calls`);
    for (const call of curlCalls) {
      assert.match(call, /\s--\s+"[^"]+"/, `curl call in ${file} must place URL after --: ${call}`);
    }

    // No predictable world-writable auto-update or IPC temp paths
    assert.doesNotMatch(inner, /cf-probe-auto-update\.\$\$/);
    assert.doesNotMatch(inner, /auto_update_install\.\$\$/);
    assert.doesNotMatch(inner, /\/dev\/shm\/\.cf_/);
    assert.doesNotMatch(inner, /\/tmp\/\.cf_/);
    assert.doesNotMatch(inner, /\/tmp\/cf-probe/);
    assert.match(inner, /\.auto_update\.XXXXXX/);
    assert.match(inner, /--proto "=https" --tlsv1\.2/);

    // CPU_INFO no longer pipes through xargs (unmatched quote hazard)
    assert.doesNotMatch(inner, /\|\s*xargs\b/);

    // df and GPU tools wrapped with timeout / df -lkP fallback
    assert.match(inner, /df -lkP/);
    assert.match(inner, /timeout "\$/);

    // JSON escaping covers SERVER_ID, SECRET, LOAD_AVG, IPV4, IPV6
    assert.match(inner, /ESERVER_ID=\$\(escape_json/);
    assert.match(inner, /ESECRET=\$\(escape_json/);
    assert.match(inner, /ELOAD=\$\(escape_json/);
    assert.match(inner, /EIPV4=\$\(escape_json/);
    assert.match(inner, /EIPV6=\$\(escape_json/);
  }
});

test('RFC 8259 escape_json across all 5 probe scripts escapes quotes, backslashes, tabs, newlines, and strips control chars', () => {
  for (const { file, innerShell } of INSTALL_SCRIPTS) {
    const inner = extractInnerProbeScript(file);
    const escapeFn = extractShellFunction(inner, 'escape_json');

    const runner = `
      export LC_ALL=C LANG=C
      ${escapeFn}
      raw=$(printf 'id"with\\\\slash\\ttab\\nline2\\rcr\\bback\\fform\\001\\007\\013\\037\\177末尾\\nX')
      raw="\${raw%X}"
      escaped=$(escape_json "$raw")
      printf '{"v":"%s"}' "$escaped"
    `;
    const jsonOut = execFileSync(innerShell, ['-c', runner], { encoding: 'utf8' });
    const parsed = JSON.parse(jsonOut);
    assert.equal(
      parsed.v,
      'id"with\\slash\ttab\nline2\rcr\bback\fform末尾\n',
      `RFC 8259 escape_json mismatch in ${file}`
    );
  }
});

test('verify_secure_dir rejects symlinked runtime directories and enforces 0700 ownership', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-track-e-dir-'));
  try {
    const realTarget = path.join(tmpRoot, 'real');
    const symlinkDir = path.join(tmpRoot, 'symlink-run');
    const validDir = path.join(tmpRoot, 'valid-run');
    fs.mkdirSync(realTarget, { mode: 0o777 });
    fs.symlinkSync(realTarget, symlinkDir);

    const inner = extractInnerProbeScript('public/install-mac.sh');
    const verifyFn = extractShellFunction(inner, 'verify_secure_dir');

    const statusSymlink = execFileSync('bash', ['-c', `
      set -u
      export LC_ALL=C LANG=C
      ${verifyFn}
      if verify_secure_dir "$1"; then echo "ALLOWED"; else echo "REJECTED"; fi
    `, '_', symlinkDir], { encoding: 'utf8' }).trim();
    assert.equal(statusSymlink, 'REJECTED');

    const statusValid = execFileSync('bash', ['-c', `
      set -u
      export LC_ALL=C LANG=C
      ${verifyFn}
      if verify_secure_dir "$1"; then echo "ALLOWED"; else echo "REJECTED"; fi
    `, '_', validDir], { encoding: 'utf8' }).trim();
    assert.equal(statusValid, 'ALLOWED');
    assert.equal(fs.statSync(validDir).mode & 0o777, 0o700);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('get_install_url enforces https:// by default and split_probe_target blocks loopback/link-local SSRF targets', () => {
  for (const { file, innerShell } of INSTALL_SCRIPTS) {
    const inner = extractInnerProbeScript(file);
    const validateUrlFn = extractShellFunction(inner, 'validate_worker_url');
    const getInstallUrlFn = extractShellFunction(inner, 'get_install_url');
    const forbiddenFn = inner.includes('is_forbidden_probe_host()')
      ? extractShellFunction(inner, 'is_forbidden_probe_host')
      : '';
    const splitTargetFn = extractShellFunction(inner, 'split_probe_target');

    const script = `
      set -u
      export LC_ALL=C LANG=C
      ${validateUrlFn}
      ${getInstallUrlFn}
      ${forbiddenFn}
      ${splitTargetFn}

      ALLOW_INSECURE_HTTP_UPDATE=0
      WORKER_URL="http://worker.example.com/update"
      if get_install_url >/dev/null 2>&1; then echo "HTTP_ALLOWED_BY_DEFAULT"; exit 1; fi

      WORKER_URL="https://worker.example.com/update?foo=1"
      u=$(get_install_url)
      case "$u" in https://worker.example.com/install*) ;; *) echo "BAD_HTTPS_URL:$u"; exit 1 ;; esac

      WORKER_URL="https://worker.example.com/bad url"
      if get_install_url >/dev/null 2>&1; then echo "SPACE_URL_ALLOWED"; exit 1; fi

      ALLOW_INSECURE_HTTP_UPDATE=1
      WORKER_URL="http://worker.example.com/update"
      u_http=$(get_install_url)
      case "$u_http" in http://worker.example.com/install*) ;; *) echo "HTTP_OPTIN_FAILED:$u_http"; exit 1 ;; esac

      ALLOW_PRIVATE_PROBE=0
      for bad in "127.0.0.1" "127.0.0.1:8080" "localhost" "localhost:443" "sub.localhost" "169.254.169.254" "169.254.169.254:80" "::1" "0.0.0.0"; do
        if split_probe_target "$bad" 443 >/dev/null 2>&1; then
          echo "PRIVATE_ALLOWED:$bad"
          exit 1
        fi
      done

      ok_target=$(split_probe_target "ct.example.com:8443" 443)
      [ "$ok_target" = "ct.example.com 8443" ] || { echo "PUBLIC_FAILED:$ok_target"; exit 1; }

      ALLOW_PRIVATE_PROBE=1
      priv_ok=$(split_probe_target "127.0.0.1:8080" 443)
      [ "$priv_ok" = "127.0.0.1 8080" ] || { echo "OPTIN_PRIVATE_FAILED:$priv_ok"; exit 1; }
      echo "OK"
    `;
    const out = execFileSync(innerShell, ['-c', script], { encoding: 'utf8' }).trim();
    assert.equal(out, 'OK', `URL / probe target check failed for ${file}`);
  }
});

test('cross-platform ping parser handles GNU iputils rtt, macOS BSD round-trip, and BusyBox round-trip formats', () => {
  for (const { file, innerShell } of INSTALL_SCRIPTS) {
    const inner = extractInnerProbeScript(file);
    const parsePingFn = extractShellFunction(inner, 'parse_ping_avg');
    const out = execFileSync(innerShell, ['-c', `
      export LC_ALL=C LANG=C
      ${parsePingFn}
      g=$(printf '4 packets transmitted, 4 received, 0%% packet loss\\nrtt min/avg/max/mdev = 11.201/23.890/35.100/4.120 ms\\n' | parse_ping_avg)
      m=$(printf '4 packets transmitted, 4 packets received, 0.0%% packet loss\\nround-trip min/avg/max/stddev = 9.100/18.650/29.300/3.210 ms\\n' | parse_ping_avg)
      b=$(printf '4 packets transmitted, 4 packets received, 0%% packet loss\\nround-trip min/avg/max = 5.012/14.999/20.001 ms\\n' | parse_ping_avg)
      z=$(printf '4 packets transmitted, 0 packets received, 100.0%% packet loss\\n' | parse_ping_avg)
      printf '%s|%s|%s|%s' "$g" "$m" "$b" "$z"
    `], { encoding: 'utf8' });
    assert.equal(out, '23|18|14|', `Cross-platform ping parse failed in ${file}`);
  }
});

test('macOS sysctl -n loadavg, netstat -ibn physical interface deduplication, and single-pass powermetrics parsing', () => {
  const macInner = extractInnerProbeScript('public/install-mac.sh');
  assert.match(macInner, /sysctl -n vm\.loadavg/);
  assert.doesNotMatch(macInner, /grep -oE '\[0-9\]\+' \| head -1/);

  const getNetFn = extractShellFunction(macInner, 'get_net_bytes');
  const mockNetstat = [
    'Name       Mtu   Network       Address            Ipkts Ierrs     Ibytes    Opkts Oerrs     Obytes  Coll',
    'lo0        16384 <Link#1>                          1000     0      50000     1000     0      50000     0',
    'lo0        16384 127           127.0.0.1           1000     -      50000     1000     -      50000     -',
    'anpi0      1500  <Link#4>    1e:51:a3:ff:7d:ca      200     0      99999      200     0      88888     0',
    'en0        1500  <Link#7>    c8:80:6d:4d:10:53     5000     0    1000000     4000     0    2000000     0',
    'en0        1500  192.168.1     192.168.1.10        5000     -    1000000     4000     -    2000000     -',
    'en0        1500  fe80::c880    fe80::1             5000     -    1000000     4000     -    2000000     -',
    'en1        1500  <Link#8>                          3000     0     500000     2000     0     700000     0',
    'utun0      1380  <Link#15>                          900     0    9000000      900     0    9000000     0'
  ].join('\n');

  const result = execFileSync('bash', ['-c', `
    set -u
    export LC_ALL=C LANG=C
    netstat() { printf '%s\\n' "$MOCK_NETSTAT"; }
    ${getNetFn}
    default_bytes=$(INTERFACE="" get_net_bytes)
    utun_bytes=$(INTERFACE="utun0" get_net_bytes)
    load_parsed=$(printf '{ 4.10 4.12 3.34 }\\n' | tr -d '{}' | awk 'NF >= 3 {print $1, $2, $3; exit}')
    printf '%s|%s|%s' "$default_bytes" "$utun_bytes" "$load_parsed"
  `], {
    encoding: 'utf8',
    env: { ...process.env, MOCK_NETSTAT: mockNetstat }
  });

  // Default sums en0 (with MAC, NF=11) + en1 (without MAC, NF=10) <Link#> rows once each:
  // RX = 1000000 + 500000 = 1500000, TX = 2000000 + 700000 = 2700000
  assert.equal(result, '1500000 2700000|9000000 9000000|4.10 4.12 3.34');
});

test('Synology netstat/proc/net/dev filter excludes docker/veth and avoids ovs/bond double-counting', () => {
  const synoOuter = readProjectFile('public/install-synology.sh');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-syno-net-'));
  try {
    const procDevWithPhys = path.join(tmpDir, 'dev_phys');
    fs.writeFileSync(procDevWithPhys, [
      'Inter-|   Receive                                                |  Transmit',
      ' face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed',
      '    lo:   99999     100    0    0    0     0          0         0    99999     100    0    0    0     0       0          0',
      '  eth0: 1000000    1000    0    0    0     0          0         0  2000000    2000    0    0    0     0       0          0',
      ' bond0: 1000000    1000    0    0    0     0          0         0  2000000    2000    0    0    0     0       0          0',
      'ovs_eth0: 1000000  1000    0    0    0     0          0         0  2000000    2000    0    0    0     0       0          0',
      'docker0: 500000     500    0    0    0     0          0         0   500000     500    0    0    0     0       0          0',
      'vethabc: 500000     500    0    0    0     0          0         0   500000     500    0    0    0     0       0          0'
    ].join('\n'));

    const normalizeFn = extractShellFunction(synoOuter, 'normalize_interface_list');
    const getConfiguredNetFn = extractShellFunction(synoOuter, 'get_configured_net_bytes')
      .replace('/proc/net/dev', '"$PROC_NET_DEV"');

    const outPhys = execFileSync('bash', ['-c', `
      export LC_ALL=C LANG=C
      ${normalizeFn}
      ${getConfiguredNetFn}
      get_configured_net_bytes ""
    `], { encoding: 'utf8', env: { ...process.env, PROC_NET_DEV: procDevWithPhys } }).trim();

    assert.equal(outPhys, '1000000 2000000');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('OpenWrt probe uses 64-bit awk math without 32-bit signed integer overflow past 2.14GB or millisecond timestamps', () => {
  const openwrtInner = extractInnerProbeScript('public/install-openwrt.sh');
  const normResetFn = extractShellFunction(openwrtInner, 'normalize_reset_day');
  const isLeapFn = extractShellFunction(openwrtInner, 'is_leap_year');
  const toDecFn = extractShellFunction(openwrtInner, 'to_decimal');
  const periodStartFn = extractShellFunction(openwrtInner, 'get_period_start_ts');
  const calcMonthlyFn = extractShellFunction(openwrtInner, 'calc_monthly_traffic');
  const safeDivFn = extractShellFunction(openwrtInner, 'safe_div');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-openwrt-math-'));
  try {
    const trafficFile = path.join(tmpDir, 'traffic.dat');
    // Seed previous traffic > 2.14GB (e.g. 50 GB prev, 100 GB accumulated period)
    const out = execFileSync('sh', ['-c', `
      set -eu
      export LC_ALL=C LANG=C
      CONFIG_DIR="$1"
      TRAFFIC_DATA_FILE="$2"
      RESET_DAY=1
      INTERFACE=""
      ${normResetFn}
      ${isLeapFn}
      ${toDecFn}
      ${periodStartFn}
      ${calcMonthlyFn}
      ${safeDivFn}

      now_ts=$(date +%s)
      pstart=$(get_period_start_ts 1 "$now_ts")
      cat > "$TRAFFIC_DATA_FILE" <<EOF
RX_PREV=50000000000
TX_PREV=30000000000
RX_PERIOD=100000000000
TX_PERIOD=80000000000
LAST_CHECK=$now_ts
PERIOD_START=$pstart
INTERFACE=
EOF
      monthly=$(calc_monthly_traffic "55000000000" "36000000000")
      speed=$(safe_div "5000000000" "10" "0")
      sample_ts=$(awk -v t="1763400000" 'BEGIN { printf "%.0f", (t + 0) * 1000 }')
      printf '%s|%s|%s' "$monthly" "$speed" "$sample_ts"
    `, '_', tmpDir, trafficFile], { encoding: 'utf8' });

    assert.equal(out, '105000000000 86000000000|500000000|1763400000000');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Windows PowerShell probe and uninstaller enforce ProgramData ACLs, preserve reset_day on auto-update, mask secrets, and dispose sockets', () => {
  const psProbe = readProjectFile('public/cf-server-monitor.ps1');
  const psUninstall = readProjectFile('public/uninstall.ps1');

  // Empty string defaults so parameterless auto-update preserves existing config (especially reset_day!)
  assert.match(psProbe, /\[string\]\$CollectInterval\s*=\s*""/);
  assert.match(psProbe, /\[string\]\$ReportInterval\s*=\s*""/);
  assert.match(psProbe, /\[string\]\$ResetDay\s*=\s*""/);
  assert.match(psProbe, /Resolve-IntOptionValue\s+-ExplicitValue\s+\$ResetDay\s+-ExistingConfig\s+\$existingConfig\s+-PropertyName\s+'reset_day'\s+-DefaultValue\s+1/);

  // Protected ProgramData\CFProbe directory with ReparsePoint check, setowner, $LASTEXITCODE check, and SYSTEM & Administrators ACLs
  assert.match(psProbe, /Join-Path\s+\$programData\s+"CFProbe"/);
  assert.match(psProbe, /\[IO\.FileAttributes\]::ReparsePoint/);
  assert.match(psProbe, /icacls\s+\$Path\s+\/setowner\s+"\*S-1-5-32-544"/);
  assert.match(psProbe, /if\s*\(\$LASTEXITCODE\s*-ne\s*0\)\s*\{\s*\n\s*throw/);
  assert.match(psProbe, /icacls\s+\$Path\s+\/inheritance:r\s+\/grant:r\s+"\*S-1-5-18:\(OI\)\(CI\)F"\s+"\*S-1-5-32-544:\(OI\)\(CI\)F"/);
  const getTempDirBlock = psProbe.match(/function Get-AgentUpdateTempDir\s*\{[\s\S]*?\n\}/);
  assert.ok(getTempDirBlock, 'Get-AgentUpdateTempDir must exist');
  const getTempDirCode = getTempDirBlock[0]
    .split('\n')
    .filter(line => !line.trim().startsWith('#'))
    .join('\n');
  assert.doesNotMatch(getTempDirCode, /\$env:TEMP|\$env:TMP|GetTempPath/);
  assert.match(getTempDirCode, /if\s*\(-not\s*\(Test-Admin\)\)\s*\{\s*\n\s*return\s+\$null/);

  // Install-Service migrates config & traffic from legacy ScheduledTask script directory as well as $SCRIPT_DIR
  const installServiceBlock = psProbe.match(/function Install-Service\s*\{[\s\S]*?\n\}/);
  assert.ok(installServiceBlock, 'Install-Service must exist');
  assert.match(installServiceBlock[0], /Get-ScheduledTask\s+-TaskName\s+\$TASK_NAME/);
  assert.match(installServiceBlock[0], /Get-AgentScriptFromScheduledTask\s+-ScheduledTask\s+\$existingTask/);
  assert.match(installServiceBlock[0], /\$legacyCandidateDirs/);

  // Secret is masked, never printed in plaintext
  assert.doesNotMatch(psProbe, /secret:\s*'?\$\(\$config\.secret\)/);
  assert.match(psProbe, /Mask-SecretValue/);

  // InvariantCulture & F2 LoadAvg & virtual NIC exclusion & nvidia-smi timeout & TcpClient Dispose & headless fallback
  assert.match(psProbe, /\[System\.Globalization\.CultureInfo\]::InvariantCulture/);
  assert.match(psProbe, /"\{0:F2\} \{1:F2\} \{2:F2\}"/);
  assert.doesNotMatch(psProbe, /"\{0:N2\} \{1:N2\} \{2:N2\}"/);
  assert.match(psProbe, /Test-VirtualOrExcludedAdapter/);
  assert.match(psProbe, /Invoke-NvidiaSmiWithTimeout/);
  assert.match(psProbe, /\$tcp\.Close\(\)[\s\S]*?\$tcp\.Dispose\(\)/);
  assert.match(psProbe, /Start-HeadlessCollectLoop/);

  // Uninstaller safely handles empty $PSCommandPath (irm | iex) and cleans ProgramData\CFProbe
  assert.doesNotMatch(psUninstall, /Split-Path\s+-Parent\s+\$PSCommandPath/);
  assert.match(psUninstall, /Get-CallerScriptPath/);
  assert.match(psUninstall, /Join-Path\s+\$programData\s+'CFProbe'/);
  assert.match(psUninstall, /cf_probe_ping_results\.json/);
});

test('uninstall.sh handles non-TTY stdin cleanly without silent abort or hang', () => {
  const uninstallContent = readProjectFile('public/uninstall.sh');
  assert.match(uninstallContent, /<\/dev\/tty/);
  assert.match(uninstallContent, /-s -- -y/);
  assert.match(uninstallContent, /cancel_auto_update_tasks/);
});

test('build-github-page.js injects CSP meta without frame-ancestors, supports BACKGROUND_IMAGE_MOBILE, deduplicates background styles, and avoids plaintext env logging', () => {
  const buildScriptSrc = readProjectFile('scripts/build-github-page.js');
  assert.doesNotMatch(buildScriptSrc, /console\.log\(['"]Config from env:/);

  const csp = buildGithubPageCsp({
    staticDomains: ['https://cdn.example.com'],
    apiDomains: ['https://api.example.com', 'wss://api.example.com']
  });
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /https:\/\/cdn\.example\.com/);
  assert.match(csp, /wss:\/\/api\.example\.com/);
  assert.doesNotMatch(csp, /frame-ancestors/i);

  const preInjectedBg = buildBackgroundStyle('https://img.example.com/desktop.jpg');
  const inputHtml = `<!DOCTYPE html><html><head><title>Old</title><meta name="apiBase" content="">${preInjectedBg}</head><body></body></html>`;
  const transformed = transformGithubPageHtml(inputHtml, {
    title: 'Monitor <Prod>',
    apiBase: ['https://api.example.com'],
    staticDomains: ['https://img.example.com'],
    backgroundImage: 'https://img.example.com/desktop.jpg',
    mobileBackgroundImage: 'https://img.example.com/mobile.jpg'
  });

  assert.match(transformed, /<meta http-equiv="Content-Security-Policy" content="[^"]+">/);
  assert.doesNotMatch(transformed, /frame-ancestors/i);
  assert.match(transformed, /<title>Monitor &lt;Prod&gt;<\/title>/);
  assert.match(transformed, /<meta name="apiBase" content="https:\/\/api\.example\.com">/);
  assert.match(transformed, /https:\/\/img\.example\.com\/mobile\.jpg/);

  const styleTagCount = (transformed.match(/<style>/g) || []).length;
  assert.equal(styleTagCount, 1, 'Background style must be injected at most once');

  // Mobile-only background style deduplication
  const preInjectedMobileOnly = buildBackgroundStyle('', 'https://img.example.com/mobile-old.jpg');
  const mobileInputHtml = `<!DOCTYPE html><html><head><title>Mobile</title>${preInjectedMobileOnly}</head><body></body></html>`;
  const mobileTransformed = transformGithubPageHtml(mobileInputHtml, {
    backgroundImage: '',
    mobileBackgroundImage: 'https://img.example.com/mobile-new.jpg'
  });
  assert.equal((mobileTransformed.match(/<style>/g) || []).length, 1, 'Mobile-only background style must be deduplicated');
  assert.doesNotMatch(mobileTransformed, /mobile-old\.jpg/);
  assert.match(mobileTransformed, /mobile-new\.jpg/);
});

test('headers, index.html, manifest.json, iOS widget, and GitHub Actions workflows meet security requirements', () => {
  const headers = readProjectFile('public/_headers');
  assert.match(headers, /X-Content-Type-Options:\s*nosniff/);
  assert.match(headers, /X-Frame-Options:\s*DENY/);
  assert.match(headers, /Referrer-Policy:\s*strict-origin-when-cross-origin/);
  assert.match(headers, /\/install\*\.sh[\s\S]*?Cache-Control:\s*no-cache, no-store, must-revalidate/);
  assert.match(headers, /\/cf-server-monitor\.ps1[\s\S]*?Cache-Control:\s*no-cache, no-store, must-revalidate/);
  assert.match(headers, /\/uninstall\*[\s\S]*?Cache-Control:\s*no-cache, no-store, must-revalidate/);

  const indexHtml = readProjectFile('index.html');
  assert.match(indexHtml, /href="\/favicon\.png"/);
  assert.match(indexHtml, /href="\/manifest\.json"/);

  const manifest = JSON.parse(readProjectFile('public/manifest.json'));
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  assert.equal(manifest.display, 'standalone');
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length === 2);
  assert.deepEqual(manifest.icons.map(i => i.src), ['./favicon.png', './favicon.ico']);

  const widget = readProjectFile('scripts/ios-scriptable-widget.js');
  assert.doesNotMatch(widget, /function addServerRow\b/);
  assert.match(widget, /\^\[a-z\]\{2\}\$/);
  assert.match(widget, /statusCode < 200 \|\| statusCode >= 300/);
  assert.match(widget, /trafficLimitBytes\(server\.traffic_limit\) > 0/);
  assert.match(widget, /isValidHttpsBaseUrl/);

  const deployYml = readProjectFile('.github/workflows/deploy.yml');
  assert.match(deployYml, /^permissions:\s*\n\s*contents:\s*read/m);
  assert.match(deployYml, /run:\s*npm ci/);
  assert.doesNotMatch(deployYml, /<<\s*WEOF/);
  assert.match(deployYml, /keep_vars = true/);
  assert.match(deployYml, /if \[ -n "\$API_SECRET" \]; then/);

  // Execute deploy.yml's inline wrangler.toml generator to verify keep_vars = true and non-empty [vars]
  const nodeScriptMatch = deployYml.match(/node -e '\n([\s\S]*?)\n\s*'/);
  assert.ok(nodeScriptMatch, 'deploy.yml should contain inline node script');
  const tmpDeployDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-deploy-toml-'));
  try {
    execFileSync(process.execPath, ['-e', nodeScriptMatch[1]], {
      cwd: tmpDeployDir,
      env: {
        ...process.env,
        D1_DATABASE_ID: 'db-uuid-123',
        API_USER_NAME: '',
        CORS_ALLOWED_ORIGINS: '   '
      }
    });
    const emptyVarsToml = fs.readFileSync(path.join(tmpDeployDir, 'wrangler.toml'), 'utf8');
    assert.match(emptyVarsToml, /^keep_vars = true$/m);
    assert.doesNotMatch(emptyVarsToml, /^API_USER_NAME\s*=/m);
    assert.doesNotMatch(emptyVarsToml, /^CORS_ALLOWED_ORIGINS\s*=/m);

    execFileSync(process.execPath, ['-e', nodeScriptMatch[1]], {
      cwd: tmpDeployDir,
      env: {
        ...process.env,
        D1_DATABASE_ID: 'db-uuid-123',
        API_USER_NAME: 'admin-custom',
        CORS_ALLOWED_ORIGINS: 'https://status.example.com'
      }
    });
    const populatedVarsToml = fs.readFileSync(path.join(tmpDeployDir, 'wrangler.toml'), 'utf8');
    assert.match(populatedVarsToml, /^keep_vars = true$/m);
    assert.match(populatedVarsToml, /^API_USER_NAME = "admin-custom"$/m);
    assert.match(populatedVarsToml, /^CORS_ALLOWED_ORIGINS = "https:\/\/status\.example\.com"$/m);
  } finally {
    fs.rmSync(tmpDeployDir, { recursive: true, force: true });
  }

  const deployPagesYml = readProjectFile('.github/workflows/deploy-github-page.yml');
  assert.match(deployPagesYml, /^permissions:\s*\n\s*contents:\s*read/m);
  assert.match(deployPagesYml, /run:\s*npm ci/);
  assert.match(deployPagesYml, /BACKGROUND_IMAGE_MOBILE:/);
});

test('public IP validators reject captive portal HTML and malformed addresses across all Unix/Linux probes', () => {
  for (const { file, innerShell } of INSTALL_SCRIPTS) {
    const inner = extractInnerProbeScript(file);
    const v4Fn = extractShellFunction(inner, 'is_valid_ipv4');
    const v6Fn = extractShellFunction(inner, 'is_valid_ipv6');

    const out = execFileSync(innerShell, ['-c', `
      export LC_ALL=C LANG=C
      ${v4Fn}
      ${v6Fn}
      is_valid_ipv4 "203.0.113.42" || exit 1
      if is_valid_ipv4 "<html><body>Portal</body></html>"; then exit 1; fi
      if is_valid_ipv4 "999.1.1.1"; then exit 1; fi
      is_valid_ipv6 "2001:db8::1" || exit 1
      if is_valid_ipv6 "<html>login</html>"; then exit 1; fi
      if is_valid_ipv6 "not-an-ipv6"; then exit 1; fi
      echo "IP_VALIDATORS_OK"
    `], { encoding: 'utf8' }).trim();
    assert.equal(out, 'IP_VALIDATORS_OK', `IP validator check failed in ${file}`);
  }
});

test('refresh_probe_async returns 0 under set -eu when BD_NODE is empty across all 5 probes', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-refresh-probe-'));
  try {
    for (const { file, innerShell } of INSTALL_SCRIPTS) {
      const inner = extractInnerProbeScript(file);
      const writeProbeFn = extractShellFunction(inner, 'write_probe_result');
      const refreshProbeFn = extractShellFunction(inner, 'refresh_probe_async');
      const logDebugFn = extractShellFunction(inner, 'log_debug');
      const logWarnDebugFn = extractShellFunction(inner, 'log_warn_debug');

      const out = execFileSync(innerShell, ['-c', `
        set -eu
        export LC_ALL=C LANG=C
        RUN_DIR="$1"
        DEBUG_MODE=0
        log_ts() { echo "2026-01-01T00:00:00Z"; }
        get_probe() { echo "18 0"; }
        ${logDebugFn}
        ${logWarnDebugFn}
        ${writeProbeFn}
        ${refreshProbeFn}

        log_debug "silent debug"
        log_warn_debug "silent warn"

        CT_NODE=""
        CU_NODE=""
        CM_NODE=""
        BD_NODE=""
        refresh_probe_async

        CT_NODE="ct.example.com"
        BD_NODE=""
        refresh_probe_async
        [ -s "$RUN_DIR/probe_ct" ] || { echo "MISSING_PROBE_CT"; exit 1; }
        echo "REFRESH_OK"
      `, '_', tmpDir], { encoding: 'utf8' }).trim();
      assert.equal(out, 'REFRESH_OK', `refresh_probe_async set -eu check failed in ${file}`);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('verify_secure_dir resists stat stdout pollution, avoids test -O, and falls back to POSIX ls -ldn across all 5 probes', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-stat-pollute-'));
  try {
    for (const { file, innerShell } of INSTALL_SCRIPTS) {
      const inner = extractInnerProbeScript(file);
      assert.doesNotMatch(inner, /\[\s+-O\s+/, `${file} must not use non-POSIX test -O`);

      const verifyFnRaw = extractShellFunction(inner, 'verify_secure_dir');
      if (file === 'public/install-mac.sh') {
        assert.match(verifyFnRaw, /\/usr\/bin\/stat -f '%u'/);
        assert.doesNotMatch(verifyFnRaw, /stat -c/);
      } else {
        assert.match(verifyFnRaw, /stat -c '%u'/);
        assert.doesNotMatch(verifyFnRaw, /stat -f/);
      }

      // Simulate polluted multi-line stat stdout (e.g. GNU coreutils stat -f or BusyBox mismatch)
      const verifyFnPolluted = verifyFnRaw
        .replace('/usr/bin/stat', 'mock_polluted_stat')
        .replace(/\bstat -c\b/, 'mock_polluted_stat -c');

      const dirOk = path.join(tmpRoot, path.basename(file, '.sh') + '-ok');
      const statusOk = execFileSync(innerShell, ['-c', `
        set -eu
        export LC_ALL=C LANG=C
        mock_polluted_stat() {
          printf '  File: "%s"\\n    ID: 1000004 Namelen: 255 Type: apfs\\nBlock size: 4096\\n' "$*"
          return 1
        }
        ${verifyFnPolluted}
        verify_secure_dir "$1"
        echo "FALLBACK_OK"
      `, '_', dirOk], { encoding: 'utf8' }).trim();
      assert.equal(statusOk, 'FALLBACK_OK', `Polluted stat fallback failed in ${file}`);
      assert.equal(fs.statSync(dirOk).mode & 0o777, 0o700);

      // Simulate wrong owner UID returned by ls -ldn
      const statusWrongOwner = execFileSync(innerShell, ['-c', `
        set -u
        export LC_ALL=C LANG=C
        mock_polluted_stat() { return 1; }
        ls() { printf 'drwx------ 2 999999 999999 64 Jan  1 00:00 %s\\n' "$2"; }
        ${verifyFnPolluted}
        if verify_secure_dir "$1"; then echo "UNEXPECTED_ALLOW"; else echo "REJECTED_UID"; fi
      `, '_', dirOk], { encoding: 'utf8' }).trim();
      assert.equal(statusWrongOwner, 'REJECTED_UID', `Wrong owner UID must be rejected in ${file}`);
    }
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('macOS AbandonProcessGroup, log rotation fallback, Alpine /etc/init.d guard, outer traffic correction validation, and awk ENVIRON["PAT"]', () => {
  const macOuter = readProjectFile('public/install-mac.sh');
  const macInner = extractInnerProbeScript('public/install-mac.sh');
  assert.match(macOuter, /<key>KeepAlive<\/key>\s*<true\/>\s*<key>AbandonProcessGroup<\/key>\s*<true\/>/);
  assert.match(macInner, /if \[ -z "\$PROBE_LOG_FILE" \] && \[ ! -t 1 \] && \[ -f "\/var\/log\/cf-probe\.log" \] && \[ -w "\/var\/log\/cf-probe\.log" \]; then\s*\n\s*PROBE_LOG_FILE="\/var\/log\/cf-probe\.log"/);

  const alpineOuter = readProjectFile('public/install-alpine.sh');
  const createServiceBlock = extractShellFunction(alpineOuter, 'create_service');
  assert.match(createServiceBlock, /if \[ "\$INIT_SYSTEM" = "openrc" \]; then[\s\S]*?cat > "\$\{OPENRC_FILE\}"/);

  const uninstallSh = readProjectFile('public/uninstall.sh');
  assert.doesNotMatch(uninstallSh, /awk -v pat=/);
  assert.match(uninstallSh, /ENVIRON\["PAT"\]/);

  for (const { file, outerShell } of INSTALL_SCRIPTS) {
    const outer = readProjectFile(file);
    assert.doesNotMatch(outer, /awk -v pat=/, `${file} must not pass pattern via awk -v pat=`);
    assert.match(outer, /ENVIRON\["PAT"\]/, `${file} must match processes via ENVIRON["PAT"]`);

    const outerWithoutInner = outer.replace(/<<\s*'PROBE_EOF'[\s\S]*?\nPROBE_EOF/, '');
    const corrFn = extractShellFunction(outerWithoutInner, 'is_valid_correction_value');
    const corrCheck = execFileSync(outerShell, ['-c', `
      set -eu
      export LC_ALL=C LANG=C
      MAX_TRAFFIC_CORRECTION_GB=1000000
      ${corrFn}
      is_valid_correction_value "0"
      is_valid_correction_value "128.75"
      is_valid_correction_value "1000000"
      for bad in "" "-1" "abc" "1000001" ".5" "5." "1.2.3"; do
        if is_valid_correction_value "$bad"; then
          echo "ACCEPTED_BAD:$bad"
          exit 1
        fi
      done
      echo "CORR_OK"
    `], { encoding: 'utf8' }).trim();
    assert.equal(corrCheck, 'CORR_OK', `Outer traffic correction validation failed in ${file}`);
  }
});


