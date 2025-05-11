
import os
from flask import Flask, request, render_template, jsonify, send_from_directory
import wfdb
import numpy as np
from werkzeug.utils import secure_filename
from model import load_ecg_model, predict_beats
from denoise import denoise
from scipy.signal import find_peaks
from collections import Counter
from sklearn.metrics import classification_report

import tempfile
import json

app = Flask(__name__)
app.config['UPLOAD_FOLDER'] = 'uploads'

model = load_ecg_model('models/best_ecg_model.h5')

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/upload', methods=['POST'])
def upload():
    files = request.files.getlist('files')
    if len(files) != 3:
        return jsonify({'error': 'Please upload exactly 3 files (.dat, .hea, .atr) with the same base name.'}), 400

    with tempfile.TemporaryDirectory() as tmpdir:
        base_names = []
        for file in files:
            filename = secure_filename(file.filename)
            base_name = filename.split('.')[0]
            base_names.append(base_name)
            file.save(os.path.join(tmpdir, filename))

        if len(set(base_names)) != 1:
            return jsonify({'error': 'All files must have the same base name.'}), 400

        rec_name = base_names[0]
        try:
            record = wfdb.rdrecord(os.path.join(tmpdir, rec_name))
            annotation = wfdb.rdann(os.path.join(tmpdir, rec_name), 'atr')
        except Exception as e:
            return jsonify({'error': f'Failed to load record: {str(e)}'}), 500

        signal = record.p_signal[:, 0]
        denoised = denoise(signal)
        peaks, _ = find_peaks(denoised, distance=150)
        valid_peaks = peaks[(peaks > 128) & (peaks < len(denoised) - 128)]
        segments = np.array([denoised[p - 128:p + 128] for p in valid_peaks])
        segments = segments[..., np.newaxis]
        predictions = np.argmax(predict_beats(model, segments), axis=1)
        predicted_labels = np.vectorize(get_class_of_prediction)(predictions)
        annotation_labels = match_peaks_to_annotations(valid_peaks, annotation)

        response = {
            'signal': denoised.tolist(),
            'peaks': valid_peaks.tolist(),
            'predictions': predicted_labels.tolist(),
            'annotation_locations': np.array(annotation.sample).tolist(),
            'annotations': annotation_labels,
        }

        y_true = [label for label in annotation_labels if label is not None]
        y_pred = [p for p, t in zip(predicted_labels, annotation_labels) if t is not None]

        # Generate class-wise summary
        summary = classification_report(y_true, y_pred, output_dict=True, zero_division=0)

        response['summary'] = {
            k: {
                'precision': round(v['precision'], 2),
                'recall': round(v['recall'], 2),
                'f1-score': round(v['f1-score'], 2),
                'support': int(v['support'])
            } for k, v in summary.items() if k in ['N', 'S', 'V', 'F', 'Q']
        }

        return jsonify(response)


def get_class_of_symbol(symbol):
    aami_map = {
        'N': 'N', 'L': 'N', 'R': 'N', 'e': 'N', 'j': 'N',
        'A': 'S', 'a': 'S', 'J': 'S', 'S': 'S',
        'V': 'V', 'E': 'V',
        'F': 'F',
        '/': 'Q', 'f': 'Q', 'Q': 'Q', 'P': 'Q', '|': 'Q', '~': 'Q'
    }
    if symbol in aami_map:
        return aami_map[symbol]
    else:
        print(">> symbol not in map", symbol)
        return None


def get_class_of_prediction(prediction_index):
    aami_classes = ['N', 'S', 'V', 'F', 'Q']
    return aami_classes[prediction_index]


def match_peaks_to_annotations(peaks, annotation, max_distance=128):
    ann_samples = np.array(annotation.sample)
    ann_symbols = np.array(annotation.symbol)

    matched_labels = []
    for peak in peaks:
        idx = np.argmin(np.abs(ann_samples - peak)) # finds the closest annotation
        distance = abs(ann_samples[idx] - peak)

        if distance <= max_distance:
            matched_labels.append(get_class_of_symbol(ann_symbols[idx]))
        else:
            matched_labels.append(None)

    return matched_labels


if __name__ == '__main__':
    app.run(host="0.0.0.0", port=5000, debug=True)
