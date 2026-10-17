param([int]$TargetProcessId)

Add-Type @"
using System;
using System.Runtime.InteropServices;

public class TokenProbe {
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern IntPtr OpenProcess(uint access, bool inherit, int processId);

  [DllImport("advapi32.dll", SetLastError = true)]
  public static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);

  [DllImport("advapi32.dll", SetLastError = true)]
  public static extern bool GetTokenInformation(IntPtr token, int infoClass, IntPtr info, int length, out int returnLength);

  [DllImport("advapi32.dll")]
  public static extern IntPtr GetSidSubAuthorityCount(IntPtr sid);

  [DllImport("advapi32.dll")]
  public static extern IntPtr GetSidSubAuthority(IntPtr sid, int index);

  [DllImport("kernel32.dll")]
  public static extern bool CloseHandle(IntPtr handle);
}
"@

$PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
$TOKEN_QUERY = 0x8
$TokenIntegrityLevel = 25

$process = [TokenProbe]::OpenProcess($PROCESS_QUERY_LIMITED_INFORMATION, $false, $TargetProcessId)
if ($process -eq [IntPtr]::Zero) {
  throw "OpenProcess failed for PID $TargetProcessId"
}

$token = [IntPtr]::Zero
if (-not [TokenProbe]::OpenProcessToken($process, $TOKEN_QUERY, [ref]$token)) {
  throw "OpenProcessToken failed for PID $TargetProcessId"
}

$length = 0
[TokenProbe]::GetTokenInformation($token, $TokenIntegrityLevel, [IntPtr]::Zero, 0, [ref]$length) | Out-Null
$buffer = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($length)
if (-not [TokenProbe]::GetTokenInformation($token, $TokenIntegrityLevel, $buffer, $length, [ref]$length)) {
  throw "GetTokenInformation failed for PID $TargetProcessId"
}

$sid = [System.Runtime.InteropServices.Marshal]::ReadIntPtr($buffer)
$count = [System.Runtime.InteropServices.Marshal]::ReadByte([TokenProbe]::GetSidSubAuthorityCount($sid))
$rid = [System.Runtime.InteropServices.Marshal]::ReadInt32([TokenProbe]::GetSidSubAuthority($sid, $count - 1))

$level = switch ($rid) {
  0x0000 { 'Untrusted' }
  0x1000 { 'Low' }
  0x2000 { 'Medium' }
  0x3000 { 'High' }
  0x4000 { 'System' }
  default { "Unknown (0x{0:X})" -f $rid }
}

"PID $TargetProcessId integrity: $level (0x{0:X})" -f $rid

[TokenProbe]::CloseHandle($token) | Out-Null
[TokenProbe]::CloseHandle($process) | Out-Null
