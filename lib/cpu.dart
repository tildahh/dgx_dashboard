import 'dart:io';

/// Represents CPU usage metrics.
typedef CpuMetrics = ({int usagePercent});

/// Monitors CPU usage by reading from `/proc/uptime`.
///
/// This monitor tracks CPU usage as a percentage by comparing idle time
/// and total uptime between successive reads.
class CpuMonitor {
  ({int idleMs, int uptimeMs})? _previous;

  /// Reads the current CPU usage percentage.
  ///
  /// Returns a [CpuMetrics] record containing the CPU usage as a percentage
  /// (0-100).
  ///
  /// Returns 0% on the first read or if an error occurs.
  CpuMetrics readMetrics() {
    final line = File('/proc/uptime').readAsStringSync().trim();
    final parts = line.split(' ');
    if (parts.length < 2) {
      return (usagePercent: 0);
    }

    final uptimeSec = double.tryParse(parts[0]) ?? 0.0;
    final idleSec = double.tryParse(parts[1]) ?? 0.0;

    final current = (
      idleMs: (idleSec * 1000).toInt(),
      uptimeMs: (uptimeSec * 1000).toInt(),
    );

    final previous = _previous;
    try {
      // First read - no previous data to compare.
      if (previous == null) {
        return (usagePercent: 0);
      }

      final deltaUptime = current.uptimeMs - previous.uptimeMs;
      final deltaIdle = current.idleMs - previous.idleMs;

      if (deltaUptime <= 0) {
        return (usagePercent: 0);
      }

      final procs = Platform.numberOfProcessors;
      final busyFraction = 1.0 - (deltaIdle / (deltaUptime * procs));
      final usagePercent = (busyFraction * 100).clamp(0.0, 100.0).round();

      return (usagePercent: usagePercent);
    } finally {
      _previous = current;
    }
  }
}
