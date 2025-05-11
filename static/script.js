let globalSignal = [];
let globalPeaks = [];
let globalAnnotations = [];
let globalPredictions = [];
let windowSize = 3000; // samples per window
let signalLength = 0;
let currentPosition = 0;
let isDragging = false;
let dragStartX = 0;
let dragStartPos = 0;
const classColors = {
    'N': 'green',
    'S': 'blue',
    'V': 'orange',
    'F': 'purple',
    'Q': 'pink'
};

window.addEventListener('DOMContentLoaded', function() {
    resizeCanvases();

    globalSignal = generateDemoSignal();
    signalLength = globalSignal.length;

    plotSignal(globalSignal, 0, windowSize, globalPeaks);
    plotMinimap(globalSignal);
    updateViewportIndicator(0);
});

window.addEventListener('resize', resizeCanvases);

function resizeCanvases() {
    const mainCanvas = document.getElementById('ecg-canvas');
    const minimapCanvas = document.getElementById('minimap-canvas');
    const mainWrapper = document.getElementById('canvas-wrapper');
    const minimapWrapper = document.getElementById('minimap-wrapper');
    
    mainCanvas.width = mainWrapper.clientWidth - 30;
    mainCanvas.height = 300;
    
    minimapCanvas.width = minimapWrapper.clientWidth;
    minimapCanvas.height = minimapWrapper.clientHeight;
    
    // if we have data, redraw
    if (globalSignal.length > 0) {
        plotSignal(globalSignal, currentPosition, currentPosition + windowSize, globalPeaks);
        plotMinimap(globalSignal);
        updateViewportIndicator(currentPosition);
    }
}

document.getElementById('upload-form').addEventListener('submit', function (e) {
    e.preventDefault();

    const input = document.getElementById('files');
    const files = input.files;

    if (![2, 3].includes(files.length)) {
        alert("Please select at least 2 files (.dat, .hea) with the same base name. Consider providing .atr file with true annotations.");
        return;
    }

    const baseNames = [...files].map(f => f.name.split('.').slice(0, -1).join('.'));
    const uniqueBaseNames = new Set(baseNames);
    if (uniqueBaseNames.size !== 1) {
        alert("All files must have the same base name (e.g., 100.dat, 100.hea, 100.atr)");
        return;
    }

    const formData = new FormData();
    for (let file of files) {
        formData.append("files", file);
    }

    fetch('/upload', {
        method: 'POST',
        body: formData
    })
    .then(res => res.json())
    .then(data => {
        if (data.error) {
            alert(data.error)
            return
        }
        globalSignal = data.signal;
        signalLength = globalSignal.length;
        globalPeaks = data.peaks;
        globalAnnotations = data.annotations;
        globalPredictions = data.predictions;

        currentPosition = 0;

        plotSignal(globalSignal, 0, windowSize, globalPeaks);
        plotMinimap(globalSignal);
        updateViewportIndicator(0);
        populatePredictions(data.predictions);

        if (data.summary) {
            const summary = data.summary;
            let tableHTML = '<table border="1" cellpadding="8" style="border-collapse: collapse; width: 100%; text-align: center;">';
            tableHTML += '<tr><th>Class</th><th>Precision</th><th>Recall</th><th>F1-score</th><th>Support</th></tr>';

            for (const cls in summary) {
                const row = summary[cls];
                tableHTML += `<tr>
                    <td>${cls}</td>
                    <td>${row.precision}</td>
                    <td>${row.recall}</td>
                    <td>${row['f1-score']}</td>
                    <td>${row.support}</td>
                </tr>`;
            }

            tableHTML += '</table>';
            document.getElementById('summary-table').innerHTML = tableHTML;
        } else {
            document.getElementById('summary-table').innerHTML = '<p>No summary available.</p>';
        }

    }).catch(err => {
        console.error(err);
        alert("Error uploading or processing file.");
    });
});

function plotSignal(signal, start = 0, end = null, peaks = []) {
    const canvas = document.getElementById('ecg-canvas');
    const ctx = canvas.getContext('2d');
    
    if (!signal.length) return;
    
    if (end === null || end > signal.length) {
        end = Math.min(start + windowSize, signal.length);
    }

    const visibleSignal = signal.slice(start, end);
    const maxVal = Math.max(...visibleSignal) + 0.2;
    const minVal = Math.min(...visibleSignal) - 0.2;
    const range = maxVal - minVal || 1;
    
    // Calculate scaling factors
    const xScale = canvas.width / (end - start);
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    drawGrid(ctx, canvas.width, canvas.height);

    ctx.beginPath();
    ctx.strokeStyle = '#007bff';
    ctx.lineWidth = 2;

    for (let i = 0; i < visibleSignal.length; i++) {
        const x = i * xScale;
        const y = canvas.height - ((visibleSignal[i] - minVal) / range) * (canvas.height * 0.8) - (canvas.height * 0.1);
        
        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    }
    ctx.stroke();

    for (let i = 0; i < peaks.length; i++) {
        const peak = peaks[i];
        const x = (peak - start) * xScale;
        const y = canvas.height - ((signal[peak] - minVal) / range) * (canvas.height * 0.8) - (canvas.height * 0.1);

        const predClass = globalPredictions[i];
        const trueClass = globalAnnotations[i];

        ctx.fillStyle = classColors[trueClass] || 'gray';
        ctx.fillRect(x - 10, y - 30, 10, 10);

        ctx.beginPath();
        ctx.fillStyle = classColors[predClass] || 'gray';
        ctx.arc(x + 15, y - 25, 6, 0, Math.PI * 2);
        ctx.fill();
    }

}

function drawGrid(ctx, width, height) {
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 0.5;

    const yStep = height / 10;
    for (let y = 0; y <= height; y += yStep) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
    }

    const xStep = width / 20;
    for (let x = 0; x <= width; x += xStep) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
    }
}

function plotMinimap(signal, peaks = []) {
    const canvas = document.getElementById('minimap-canvas');
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    
    if (!signal.length) return;

    const step = Math.max(1, Math.ceil(signal.length / width));
    const downsampled = [];

    for (let i = 0; i < signal.length; i += step) {
        downsampled.push(signal[i]);
    }

    const maxVal = Math.max(...downsampled) + 0.2;
    const minVal = Math.min(...downsampled) - 0.2;
    const range = maxVal - minVal || 1;

    ctx.clearRect(0, 0, width, height);

    ctx.beginPath();
    ctx.strokeStyle = '#aaaaaa';
    ctx.lineWidth = 1;

    for (let i = 0; i < downsampled.length; i++) {
        const x = (i / downsampled.length) * width;
        const y = height - ((downsampled[i] - minVal) / range) * (height * 0.8) - (height * 0.1);
        
        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    }
    ctx.stroke();

    ctx.fillStyle = 'red';
    for (let peak of peaks) {
        const x = (peak / signal.length) * width;
        const peakValue = signal[peak];
        const y = height - ((peakValue - minVal) / range) * (height * 0.8) - (height * 0.1);
        
        ctx.beginPath();
        ctx.arc(x, y, 2, 0, Math.PI * 2);
        ctx.fill();
    }
}

function updateViewportIndicator(position) {
    const indicator = document.getElementById('viewport-indicator');
    const minimapWrapper = document.getElementById('minimap-wrapper');
    const wrapperWidth = minimapWrapper.clientWidth;

    const viewportWidth = (windowSize / signalLength) * wrapperWidth;
    const viewportLeft = (position / signalLength) * wrapperWidth;

    indicator.style.width = `${viewportWidth}px`;
    indicator.style.left = `${viewportLeft}px`;
}

function populatePredictions(classes) {
    const list = document.getElementById('analysis-list');
    if (!list) {
        return;
    }
    list.innerHTML = '';

    classes.forEach((cls, index) => {
        const li = document.createElement('li');
        li.textContent = `Peak ${index + 1}: ${cls}`;
        list.appendChild(li);
    });
}

const viewportIndicator = document.getElementById('viewport-indicator');
const minimapCanvas = document.getElementById('minimap-canvas');

viewportIndicator.addEventListener('mousedown', function(e) {
    isDragging = true;
    dragStartX = e.clientX;
    dragStartPos = currentPosition;
    viewportIndicator.style.cursor = 'grabbing';
    e.preventDefault();
});

document.addEventListener('mousemove', function(e) {
    if (!isDragging) return;
    
    const deltaX = e.clientX - dragStartX;
    const minimapWidth = document.getElementById('minimap-wrapper').clientWidth;
    const pixelsPerSample = minimapWidth / signalLength;
    
    let newPosition = dragStartPos + (deltaX / pixelsPerSample);
    newPosition = Math.max(0, Math.min(signalLength - windowSize, newPosition));
    
    currentPosition = Math.round(newPosition);
    
    plotSignal(globalSignal, currentPosition, currentPosition + windowSize, globalPeaks);
    updateViewportIndicator(currentPosition);
});

document.addEventListener('mouseup', function() {
    if (isDragging) {
        isDragging = false;
        viewportIndicator.style.cursor = 'move';
    }
});

minimapCanvas.addEventListener('click', function(e) {
    if (isDragging) return; // do not jump if dragging
    
    const rect = minimapCanvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const minimapWidth = minimapCanvas.width;
    
    const clickPosition = (clickX / minimapWidth) * signalLength;
    currentPosition = Math.max(0, Math.min(signalLength - windowSize, Math.round(clickPosition - (windowSize / 2))));

    plotSignal(globalSignal, currentPosition, currentPosition + windowSize, globalPeaks);
    updateViewportIndicator(currentPosition);
});