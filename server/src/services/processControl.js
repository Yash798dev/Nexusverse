// Pause, resume and stop a spawned worker together with everything it started —
// the Python pipeline launches ffmpeg and other helpers of its own, and pausing
// only the Python process would leave those running.
//
// POSIX: the child is spawned as its own process group, so one signal to -pid
// reaches the whole tree (SIGSTOP / SIGCONT / SIGTERM).
// Windows: there are no process groups or stop signals. The tree is found by
// parent pid and each process is suspended/resumed with NtSuspendProcess /
// NtResumeProcess (the calls Task Manager's "suspend" uses), via PowerShell;
// stopping uses `taskkill /T /F`.
const { execFile } = require("child_process");

const isWindows = process.platform === "win32";

/** Extra spawn() options that make the child controllable as a tree. */
function treeSpawnOptions() {
  return isWindows ? { windowsHide: true } : { detached: true };
}

function assertPid(pid) {
  if (!Number.isInteger(pid) || pid <= 0) throw new Error(`invalid pid: ${pid}`);
}

function windowsTreeScript(pid, action) {
  return `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class AyProcessTree {
  [DllImport("ntdll.dll")] public static extern int NtSuspendProcess(IntPtr handle);
  [DllImport("ntdll.dll")] public static extern int NtResumeProcess(IntPtr handle);
  [DllImport("kernel32.dll", SetLastError = true)] public static extern IntPtr OpenProcess(int access, bool inherit, int pid);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle);
}
'@
$all = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId)
$tree = New-Object System.Collections.Generic.List[int]
$seen = New-Object System.Collections.Generic.HashSet[int]
$tree.Add(${pid})
[void]$seen.Add(${pid})
for ($i = 0; $i -lt $tree.Count; $i++) {
  foreach ($p in $all) {
    if ($p.ParentProcessId -eq $tree[$i] -and $seen.Add([int]$p.ProcessId)) { $tree.Add([int]$p.ProcessId) }
  }
}
$opened = 0
foreach ($id in $tree) {
  $handle = [AyProcessTree]::OpenProcess(0x0800, $false, $id)  # PROCESS_SUSPEND_RESUME
  if ($handle -eq [IntPtr]::Zero) { continue }
  $opened++
  [void][AyProcessTree]::${action}($handle)
  [void][AyProcessTree]::CloseHandle($handle)
}
if ($opened -eq 0) { throw 'process ${pid} is not running' }
`;
}

function run(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, timeout: 30000 }, (err, _stdout, stderr) => {
      if (err) return reject(new Error((stderr || err.message).toString().trim()));
      resolve();
    });
  });
}

function runPowerShell(script) {
  // -EncodedCommand (UTF-16LE base64) sidesteps command-line quoting entirely.
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  return run("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded]);
}

async function suspendTree(pid) {
  assertPid(pid);
  if (isWindows) return runPowerShell(windowsTreeScript(pid, "NtSuspendProcess"));
  process.kill(-pid, "SIGSTOP");
}

async function resumeTree(pid) {
  assertPid(pid);
  if (isWindows) return runPowerShell(windowsTreeScript(pid, "NtResumeProcess"));
  process.kill(-pid, "SIGCONT");
}

async function killTree(pid) {
  assertPid(pid);
  if (isWindows) return run("taskkill", ["/PID", String(pid), "/T", "/F"]);
  process.kill(-pid, "SIGTERM");
  // A stopped (paused) group only acts on SIGTERM once it is continued.
  try { process.kill(-pid, "SIGCONT"); } catch { /* already gone */ }
  setTimeout(() => {
    try { process.kill(-pid, "SIGKILL"); } catch { /* exited cleanly */ }
  }, 5000).unref();
}

module.exports = { treeSpawnOptions, suspendTree, resumeTree, killTree };
