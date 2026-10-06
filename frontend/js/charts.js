/**
 * AgriTwin Pro - Telemetry Analytics & Biophysical Trend Charts (Chart.js)
 */

class TelemetryCharts {
    constructor() {
        this.tempHumChart = null;
        this.lightVpdChart = null;
        this.currentTimeframe = "1h";
        this.initCharts();
    }

    initCharts() {
        const tempHumCtx = document.getElementById('tempHumChart');
        const lightVpdCtx = document.getElementById('lightChart');

        if (tempHumCtx) {
            const existing = Chart.getChart(tempHumCtx);
            if (existing) existing.destroy();

            this.tempHumChart = new Chart(tempHumCtx, {
                type: 'line',
                data: {
                    labels: [],
                    datasets: [
                        {
                            label: 'Temperature (°C)',
                            data: [],
                            borderColor: '#ef4444',
                            backgroundColor: 'rgba(239, 68, 68, 0.12)',
                            borderWidth: 2,
                            fill: true,
                            tension: 0.35,
                            pointRadius: 1,
                            yAxisID: 'yTemp'
                        },
                        {
                            label: 'Humidity (%)',
                            data: [],
                            borderColor: '#06b6d4',
                            backgroundColor: 'rgba(6, 182, 212, 0.12)',
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
                    animation: { duration: 300 },
                    plugins: {
                        legend: { labels: { color: '#94a3b8', font: { size: 11 } } },
                        tooltip: { mode: 'index', intersect: false }
                    },
                    scales: {
                        x: {
                            ticks: { color: '#64748b', maxTicksLimit: 8 },
                            grid: { color: 'rgba(255, 255, 255, 0.04)' }
                        },
                        yTemp: {
                            type: 'linear',
                            position: 'left',
                            suggestedMin: 15,
                            suggestedMax: 38,
                            ticks: { color: '#ef4444', stepSize: 5 },
                            grid: { color: 'rgba(255, 255, 255, 0.04)' }
                        },
                        yHum: {
                            type: 'linear',
                            position: 'right',
                            min: 15,
                            max: 100,
                            ticks: { color: '#06b6d4', stepSize: 20 },
                            grid: { drawOnChartArea: false }
                        }
                    }
                }
            });
        }

        if (lightVpdCtx) {
            const existing = Chart.getChart(lightVpdCtx);
            if (existing) existing.destroy();

            this.lightVpdChart = new Chart(lightVpdCtx, {
                type: 'line',
                data: {
                    labels: [],
                    datasets: [
                        {
                            label: 'Solar / LDR Value',
                            data: [],
                            borderColor: '#f59e0b',
                            backgroundColor: 'rgba(245, 158, 11, 0.15)',
                            borderWidth: 2,
                            fill: true,
                            tension: 0.3,
                            pointRadius: 1,
                            yAxisID: 'yLight'
                        },
                        {
                            label: 'VPD (kPa) Transpiration',
                            data: [],
                            borderColor: '#10b981',
                            backgroundColor: 'rgba(16, 185, 129, 0.1)',
                            borderWidth: 2,
                            fill: false,
                            tension: 0.3,
                            pointRadius: 1,
                            yAxisID: 'yVpd'
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: { duration: 300 },
                    plugins: {
                        legend: { labels: { color: '#94a3b8', font: { size: 11 } } },
                        tooltip: { mode: 'index', intersect: false }
                    },
                    scales: {
                        x: {
                            ticks: { color: '#64748b', maxTicksLimit: 8 },
                            grid: { color: 'rgba(255, 255, 255, 0.04)' }
                        },
                        yLight: {
                            type: 'linear',
                            position: 'left',
                            min: 0,
                            max: 1024,
                            ticks: { color: '#f59e0b', stepSize: 200 },
                            grid: { color: 'rgba(255, 255, 255, 0.04)' }
                        },
                        yVpd: {
                            type: 'linear',
                            position: 'right',
                            suggestedMin: 0.0,
                            suggestedMax: 2.5,
                            ticks: { color: '#10b981', stepSize: 0.5 },
                            grid: { drawOnChartArea: false }
                        }
                    }
                }
            });
        }
    }

    updateData(history) {
        if (!history || !Array.isArray(history) || history.length === 0) return;

        const labels = history.map(h => h.time);
        const temps = history.map(h => h.temperature);
        const hums = history.map(h => h.humidity);
        const lights = history.map(h => h.light_value);
        const vpds = history.map(h => h.vpd || 1.0);

        if (this.tempHumChart) {
            this.tempHumChart.data.labels = labels;
            this.tempHumChart.data.datasets[0].data = temps;
            this.tempHumChart.data.datasets[1].data = hums;
            this.tempHumChart.update('none'); // Update without full redraw animation churn
        }

        if (this.lightVpdChart) {
            this.lightVpdChart.data.labels = labels;
            this.lightVpdChart.data.datasets[0].data = lights;
            this.lightVpdChart.data.datasets[1].data = vpds;
            this.lightVpdChart.update('none');
        }
    }
}

window.TelemetryCharts = TelemetryCharts;
