// Asks the operating system to confirm that the person at the computer is its owner before a saved password is shown or
// copied: Windows Hello (PIN, face or fingerprint) or Touch ID on a Mac. On Windows the prompt is a child of Solamar's
// window (IUserConsentVerifierInterop through a short PowerShell script, no native module), so it opens in front of it.
// SOLAMAR_TEST_OS_AUTH=verified|canceled|unavailable answers without a prompt (tests).
import { spawn } from 'node:child_process'
import { systemPreferences } from 'electron'

export type OsAuthKind = 'windows-hello' | 'touch-id' | 'none'
export type OsAuthResult = 'verified' | 'canceled' | 'unavailable'

const testAnswer = () => {
  const t = process.env.SOLAMAR_TEST_OS_AUTH
  return t === 'verified' || t === 'canceled' || t === 'unavailable' ? t : null
}

const LOAD = `
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Security.Credentials.UI.UserConsentVerifier, Windows.Security.Credentials.UI, ContentType = WindowsRuntime]
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' } | Select-Object -First 1
`

const CHECK = `${LOAD}
$op = [Windows.Security.Credentials.UI.UserConsentVerifier]::CheckAvailabilityAsync()
$t = $asTask.MakeGenericMethod([Windows.Security.Credentials.UI.UserConsentVerifierAvailability]).Invoke($null, @($op))
$t.Wait()
Write-Output $t.Result
`

// Result numbers are UserConsentVerificationResult: 0 Verified, 6 Canceled, 1-5 cannot verify; -1 the call failed.
const VERIFY = (hwnd: string, message: string) => `${LOAD}
$opIid = [Windows.Security.Credentials.UI.UserConsentVerifier].GetMethod('RequestVerificationAsync').ReturnType.GUID
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Threading;
public static class SolamarHello {
  [DllImport("combase.dll")] static extern int WindowsCreateString([MarshalAs(UnmanagedType.LPWStr)] string s, int len, out IntPtr h);
  [DllImport("combase.dll")] static extern int WindowsDeleteString(IntPtr h);
  [DllImport("combase.dll")] static extern int RoGetActivationFactory(IntPtr classId, ref Guid iid, out IntPtr factory);
  [ComImport, Guid("39E050C3-4E74-441A-8DC0-B81104DF949C"), InterfaceType(ComInterfaceType.InterfaceIsIInspectable)]
  interface IUserConsentVerifierInterop { [PreserveSig] int RequestVerificationForWindowAsync(IntPtr appWindow, IntPtr message, ref Guid riid, out IntPtr op); }
  [ComImport, Guid("00000036-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIInspectable)]
  interface IAsyncInfo { [PreserveSig] int get_Id(out uint id); [PreserveSig] int get_Status(out int status); [PreserveSig] int get_ErrorCode(out int hr); [PreserveSig] int Cancel(); [PreserveSig] int Close(); }
  [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int GetResultsFn(IntPtr self, out int result);
  static IntPtr HString(string s) { IntPtr h; WindowsCreateString(s, s.Length, out h); return h; }
  public static int Verify(long hwnd, string message, Guid opIid) {
    IntPtr cls = HString("Windows.Security.Credentials.UI.UserConsentVerifier"), msg = HString(message);
    try {
      Guid iid = typeof(IUserConsentVerifierInterop).GUID; IntPtr f, op;
      if (RoGetActivationFactory(cls, ref iid, out f) != 0) return -1;
      var interop = (IUserConsentVerifierInterop)Marshal.GetObjectForIUnknown(f);
      if (interop.RequestVerificationForWindowAsync(new IntPtr(hwnd), msg, ref opIid, out op) != 0) return -1;
      var info = (IAsyncInfo)Marshal.GetObjectForIUnknown(op);
      int status; do { Thread.Sleep(40); info.get_Status(out status); } while (status == 0);
      if (status != 1) return 6;
      var get = (GetResultsFn)Marshal.GetDelegateForFunctionPointer(Marshal.ReadIntPtr(Marshal.ReadIntPtr(op), 8 * IntPtr.Size), typeof(GetResultsFn));
      int result; return get(op, out result) == 0 ? result : -1;
    } finally { WindowsDeleteString(cls); WindowsDeleteString(msg); }
  }
}
'@
$r = [SolamarHello]::Verify(${hwnd}, '${message.replace(/'/g, "''")}', $opIid)
if ($r -eq -1) {
  # No window to attach to: the plain prompt.
  $op = [Windows.Security.Credentials.UI.UserConsentVerifier]::RequestVerificationAsync('${message.replace(/'/g, "''")}')
  $t = $asTask.MakeGenericMethod([Windows.Security.Credentials.UI.UserConsentVerificationResult]).Invoke($null, @($op))
  $t.Wait()
  $r = [int]$t.Result
}
Write-Output $r
`

function powershell(script: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    const encoded = Buffer.from(script, 'utf16le').toString('base64')
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { windowsHide: true })
    let out = ''
    child.stdout.on('data', (d) => (out += d))
    const timer = setTimeout(() => child.kill(), timeoutMs)
    child.on('close', () => (clearTimeout(timer), resolve(out.trim())))
    child.on('error', () => (clearTimeout(timer), resolve('')))
  })
}

let kind: Promise<OsAuthKind> | null = null

/** What this computer can confirm the user with; worked out once. */
export function osAuthKind(): Promise<OsAuthKind> {
  if (testAnswer()) return Promise.resolve(testAnswer() === 'unavailable' ? 'none' : 'windows-hello')
  kind ??= (async (): Promise<OsAuthKind> => {
    if (process.platform === 'win32') return (await powershell(CHECK, 15_000)) === 'Available' ? 'windows-hello' : 'none'
    if (process.platform === 'darwin') return systemPreferences.canPromptTouchID() ? 'touch-id' : 'none'
    return 'none'
  })()
  return kind
}

/** Shows the system prompt. `hwnd` is the window's native handle (BaseWindow.getNativeWindowHandle()). */
export async function osVerify(reason: string, hwnd?: Buffer): Promise<OsAuthResult> {
  const t = testAnswer()
  if (t) return t
  if ((await osAuthKind()) === 'none') return 'unavailable'
  if (process.platform === 'darwin')
    return systemPreferences.promptTouchID(reason).then(
      () => 'verified' as const,
      () => 'canceled' as const
    )
  const handle = hwnd && hwnd.length >= 8 ? hwnd.readBigUInt64LE(0).toString() : hwnd && hwnd.length >= 4 ? String(hwnd.readUInt32LE(0)) : '0'
  const r = Number(await powershell(VERIFY(handle, reason), 5 * 60_000))
  return r === 0 ? 'verified' : r === 6 ? 'canceled' : 'unavailable'
}
