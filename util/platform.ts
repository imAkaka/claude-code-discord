// Platform utilities for Linux/macOS

export type PlatformType = 'linux' | 'darwin' | 'unknown';

/**
 * Detect the current operating system platform
 */
export function detectPlatform(): PlatformType {
  const os = Deno.build.os;
  switch (os) {
    case 'linux':
      return 'linux';
    case 'darwin':
      return 'darwin';
    default:
      return 'unknown';
  }
}

/**
 * Get platform-specific system commands
 */
export interface SystemCommands {
  processListCmd: string[];
  systemInfoCmd: string[];
  networkInfoCmd: string[];
  diskUsageCmd: string[];
  systemLogsCmd: string[];
  serviceStatusCmd: string[];
  uptimeCmd: string[];
  killProcessCmd: (pid: number) => string[];
  findProcessCmd: (name: string) => string[];
}

export function getPlatformCommands(): SystemCommands {
  const platform = detectPlatform();

  switch (platform) {
    case 'linux':
      return {
        processListCmd: ['ps', 'aux', '--sort=-%cpu'],
        systemInfoCmd: ['uname', '-a'],
        networkInfoCmd: ['ip', 'addr', 'show'],
        diskUsageCmd: ['df', '-h'],
        systemLogsCmd: ['journalctl', '-n', '50', '--no-pager'],
        serviceStatusCmd: ['systemctl', 'status', '--no-pager'],
        uptimeCmd: ['uptime'],
        killProcessCmd: (pid: number) => ['kill', '-TERM', pid.toString()],
        findProcessCmd: (name: string) => ['pgrep', '-l', name]
      };

    case 'darwin':
      return {
        processListCmd: ['ps', 'aux'],
        systemInfoCmd: ['uname', '-a'],
        networkInfoCmd: ['ifconfig'],
        diskUsageCmd: ['df', '-h'],
        systemLogsCmd: ['log', 'show', '--last', '1h', '--style', 'compact'],
        serviceStatusCmd: ['launchctl', 'list'],
        uptimeCmd: ['uptime'],
        killProcessCmd: (pid: number) => ['kill', '-TERM', pid.toString()],
        findProcessCmd: (name: string) => ['pgrep', '-l', name]
      };

    default:
      return {
        processListCmd: ['ps', 'aux'],
        systemInfoCmd: ['uname', '-a'],
        networkInfoCmd: ['ifconfig'],
        diskUsageCmd: ['df', '-h'],
        systemLogsCmd: ['dmesg', '|', 'tail', '-50'],
        serviceStatusCmd: ['ps', 'aux'],
        uptimeCmd: ['uptime'],
        killProcessCmd: (pid: number) => ['kill', pid.toString()],
        findProcessCmd: (name: string) => ['ps', 'aux', '|', 'grep', name]
      };
  }
}

/**
 * Execute platform-specific command with proper error handling
 */
export async function executeSystemCommand(command: string[]): Promise<string> {
  try {
    const cmd = new Deno.Command(command[0], {
      args: command.slice(1),
      stdout: 'piped',
      stderr: 'piped'
    });

    const { code, stdout, stderr } = await cmd.output();

    if (code === 0) {
      return new TextDecoder().decode(stdout);
    } else {
      const errorOutput = new TextDecoder().decode(stderr);
      return `Command failed (exit code ${code}): ${errorOutput}`;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `Execution error: ${message}`;
  }
}

/**
 * Get platform-friendly display names
 */
export function getPlatformDisplayName(): string {
  const platform = detectPlatform();
  switch (platform) {
    case 'linux': return 'Linux';
    case 'darwin': return 'macOS';
    default: return 'Unknown OS';
  }
}

/**
 * Check if a command is available on current platform
 */
export async function isCommandAvailable(command: string): Promise<boolean> {
  try {
    const cmd = new Deno.Command('which', {
      args: [command],
      stdout: 'piped',
      stderr: 'piped'
    });

    const { code } = await cmd.output();
    return code === 0;
  } catch {
    return false;
  }
}

/**
 * Get shell command for the current platform
 */
export function getShellCommand(): string[] {
  return ['bash', '-c'];
}

/**
 * Format file size in human-readable units
 */
export function formatFileSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  const formatted = size.toFixed(unitIndex === 0 ? 0 : 2);
  return `${formatted} ${units[unitIndex]}`;
}

/**
 * Platform-specific process information
 */
export interface ProcessInfo {
  pid: number;
  name: string;
  cpu?: number;
  memory?: number;
  status?: string;
}

/**
 * Parse Unix ps output into structured process list
 */
export function parseProcessList(output: string): ProcessInfo[] {
  const lines = output.trim().split('\n');
  const processes: ProcessInfo[] = [];
  const dataLines = lines.slice(1); // Skip header

  for (const line of dataLines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 11) {
      processes.push({
        pid: parseInt(parts[1]) || 0,
        name: parts[10] || 'Unknown',
        cpu: parseFloat(parts[2]) || 0,
        memory: parseFloat(parts[3]) || 0,
        status: parts[7] || 'Unknown'
      });
    }
  }
  return processes;
}
