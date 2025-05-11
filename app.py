
import os
from flask import Flask, request, render_template, jsonify, send_from_directory
import wfdb
import numpy as np
from werkzeug.utils import secure_filename
from werkzeug.exceptions import RequestEntityTooLarge
from model import load_ecg_model, predict_beats
from denoise import denoise
from scipy.signal import find_peaks
from collections import Counter
from sklearn.metrics import classification_report

import tempfile
import json

app = Flask(__name__)
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['MAX_CONTENT_LENGTH'] = 10 * 1024 * 1024

model = load_ecg_model('models/best_ecg_model.h5')

@app.errorhandler(RequestEntityTooLarge)
def handle_file_too_large(e):
    return jsonify({'error': 'Uploaded file(s) too large. Max allowed size is 10 MB.'}), 413

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/upload', methods=['POST'])
def upload():
    files = request.files.getlist('files')
    
    validation_result, status = validate_uploaded_files(files, require_atr=False)
    if status != 200:
        return jsonify(validation_result), status
    
    rec_name = validation_result['base_name']
    has_atr = validation_result.get('has_atr', False)

    with tempfile.TemporaryDirectory() as tmpdir:
        for file in files:
            file.save(os.path.join(tmpdir, secure_filename(file.filename)))

        try:
            record = wfdb.rdrecord(os.path.join(tmpdir, rec_name))
            annotation = None
            if has_atr: # handle missing annotation file
                try:
                    annotation = wfdb.rdann(os.path.join(tmpdir, rec_name), 'atr')
                except Exception as e:
                    print(f"Warning: Failed to load annotation file: {str(e)}")
                    has_atr = False
        except Exception as e:
            return jsonify({'error': f'Failed to load record: {str(e)}'}), 500

        mlii_channel = None
        for i, sig_name in enumerate(record.sig_name):
            if sig_name.upper() == 'MLII':
                mlii_channel = i
                break

        if mlii_channel is None:
            return jsonify({
                'error': 'MLII lead not found in this recording. Only recordings with MLII lead can be processed.'
            }), 400

        signal = record.p_signal[:, mlii_channel]

        signal = record.p_signal[:, 0]
        denoised = denoise(signal)
        peaks, _ = find_peaks(denoised, distance=150)
        valid_peaks = peaks[(peaks > 128) & (peaks < len(denoised) - 128)]
        segments = np.array([denoised[p - 128:p + 128] for p in valid_peaks])
        segments = segments[..., np.newaxis]
        predictions = np.argmax(predict_beats(model, segments), axis=1)
        predicted_labels = np.vectorize(get_class_of_prediction)(predictions)
        # annotation_labels = match_peaks_to_annotations(valid_peaks, annotation)

        response = {
            'signal': denoised.tolist(),
            'peaks': valid_peaks.tolist(),
            'predictions': predicted_labels.tolist(),
            # 'annotation_locations': np.array(annotation.sample).tolist(),
            'annotations': [],
        }

        if has_atr and annotation is not None:
            annotation_labels = match_peaks_to_annotations(valid_peaks, annotation)
            response['annotations'] = annotation_labels

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


def validate_uploaded_files(files, require_atr=True):
    if not files or all(file.filename == '' for file in files):
        return {'error': 'No files uploaded'}, 400

    required_extensions = {'.dat', '.hea'}
    if require_atr:
        required_extensions.add('.atr')

    valid_extensions = {'.dat', '.hea', '.atr'}
    uploaded_extensions = set()
    base_names = set()

    for file in files:
        filename = secure_filename(file.filename)
        if not filename:
            continue

        parts = filename.rsplit('.', 1) # extract basename and extension
        if len(parts) != 2:
            continue

        base_name, extension = parts
        extension = f'.{extension.lower()}'

        if extension not in valid_extensions:
            return {
                'error': f'Invalid file type: {extension}. Only .dat, .hea, and .atr files are allowed.'
            }, 400

        uploaded_extensions.add(extension)
        base_names.add(base_name)

    missing = required_extensions - uploaded_extensions
    if missing:
        return {
            'error': f'Missing required files: {", ".join(missing)}. Please upload at least .dat and .hea files.'
        }, 400
    # if len(uploaded_extensions) != 3 or any(ext not in uploaded_extensions for ext in valid_extensions):
    #     missing = valid_extensions - uploaded_extensions
    #     return {
    #         'error': f'Missing required files: {", ".join(missing)}. Please upload .dat, .hea, and .atr files.'
    #     }, 400

    if len(base_names) != 1:
        return {'error': 'All files must have the same base name.'}, 400

    return {
        'base_name': list(base_names)[0],
        'has_atr': '.atr' in uploaded_extensions
    }, 200


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
