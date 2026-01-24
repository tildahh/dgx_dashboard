let tempChart, memoryGauge, gpuGauge, memoryLineChart;
let ws;

// Change from dark/light to light/dark mode with a button.
const THEME_KEY = 'dgx-dashboard-theme';

function getSavedTheme() {
	const t = localStorage.getItem(THEME_KEY);
	return (t === 'dark' || t === 'light') ? t : null;
}

function getSystemTheme() {
	return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
		? 'dark'
		: 'light';
}

function updateChartsForTheme() {
	const colors = getChartColors();

	// Update line charts (tempChart, memoryLineChart)
	const lineCharts = [tempChart, memoryLineChart];
	lineCharts.forEach(chart => {
		if (!chart) return;

		// Update y-axis
		chart.options.scales.y.ticks.color = colors.text;
		chart.options.scales.y.grid.color = colors.grid;
		chart.options.scales.y.title.color = colors.text;

		// Update legend if present
		if (chart.options.plugins.legend.labels) {
			chart.options.plugins.legend.labels.color = colors.text;
		}

		chart.update('none');
	});

	// Update gauges text colors for theme
	[memoryGauge, gpuGauge].forEach(gauge => {
		if (!gauge) return;
		gauge.options.plugins.annotation.annotations.usedLabel.color = colors.gaugeText;
		gauge.options.plugins.annotation.annotations.totalLabel.color = colors.gaugeTextMuted;
		gauge.update();
	});
}

function applyTheme(theme) {
	document.documentElement.dataset.theme = theme;

	const btn = document.getElementById('theme-toggle');
	if (btn) {
		btn.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
		btn.title = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
	}

	// Update charts to use new theme colors
	updateChartsForTheme();
}

function initTheme() {
	// Use saved theme if user chose one, otherwise follow OS/browser preference.
	const saved = getSavedTheme();
	applyTheme(saved || getSystemTheme());

	// Toggle button
	const btn = document.getElementById('theme-toggle');
	if (btn) {
		btn.addEventListener('click', () => {
			const cur = document.documentElement.dataset.theme || getSystemTheme();
			const next = cur === 'dark' ? 'light' : 'dark';
			localStorage.setItem(THEME_KEY, next);
			applyTheme(next);
		});
	}

	// If user hasn't chosen a theme, keep following system changes.
	const mql = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
	if (mql && mql.addEventListener) {
		mql.addEventListener('change', () => {
			if (!getSavedTheme()) applyTheme(getSystemTheme());
		});
	}
}

// Historical data for line charts.
const historySize = 10;
const gpuTempHistory = [];
const systemTempHistory = [];
const memoryHistory = [];
const pendingCommands = {};

const dockerActions = {
	'docker-start': {
		label: 'Start',
		pendingLabel: 'Starting…',
		selector: '.start-btn',
		shouldShow: (isRunning, isDashboard) => !isRunning,
		confirm: null
	},
	'docker-stop': {
		label: 'Stop',
		pendingLabel: 'Stopping…',
		selector: '.stop-btn',
		shouldShow: (isRunning, isDashboard) => isRunning && !isDashboard,
		confirm: 'Are you sure you want to stop this container?'
	},
	'docker-restart': {
		label: 'Restart',
		pendingLabel: 'Starting…',
		selector: '.restart-btn',
		shouldShow: (isRunning, isDashboard) => isRunning && isDashboard,
		confirm: 'Are you sure you want to restart this container?'
	}
};

function getChartColors() {
	const style = getComputedStyle(document.documentElement);
	return {
		grid: style.getPropertyValue('--chart-grid').trim() || 'rgba(0,0,0,0.1)',
		text: style.getPropertyValue('--chart-text').trim() || '#666666',
		emptySegment: style.getPropertyValue('--chart-empty-segment').trim() || 'rgb(230, 230, 230)',
		gaugeText: style.getPropertyValue('--gauge-text').trim() || '#111111',
		gaugeTextMuted: style.getPropertyValue('--gauge-text-muted').trim() || 'rgba(0,0,0,0.6)'
	};
}

function createGauge(canvasId, label, maxValue, unit = 'GB') {
	const canvas = document.getElementById(canvasId);
	const ctx = canvas.getContext('2d');
	const colors = getChartColors();

	const chart = new Chart(ctx, {
		type: 'doughnut',
		data: {
			datasets: [{
				// Foreground: value (solid color) + empty segment (dark)
				data: [0, maxValue],
				backgroundColor: [
					'rgb(118, 184, 82)', // Green fill
					'rgba(55, 65, 81, 0.9)' // Dark empty segment
				],
				borderWidth: 0,
				circumference: 180,
				rotation: 270,
				cutout: '68%',
			}]
		},
		options: {
			responsive: true,
			maintainAspectRatio: false,
			aspectRatio: 2,
			layout: {
				padding: {
					top: 25,
					left: 15,
					right: 15
				}
			},
			plugins: {
				legend: {
					display: false
				},
				tooltip: {
					enabled: false
				},
				annotation: {
					annotations: {
						usedLabel: {
							type: 'doughnutLabel',
							content: '0',
							font: {
								size: 42,
								weight: 'bold'
							},
							color: colors.gaugeText,
							yAdjust: 10,
							position: {
								x: 'center',
								y: '80%'
							}
						},
						totalLabel: {
							type: 'doughnutLabel',
							content: label,
							font: {
								size: 16
							},
							color: colors.gaugeTextMuted,
							yAdjust: 10,
							position: {
								x: 'center',
								y: '0%'
							},
						}
					}
				}
			}
		},
		plugins: [{
			id: 'gradientTrack',
			afterDraw: (chart) => {
				const { ctx } = chart;
				const meta = chart.getDatasetMeta(0);
				if (!meta.data[0]) return;

				// Get the actual arc element's position and size
				const arc = meta.data[0];
				const centerX = arc.x;
				const centerY = arc.y;
				const outerRadius = arc.outerRadius;
				const trackWidth = 8;
				const gap = 6;
				const trackRadius = outerRadius + gap + trackWidth / 2;

				ctx.save();

				// Draw gradient track on the outside edge of the gauge
				const segments = [
					{ start: Math.PI, end: Math.PI * 1.30, color: 'rgb(118, 184, 82)' },   // Green start
					{ start: Math.PI * 1.30, end: Math.PI * 1.60, color: 'rgb(118, 184, 82)' }, // Green
					{ start: Math.PI * 1.60, end: Math.PI * 1.75, color: 'rgb(234, 179, 8)' },  // Yellow
					{ start: Math.PI * 1.75, end: Math.PI * 1.88, color: 'rgb(249, 115, 22)' }, // Orange
					{ start: Math.PI * 1.88, end: Math.PI * 2, color: 'rgb(239, 68, 68)' }     // Red end
				];

				segments.forEach(seg => {
					ctx.beginPath();
					ctx.arc(centerX, centerY, trackRadius, seg.start, seg.end);
					ctx.strokeStyle = seg.color;
					ctx.lineWidth = trackWidth;
					ctx.lineCap = 'butt';
					ctx.stroke();
				});

				ctx.restore();
			}
		}]
	});

	return chart;
}

function updateGauge(chart, value, maxValue, unit = 'GB') {
	// Truncate max for display
	const displayMax = Math.trunc(maxValue);
	if (value > displayMax) {
		value = displayMax;
	}

	// Always use green - the outer gradient track shows the danger zones
	const fillColor = 'rgb(118, 184, 82)';

	chart.data.datasets[0].data = [value, displayMax - value];
	chart.data.datasets[0].backgroundColor[0] = fillColor;
	chart.data.datasets[0].backgroundColor[1] = 'rgba(55, 65, 81, 0.9)';

	if (unit === '%') {
		chart.options.plugins.annotation.annotations.usedLabel.content = `${Math.round(value)} %`;
		chart.options.plugins.annotation.annotations.totalLabel.content = `GPU Utilization`;
	} else {
		chart.options.plugins.annotation.annotations.usedLabel.content = `${value.toFixed(1)} GB`;
		chart.options.plugins.annotation.annotations.totalLabel.content = `${displayMax} GB available`;
	}
	chart.update('none');
}

function initCharts() {
	const colors = getChartColors();

	// Temperature line chart (GPU and System)
	const tempCtx = document.getElementById('temp-chart').getContext('2d');
	const GPU_TEMP_COLOR = 'rgb(249, 115, 22)';      // Orange for GPU temp
	const GPU_TEMP_BG = 'rgba(249, 115, 22, 0.1)';
	const SYS_TEMP_COLOR = 'rgb(139, 92, 246)';      // Purple for System temp
	const SYS_TEMP_BG = 'rgba(139, 92, 246, 0.1)';

	tempChart = new Chart(tempCtx, {
		type: 'line',
		data: {
			labels: [],
			datasets: [{
				label: 'GPU',
				data: [],
				borderColor: GPU_TEMP_COLOR,
				backgroundColor: GPU_TEMP_BG,
				borderWidth: 3,
				tension: 0.4,
			}, {
				label: 'System',
				data: [],
				borderColor: SYS_TEMP_COLOR,
				backgroundColor: SYS_TEMP_BG,
				borderWidth: 3,
				tension: 0.4,
			}]
		},
		options: {
			responsive: true,
			maintainAspectRatio: false,
			scales: {
				y: {
					beginAtZero: true,
					max: 100,
					ticks: {
						color: colors.text,
						font: {
							size: 12
						}
					},
					grid: {
						color: colors.grid
					},
					title: {
						display: false
					}
				},
				x: {
					display: false
				}
			},
			plugins: {
				legend: {
					position: 'bottom',
					labels: {
						color: colors.text,
						font: {
							size: 14,
							weight: 'bold'
						},
						padding: 16,
						boxWidth: 16,
						boxHeight: 16
					}
				}
			}
		}
	});

	memoryGauge = createGauge('memory-gauge', '128 GB available', 128, 'GB');
	gpuGauge = createGauge('gpu-gauge', 'GPU Utilization', 100, '%');

	const memoryCtx = document.getElementById('memory-chart').getContext('2d');
	memoryLineChart = new Chart(memoryCtx, {
		type: 'line',
		data: {
			labels: [],
			datasets: [{
				label: 'Memory',
				data: [],
				borderColor: 'rgb(75, 192, 192)', // Default green color
				backgroundColor: 'rgba(75, 192, 192, 0.1)',
				tension: 0.4,
				segment: {
					borderColor: ctx => {
						// Get the max value from the y-axis scale
						const maxValue = ctx.chart.options.scales.y.max;
						const yellowThreshold = maxValue * 0.6;
						const redThreshold = maxValue * 0.8;

						// Get the value at the end of this segment
						const value = ctx.p1.parsed.y;

						if (value >= redThreshold) {
							return 'rgb(255, 99, 132)'; // Red
						} else if (value >= yellowThreshold) {
							return 'rgb(255, 205, 86)'; // Yellow
						} else {
							return 'rgb(75, 192, 192)'; // Green
						}
					}
				}
			}]
		},
		options: {
			responsive: true,
			maintainAspectRatio: false,
			scales: {
				y: {
					beginAtZero: true,
					max: 128,
					ticks: {
						color: colors.text
					},
					grid: {
						color: colors.grid
					},
					title: {
						display: true,
						text: 'GB',
						color: colors.text
					}
				},
				x: {
					display: false
				}
			},
			plugins: {
				legend: {
					display: false
				}
			}
		}
	});
}

function updateCharts(data) {
	// Convert KB to GB
	const usedGB = data.memory.usedKB / 1000000;
	const totalGB = data.memory.totalKB / 1000000;
	const memoryUsed = parseFloat(usedGB.toFixed(1));

	gpuTempHistory.push(data.gpu?.temperatureC);
	systemTempHistory.push(data.temperature.systemTemperatureC);
	memoryHistory.push(memoryUsed);

	if (gpuTempHistory.length > historySize) {
		gpuTempHistory.shift();
		systemTempHistory.shift();
		memoryHistory.shift();
	}

	// Update GPU power widget.
	document.getElementById('gpu-power-value').textContent =
		data.gpu?.powerW?.toFixed(0) ?? '?';

	// Update temperature line chart.
	tempChart.data.labels = Array.from({ length: gpuTempHistory.length }, (_, i) => i + 1);
	tempChart.data.datasets[0].data = [...gpuTempHistory];
	tempChart.data.datasets[1].data = [...systemTempHistory];
	tempChart.update('none');

	// Update memory gauge.
	updateGauge(memoryGauge, memoryUsed, totalGB, 'GB');

	// Update GPU gauge.
	const gpuUsage = data.gpu?.usagePercent ?? 0;
	updateGauge(gpuGauge, gpuUsage, 100, '%');

	// Update memory line chart.
	memoryLineChart.data.labels = Array.from({ length: memoryHistory.length }, (_, i) => i + 1);
	memoryLineChart.data.datasets[0].data = [...memoryHistory];
	memoryLineChart.update('none');

	// Update browser tab title.
	const maxUsage = Math.max(data.gpu?.usagePercent ?? 0, data.cpu.usagePercent);
	const maxTemp = Math.max(data.gpu?.temperatureC ?? 0, data.temperature.systemTemperatureC);
	document.title = `DGX ${Math.trunc(usedGB).toFixed(0)}GB ${maxUsage.toFixed(0)}% ${maxTemp.toFixed(0)}°`;

}

function updateDocker(data) {
	const dockerSection = document.getElementById('docker-section');
	const tableBody = document.getElementById('docker-table-body');
	const template = document.getElementById('docker-row-template');

	if (!data.docker || data.docker.length === 0) {
		dockerSection.style.display = 'none';
		return;
	}

	dockerSection.style.display = 'block';
	tableBody.innerHTML = '';

	data.docker.forEach(container => {
		const clone = template.content.cloneNode(true);

		clone.querySelector('.image').textContent = container.image;
		clone.querySelector('.name').textContent = container.names;
		clone.querySelector('.ports').textContent = container.ports;
		clone.querySelector('.cpu').textContent = container.cpu;
		clone.querySelector('.memory').textContent = container.memory;
		clone.querySelector('.status').textContent = `${container.status}`;

		const isRunning = container.status.toLowerCase().startsWith('up ');
		const statusClass = isRunning ? 'status-running' : 'status-stopped';
		const statusLabel = isRunning ? 'Running' : 'Stopped';

		const badge = clone.querySelector('.status-badge');
		badge.textContent = statusLabel;
		badge.classList.add(statusClass);

		const isDashboard = container.names.includes('dgx_dashboard') || container.image.includes('dgx_dashboard');

		// Check for pending commands
		let pending = pendingCommands[container.id];
		if (pending) {
			const elapsed = Date.now() - pending.timestamp;
			// If 10s or status changed, clear pending
			if (elapsed >= 10000 || pending.wasRunning !== isRunning) {
				delete pendingCommands[container.id];
				pending = null;
			}
		}

		Object.entries(dockerActions).forEach(([command, action]) => {
			const btn = clone.querySelector(action.selector);

			let shouldShow = action.shouldShow(isRunning, isDashboard);
			let label = action.label;
			let disabled = false;

			if (pending) {
				if (pending.command === command) {
					shouldShow = true;
					label = action.pendingLabel;
					disabled = true;
				} else {
					shouldShow = false;
				}
			}

			btn.style.display = shouldShow ? 'inline-block' : 'none';
			btn.textContent = label;
			btn.disabled = disabled;
			btn.onclick = () => sendDockerCommand(btn, container.id, command, isRunning);
		});

		tableBody.appendChild(clone);
	});
}

function sendDockerCommand(btn, id, command, wasRunning) {
	const action = dockerActions[command];
	if (action.confirm && !confirm(action.confirm)) return;

	if (ws && ws.readyState === WebSocket.OPEN) {
		pendingCommands[id] = { command, timestamp: Date.now(), wasRunning };
		ws.send(JSON.stringify({ command, id }));
		btn.textContent = action.pendingLabel;
		btn.disabled = true;
	}
}

const statusDiv = document.getElementById('status');

function connect() {
	const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
	ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

	ws.onopen = () => {
		statusDiv.textContent = 'Connected';
		statusDiv.style.color = '#4ec9b0';
	};

	ws.onmessage = (event) => {
		const data = JSON.parse(event.data);

		if (!data.gpu) {
			statusDiv.textContent = 'nvidia-smi has crashed too many times, click Restart on the dashboard container';
			statusDiv.style.color = '#f48771';
			console.error('nvidia-smi has crashed, see log output');
		}

		updateCharts(data);
		updateDocker(data);
	};

	ws.onerror = (error) => {
		statusDiv.textContent = 'Error';
		statusDiv.style.color = '#f48771';
		console.error('WebSocket error:', error);
	};

	ws.onclose = () => {
		statusDiv.textContent = 'Disconnected - Reconnecting...';
		statusDiv.style.color = '#ce9178';
		setTimeout(connect, 1000);
	};
}

// Initialize charts when page loads
document.addEventListener('DOMContentLoaded', () => {
	initTheme();
	initCharts();
	connect();
});
