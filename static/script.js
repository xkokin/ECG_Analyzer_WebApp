let globalSignal = [];
let windowSize = 5000; // samples per window (adjustable)
let signalLength = 0;

document.getElementById('upload-form').addEventListener('submit', function (e) {
    e.preventDefault();

    const input = document.getElementById('files');
    const files = input.files;

    if (files.length !== 3) {
        alert("Please select exactly three files (.dat, .hea, .atr) with the same base name.");
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
        if (data.signal && data.peaks && data.predictions) {
            globalSignal = data.signal;
            signalLength = globalSignal.length;

            // Update slider max
            const maxVal = Math.max(0, signalLength - windowSize);
            document.getElementById('signal-slider').max = maxVal;
            document.getElementById('signal-slider').value = 0;

            plotSignal(globalSignal, 0, windowSize);
            plotMinimap(globalSignal);
            populatePredictions(data.predictions);
        } else {
            alert("Invalid response from server");
        }
    })
    .catch(err => {
        console.error(err);
        alert("Error uploading or processing file.");
    });
});

document.getElementById('signal-slider').addEventListener('input', function (e) {
    const start = parseInt(e.target.value);
    plotSignal(globalSignal, start, start + windowSize);
});

function plotSignal(signal, start = 0, end = null) {
    const canvas = document.getElementById('ecg-canvas');
    const ctx = canvas.getContext('2d');
    canvas.height = 300;
    canvas.width = 2000;

    if (end === null || end > signal.length) {
        end = signal.length;
    }

    const visibleSignal = signal.slice(start, end);
    const maxVal = Math.max(...visibleSignal);
    const minVal = Math.min(...visibleSignal);
    const range = maxVal - minVal || 1;
    const step = Math.ceil(visibleSignal.length / canvas.width);

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.beginPath();
    ctx.strokeStyle = '#007bff';

    for (let x = 0; x < canvas.width; x++) {
        const i = x * step;
        if (i >= visibleSignal.length) break;
        const y = canvas.height - ((visibleSignal[i] - minVal) / range) * canvas.height;
        if (x === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    }

    ctx.stroke();
}

function plotMinimap(signal) {
    const canvas = document.getElementById('minimap-canvas');
    const ctx = canvas.getContext('2d');
    const width = canvas.offsetWidth;
    const height = canvas.height;

    canvas.width = width; // for accurate scaling

    const step = Math.ceil(signal.length / width);
    const downsampled = [];

    for (let i = 0; i < signal.length; i += step) {
        downsampled.push(signal[i]);
    }

    const maxVal = Math.max(...downsampled);
    const minVal = Math.min(...downsampled);
    const range = maxVal - minVal || 1;

    ctx.clearRect(0, 0, width, height);
    ctx.beginPath();
    ctx.strokeStyle = '#aaa';

    downsampled.forEach((val, x) => {
        const y = height - ((val - minVal) / range) * height;
        if (x === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    });

    ctx.stroke();
}

function populatePredictions(classes) {
    const list = document.getElementById('analysis-list');
    list.innerHTML = '';

    classes.forEach((cls, index) => {
        const li = document.createElement('li');
        li.textContent = `Peak ${index + 1}: ${cls}`;
        list.appendChild(li);
    });
}
