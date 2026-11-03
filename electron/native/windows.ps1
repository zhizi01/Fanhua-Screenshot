# All protocol text is UTF-8. This helper stays alive so Add-Type runs only once.
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding

Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public class FanhuaWindow {
  public string id;
  public string title;
  public int x;
  public int y;
  public int width;
  public int height;
}

public static class FanhuaNative {
  private delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr state);
  [StructLayout(LayoutKind.Sequential)] private struct RECT { public int left, top, right, bottom; }
  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr state);
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int count);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr hwnd, StringBuilder text, int count);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
  [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
  [DllImport("user32.dll")] private static extern bool SetProcessDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] private static extern bool SetProcessDPIAware();
  [DllImport("dwmapi.dll", EntryPoint = "DwmGetWindowAttribute")] private static extern int GetFrame(IntPtr hwnd, int attribute, out RECT rect, int size);
  [DllImport("dwmapi.dll", EntryPoint = "DwmGetWindowAttribute")] private static extern int GetCloaked(IntPtr hwnd, int attribute, out int value, int size);

  public static void EnableDpi() {
    try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch { SetProcessDPIAware(); }
  }

  public static FanhuaWindow[] List(int excludedProcessId) {
    var result = new List<FanhuaWindow>();
    EnumWindows(delegate(IntPtr hwnd, IntPtr state) {
      if (!IsWindowVisible(hwnd) || IsIconic(hwnd)) return true;
      uint processId;
      GetWindowThreadProcessId(hwnd, out processId);
      if (processId == excludedProcessId) return true;
      int cloaked;
      if (GetCloaked(hwnd, 14, out cloaked, 4) == 0 && cloaked != 0) return true;
      var name = new StringBuilder(256);
      GetClassName(hwnd, name, name.Capacity);
      string className = name.ToString();
      if (className == "Progman" || className == "WorkerW" || className == "Shell_TrayWnd" || className == "Shell_SecondaryTrayWnd") return true;
      var title = new StringBuilder(2048);
      GetWindowText(hwnd, title, title.Capacity);
      if (title.Length == 0) return true;
      RECT rect;
      if (GetFrame(hwnd, 9, out rect, Marshal.SizeOf(typeof(RECT))) != 0 && !GetWindowRect(hwnd, out rect)) return true;
      if (rect.right - rect.left < 2 || rect.bottom - rect.top < 2) return true;
      result.Add(new FanhuaWindow { id = hwnd.ToInt64().ToString(), title = title.ToString(), x = rect.left, y = rect.top, width = rect.right - rect.left, height = rect.bottom - rect.top });
      return true;
    }, IntPtr.Zero);
    return result.ToArray();
  }
}
'@
[FanhuaNative]::EnableDpi()
[Console]::WriteLine('{"ready":true}')

while ($null -ne ($line = [Console]::ReadLine())) {
  try {
    $request = $line | ConvertFrom-Json
    switch ($request.command) {
      'windows' { $data = @([FanhuaNative]::List([int]$request.excludeProcessId)) }
      'fonts' {
        Add-Type -AssemblyName System.Drawing
        $collection = New-Object System.Drawing.Text.InstalledFontCollection
        try { $data = @($collection.Families | ForEach-Object { $_.Name } | Sort-Object -Unique) }
        finally { $collection.Dispose() }
      }
      default { throw 'Unknown helper command' }
    }
    $response = @{ id = $request.id; data = $data } | ConvertTo-Json -Depth 6 -Compress
    [Console]::WriteLine($response)
  } catch {
    $response = @{ id = $request.id; error = $_.Exception.Message } | ConvertTo-Json -Compress
    [Console]::WriteLine($response)
  }
}
