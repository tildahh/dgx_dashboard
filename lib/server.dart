import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'cpu.dart';
import 'gpu.dart';
import 'memory.dart';
import 'temps.dart';

typedef _Metrics = ({
  GpuMetrics gpu,
  CpuMetrics cpu,
  TemperatureMetrics temperature,
  MemoryMetrics memory,
});

/// A HTTP server that handles serving the dashboard.
class Server {
  final GpuMonitor _gpuMonitor;
  final CpuMonitor _cpuMonitor;
  final MemoryMonitor _memoryMonitor;
  final TemperatureMonitor _temperatureMonitor;

  /// A stream of all metrics.
  ///
  /// The GPU Monitor from `nvidia-smi` already polls on an interval so we just
  /// collect other metrics each time it emits.
  late final metricsStream = _gpuMonitor.metrics.map((gpu) {
    final cpu = _cpuMonitor.readMetrics();
    final temperature = _temperatureMonitor.readMetrics();
    final memory = _memoryMonitor.readMetrics();
    return (gpu: gpu, cpu: cpu, temperature: temperature, memory: memory);
  });

  final Set<WebSocket> _connectedClients = {};

  StreamSubscription<_Metrics>? _metricsSubscription;

  /// Creates a server to serve the dashboard.
  Server(
    this._gpuMonitor,
    this._cpuMonitor,
    this._memoryMonitor,
    this._temperatureMonitor,
  );

  /// Starts the server listening on [address]:[port].
  Future<void> start(InternetAddress address, int port) async {
    final server = await HttpServer.bind(address, port);
    final clickableHost = address == InternetAddress.anyIPv4
        ? 'localhost'
        : address.host;
    print('Server listening on http://$clickableHost:$port');

    await server.map(_handleRequest).toList();
  }

  Future<void> _handleRequest(HttpRequest request) async {
    final response = request.response;
    if (request.uri.path == '/ws') {
      if (WebSocketTransformer.isUpgradeRequest(request)) {
        await _handleWebSocket(request);
      } else {
        response
          ..statusCode = HttpStatus.badRequest
          ..write('WebSocket upgrade required');
        await response.close();
      }
    } else if (request.uri.path == '/') {
      final file = File('web/index.html');
      if (await file.exists()) {
        response
          ..headers.contentType = ContentType.html
          ..write(await file.readAsString());
        await response.close();
      } else {
        response
          ..statusCode = HttpStatus.notFound
          ..write('Not found');
        await response.close();
      }
    } else {
      response
        ..statusCode = HttpStatus.notFound
        ..write('Not found');
      await response.close();
    }
  }

  Future<void> _handleWebSocket(HttpRequest request) async {
    final ws = await WebSocketTransformer.upgrade(request);

    // We need the ping otherwise onDone will never fire and we'll never detect
    // disconnections.
    ws.pingInterval = const Duration(seconds: 5);

    _connectedClients.add(ws);

    // Ensure we're running when a client connects.
    _startMetricsStream();

    ws.listen(
      (data) {
        // TODO: Handle incoming messages if required.
      },
      onDone: () {
        if (_connectedClients.remove(ws)) {
          // Pause stream if this was the last one.
          if (_connectedClients.isEmpty) {
            _metricsSubscription?.pause();
            print('Paused metrics stream (no clients)');
          }
        }
      },
    );
  }

  void _startMetricsStream() {
    if (_metricsSubscription case final metricsSubscription?) {
      if (metricsSubscription.isPaused) {
        print('Resumed metrics stream');
        metricsSubscription.resume();
      }
      return;
    }

    print('Starting metrics stream');
    _metricsSubscription = metricsStream.listen((ev) {
      final messageJson = {
        'gpu': {
          'usagePercent': ev.gpu.usagePercent,
          'powerW': ev.gpu.powerW,
          'temperatureC': ev.gpu.temperatureC,
        },
        'cpu': {'usagePercent': ev.cpu.usagePercent},
        'temperature': {
          'systemTemperatureC': ev.temperature.systemTemperatureC,
        },
        'memory': {
          'usedKb': ev.memory.usedKb,
          'availableKb': ev.memory.availableKb,
          'totalKb': ev.memory.totalKb,
        },
      };

      // Send to all connected clients.
      for (final client in _connectedClients.toList()) {
        try {
          client.add(jsonEncode(messageJson));
        } catch (e) {
          print('Error sending to client: $e');
        }
      }

      // Pause if no clients.
      if (_connectedClients.isEmpty) {
        _metricsSubscription?.pause();
      }
    });
  }
}
