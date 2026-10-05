/**
 * Real-Time Telemetry Analytics Charts (Chart.js)
 */

class TelemetryCharts {
    constructor() {
        this.tempHumChart = null;
        this.lightChart = null;
        this.initCharts();
    }

    initCharts() {
        const tempHumCtx = document.getElementById('tempHumChart');
        const lightCtx = document.getElementById('lightChart');

        if (tempHumCtx) {
            this.tempHumChart = new Chart(tempHumCtx, {
                type: 'line',
                data: {
                    labels: [],
                    datasets: [
                        {
                            label: 'Temperature (°C)',
                            data: [],
                            borderColor: '#ff5e57',
                            backgroundColor: 'rgba(255, 94, 87, 0.15)',
                            borderWidth: 2,
                            fill: true,
                            tension: 0.35,
                            pointRadius: 1,
                            yAxisID: 'yTemp'
                        },
                        {
                            label: 'Humidity (%)',
                            data: [],
                            borderColor: '#00d2d3',
                            backgroundColor: 'rgba(0, 210, 211, 0.15)',
                            borderWidth: 2,
                            fill: true,
                            tension: 0.35,
                            pointRadius: 1,
                            yAxisID: 'yHum'
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: { duration: 400 },
                    plugins: {
                        legend: { labels: { color: '#a0aec0', font: { size: 11 } } },
                        tooltip: { mode: 'index', intersect: false }
                    },
                    scales: {
                        x: {
                            ticks: { color: '#718096', maxTicksLimit: 7 },
                            grid: { color: 'rgba(255, 255, 255, 0.05)' }
                        },
                        yTemp: {
                            type: 'linear',
                            position: 'left',
                            min: 10,
                            max: 45,
                            ticks: { color: '#ff5e57', stepSize: 5 },
                            grid: { color: 'rgba(255, 255, 255, 0.05)' }
                        },
                        yHum: {
                            type: 'linear',
                            position: 'right',
                            min: 20,
                            max: 100,
                            ticks: { color: '#00d2d3', stepSize: 20 },
                            grid: { drawOnChartArea: false }
                        }
                    }
                }
            });
        }

        if (lightCtx) {
            this.lightChart = new Chart(lightCtx, {
                type: 'line',
                data: {
                    labels: [],
                    datasets: [
                        {
                            label: 'Light Level (LDR)',
                            data: [],
                            borderColor: '#feca57',
                            backgroundColor: 'rgba(254, 202, 87, 0.2)',
                            borderWidth: 2,
                            fill: true,
                            tension: 0.3,
                            pointRadius: 1
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: { duration: 400 },
                    plugins: {
                        legend: { labels: { color: '#a0aec0', font: { size: 11 } } },
                        tooltip: { mode: 'index', intersect: false }
                    },
                    scales: {
                        x: {
                            ticks: { color: '#718096', maxTicksLimit: 7 },
                            grid: { color: 'rgba(255, 255, 255, 0.05)' }
                        },
                        y: {
                            min: 0,
                            max: 1024,
                            ticks: { color: '#feca57', stepSize: 200 },
                            grid: { color: 'rgba(255, 255, 255, 0.05)' }
                        }
                    }
                }
            });
        }
    }

    updateData(history) {
        if (!history || !Array.isArray(history)) return;

        const labels = history.map(h => h.time);
        const temps = history.map(h => h.temperature);
        const hums = history.map(h => h.humidity);
        const lights = history.map(h => h.light_value);

        if (this.tempHumChart) {
            this.tempHumChart.data.labels = labels;
            this.tempHumChart.data.datasets[0].data = temps;
            this.tempHumChart.data.datasets[1].data = hums;
            this.tempHumChart.update();
        }

        if (this.lightChart) {
            this.lightChart.data.labels = labels;
            this.lightChart.data.datasets[0].data = lights;
            this.lightChart.update();
        }
    }
}

window.TelemetryCharts = TelemetryCharts;
