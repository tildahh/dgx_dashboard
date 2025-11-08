import 'dart:io';

/// Represents system temperature metrics.
typedef TemperatureMetrics = ({double? systemTemperatureC});

/// Monitors system temperature by reading from `/sys/class/thermal`.
///
/// This monitor reads temperature from all available thermal sensors in the
/// Linux `/sys/class/thermal` directory and returns the maximum temperature.
class TemperatureMonitor {
  final List<File> _thermalFiles;

  /// Creates a new temperature monitor.
  ///
  /// Discovers all available thermal sensor files during initialization.
  TemperatureMonitor() : _thermalFiles = _discoverThermalFiles();

  /// Reads the current system temperature.
  ///
  /// Returns a [TemperatureMetrics] record containing the maximum system
  /// temperature in degrees Celsius.
  ///
  /// Returns a `null` temperature if no thermal sensors are available or
  /// readable.
  TemperatureMetrics readMetrics() {
    var maxTemperatureMilliC = double.negativeInfinity;

    for (final file in _thermalFiles) {
      try {
        final value = double.parse(file.readAsStringSync().trim());
        if (value > maxTemperatureMilliC) {
          maxTemperatureMilliC = value;
        }
      } catch (_) {
        // Ignore unreadable thermal sensors.
      }
    }

    final temperatureC = maxTemperatureMilliC.isFinite
        ? maxTemperatureMilliC / 1000.0
        : null;

    return (systemTemperatureC: temperatureC);
  }

  /// Discovers the available temperature files in `/sys/class/thermal`.
  static List<File> _discoverThermalFiles() {
    try {
      return Directory('/sys/class/thermal')
          .listSync(followLinks: false)
          .map((entity) => File('${entity.path}/temp'))
          .where((file) => file.existsSync())
          .toList();
    } catch (_) {
      return [];
    }
  }
}
