
import os
from flask import Flask, request, render_template, jsonify, send_from_directory
import wfdb
import numpy as np
from werkzeug.utils import secure_filename
from model import load_ecg_model, predict_beats
from denoise import denoise
from scipy.signal import find_peaks
from collections import Counter

import json

app = Flask(__name__)
app.config['UPLOAD_FOLDER'] = 'uploads'

model = load_ecg_model('models/final_cnn_lstm_model.h5')

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/upload', methods=['POST'])
def upload():
    files = request.files.getlist('files')
    if len(files) != 3:
        return jsonify({'error': 'Please upload exactly 3 files (.dat, .hea, .atr) with the same base name.'}), 400

    # Save files and extract base names
    base_names = []
    for file in files:
        filename = secure_filename(file.filename)
        base_name = filename.split('.')[0]
        base_names.append(base_name)
        save_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(save_path)

    # Ensure all files have the same base name
    if len(set(base_names)) != 1:
        return jsonify({'error': 'All files must have the same base name (e.g., 100.dat, 100.hea, 100.atr).'}), 400

    rec_name = base_names[0]

    # Load WFDB record
    try:
        record = wfdb.rdrecord(f'uploads/{rec_name}')
        annotation = wfdb.rdann(f'uploads/{rec_name}', 'atr')
    except Exception as e:
        return jsonify({'error': f'Failed to load record: {str(e)}'}), 500

    # Process signal
    signal = record.p_signal[:, 0]
    denoised = denoise(signal)
    peaks, _ = find_peaks(denoised, distance=150)
    valid_peaks = peaks[(peaks > 128) & (peaks < len(denoised) - 128)]
    segments = np.array([denoised[p - 128:p + 128] for p in valid_peaks])
    segments = segments[..., np.newaxis]
    predictions = predict_beats(model, segments)

    # Build response
    response = {
        'signal': denoised.tolist(),
        'peaks': valid_peaks.tolist(),
        'predictions': predictions.tolist()
    }
    return jsonify(response)


if __name__ == '__main__':
    app.run(debug=True)
