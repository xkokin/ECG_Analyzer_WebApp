# ECG Classification Web App

This is a web-based application that enables users to upload ECG signal files and receive beat-by-beat classifications using a trained CNN-LSTM model. The backend is built with Python Flask, and the frontend uses HTML and JavaScript for interactivity and visualization.

## Features

- Upload `.dat`, `.hea` and `.atr` ECG files (WFDB format).
- Signal denoising, R-peak detection, and classification using MLII lead.
- Scrollable ECG signal visualization with labeled peaks.
- Summary of predictions for each detected beat.
- Modular architecture for backend model management.

## Project Structure

```
ecg-classification-app/
├── static/
│   └── js/
├── templates/
│   └── index.html
├── models/
│   └── best_ecg_model.h5
├── app.py
├── denoise.py
├── model.py
├── requirements.txt
└── README.md
```
## Setup
### Local Setup Instructions

1. **Clone the repository:**

   ```bash
   git clone https://github.com/xkokin/ECG_Analyzer_WebApp.git
   cd ECG_Analyzer_WebApp
   ```

2. **Create a virtual environment and activate it:**
   (Python 3.11.5)
   ```bash
   python3 -m venv venv
   source venv/bin/activate  # On Windows use `venv\Scripts\activate`
   ```

3. **Install the dependencies:**

   ```bash
   pip install -r requirements.txt
   ```

4. **Start the Flask server:**

   ```bash
   python app.py
   ```

5. **Open your browser** and go to `http://localhost:5000`.

### Setup With Docker

1. **Clone the repository:**

   ```bash
   git clone https://github.com/xkokin/ECG_Analyzer_WebApp.git
   cd ECG_Analyzer_WebApp
   ```

2. **Install Docker Desktop**

3. **Start Docker**

4. **Run Docker Compose**
    ```bash
    docker-compose up
    ```
## File Upload Format

- The web app accepts `.dat`, `.hea` and `.atr` ECG files from the MIT-BIH format.
- Internally, only the MLII lead is used for classification.
- R-peak detection and 256-sample window extraction is applied before classification.

## Quality and Risk Evaluation

### Functional Reliability

- The system has been tested on multiple MIT-BIH records with consistent R-peak detection and classification results.
- Window-based classification centered on R-peaks reduces misalignment errors.

### Known Risks

#### 1. Malicious File Uploads

- **Risk**: Users may upload malicious `.dat` files or files disguised with the wrong extension.
- **Mitigation**: 
  - File validation based on content type and extension.
  - Size and format checks before processing.
  - Temporary storage in a sandboxed directory with cleanup after processing.

#### 2. POST Request Spoofing

- **Risk**: Attackers could simulate malicious POST requests directly to the server.
- **Mitigation**:
  - Use CSRF tokens in forms (to be implemented).
  - Sanitize and validate input before parsing.
  - Rate-limit or throttle suspicious IPs.

#### 3. Model Degradation and Misclassification

- **Risk**: The model may misclassify certain abnormal beats, especially on noisy or unseen patterns.
- **Mitigation**:
  - Periodic retraining with diverse datasets.
  - Manual override option in future versions.

#### 4. Information Leakage

- **Risk**: User-submitted data might be inadvertently logged or retained.
- **Mitigation**:
  - Disable debug logs in production.
  - Ensure temporary files are deleted after use.
  - Use HTTPS and secure cookies.

## Future Improvements

- UI enhancements with zoomable plots and beat inspection.
- Add support for `.csv` ECG formats.
- Implement JWT-based user authentication for session management.
- Dockerized deployment for consistent dev/staging/prod environments.
