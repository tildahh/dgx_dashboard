import 'dart:io';

/// Represents memory usage metrics.
typedef MemoryMetrics = ({int totalKb, int usedKb, int availableKb});

/// Monitors system memory usage by reading from `/proc/meminfo`.
///
/// This monitor reads total and available memory from the Linux `/proc/meminfo`
/// file and calculates used memory.
class MemoryMonitor {
  /// Reads the current memory usage metrics.
  ///
  /// Returns a [MemoryMetrics] record containing total, used, and available
  /// memory in kilobytes. Returns zeros if the data cannot be read.
  MemoryMetrics readMetrics() {
    int? total;
    int? available;

    for (final line in File('/proc/meminfo').readAsLinesSync()) {
      if (total == null && line.startsWith('MemTotal:')) {
        total = int.tryParse(line.replaceAll(RegExp(r'[^0-9]'), ''));
      } else if (available == null && line.startsWith('MemAvailable:')) {
        available = int.tryParse(line.replaceAll(RegExp(r'[^0-9]'), ''));
      }

      // Exit early once we have both values
      if (total != null && available != null) break;
    }

    final totalKb = total ?? 0;
    final availableKb = available ?? 0;
    final usedKb = (totalKb - availableKb).clamp(0, totalKb);

    return (totalKb: totalKb, usedKb: usedKb, availableKb: availableKb);
  }
}
