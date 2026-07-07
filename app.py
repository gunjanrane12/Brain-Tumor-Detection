import os
import io
import base64
import random
import threading
import time
import urllib.request
import logging
import numpy as np
import cv2
from flask import Flask, request, jsonify, render_template, send_file
from PIL import Image

# ─── Logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ─── App Setup ────────────────────────────────────────────────────────────────
app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16 MB

# ─── Model Loading ────────────────────────────────────────────────────────────
MODEL_PATH = os.environ.get('MODEL_PATH', 'brain_tumor_cnn_model.h5')
model = None

CLASS_LABELS = {
    0: 'glioma',
    1: 'meningioma',
    2: 'no_tumor',
    3: 'pituitary'
}

CLASS_INFO = {
    'glioma': {
        'display': 'Glioma Tumor',
        'severity': 'high',
        'color': '#ef4444',
        'icon': '🔴',
        'description': 'Gliomas arise from glial cells in the brain or spine. They are the most common type of primary brain tumor.',
        'recommendation': 'Immediate consultation with a neuro-oncologist is strongly recommended. Further imaging and biopsy may be required.'
    },
    'meningioma': {
        'display': 'Meningioma Tumor',
        'severity': 'medium',
        'color': '#f97316',
        'icon': '🟠',
        'description': 'Meningiomas develop in the meninges (the membranes surrounding the brain and spinal cord). Most are benign.',
        'recommendation': 'Schedule an appointment with a neurologist. Regular monitoring through MRI scans is advised.'
    },
    'no_tumor': {
        'display': 'No Tumor Detected',
        'severity': 'none',
        'color': '#22c55e',
        'icon': '🟢',
        'description': 'No abnormal tumor growth detected in the provided MRI scan. The scan appears normal.',
        'recommendation': 'Continue regular health check-ups. Consult your doctor if you experience any neurological symptoms.'
    },
    'pituitary': {
        'display': 'Pituitary Tumor',
        'severity': 'medium',
        'color': '#a855f7',
        'icon': '🟣',
        'description': 'Pituitary tumors form in the pituitary gland. Most are non-cancerous and can affect hormone production.',
        'recommendation': 'Consult an endocrinologist and neurosurgeon. Hormone level testing and further imaging are recommended.'
    }
}


def load_model():
    global model
    try:
        import tensorflow as tf
        if os.path.exists(MODEL_PATH):
            model = tf.keras.models.load_model(MODEL_PATH)
            logger.info(f"✅ Model loaded from {MODEL_PATH}")
        else:
            logger.warning(f"⚠️  Model file not found at {MODEL_PATH}. Running in demo mode.")
    except Exception as e:
        logger.error(f"❌ Failed to load model: {e}")


def preprocess_image(image_bytes):
    """Convert raw image bytes to the model's expected input format."""
    nparr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Could not decode image")
    img = cv2.resize(img, (128, 128))
    img = img.astype('float32') / 255.0
    img = np.expand_dims(img, axis=0)
    return img


def predict(image_bytes):
    """Run inference and return class label + confidence scores."""
    img = preprocess_image(image_bytes)

    if model is not None:
        preds = model.predict(img, verbose=0)[0]
    else:
        # Demo mode: return mock predictions
        logger.info("Demo mode: returning mock prediction")
        preds = np.array([0.05, 0.05, 0.85, 0.05])

    predicted_idx = int(np.argmax(preds))
    predicted_label = CLASS_LABELS[predicted_idx]
    confidence = float(preds[predicted_idx]) * 100

    all_scores = {
        CLASS_LABELS[i]: round(float(preds[i]) * 100, 2)
        for i in range(len(preds))
    }

    return predicted_label, confidence, all_scores


# ─── Self-Ping (keep-alive for Render free tier) ──────────────────────────────
RENDER_URL = os.environ.get('RENDER_EXTERNAL_URL', '')
PING_INTERVAL = 10 * 60  # 10 minutes


def self_ping():
    """Ping own health endpoint every 10 minutes to prevent Render from sleeping."""
    while True:
        time.sleep(PING_INTERVAL)
        target = RENDER_URL.rstrip('/') + '/health' if RENDER_URL else 'http://localhost:10000/health'
        try:
            with urllib.request.urlopen(target, timeout=10) as resp:
                logger.info(f"🏓 Self-ping OK → {target} [{resp.status}]")
        except Exception as e:
            logger.warning(f"🏓 Self-ping failed → {target}: {e}")


def start_ping_thread():
    t = threading.Thread(target=self_ping, daemon=True, name="self-ping")
    t.start()
    logger.info("🔁 Self-ping thread started (interval: 10 min)")


# ─── Dataset helpers ─────────────────────────────────────────────────────────
DATASET_DIR = os.environ.get('DATASET_DIR', 'dataset')
ALLOWED_IMG_EXTS = {'.jpg', '.jpeg', '.png', '.bmp', '.tiff', '.tif', '.webp'}


def get_dataset_index():
    """Scan dataset/<label>/ folders and return {label: [file_paths]}."""
    index = {}
    if not os.path.isdir(DATASET_DIR):
        return index
    for label in os.listdir(DATASET_DIR):
        label_dir = os.path.join(DATASET_DIR, label)
        if not os.path.isdir(label_dir):
            continue
        files = [
            os.path.join(label_dir, f)
            for f in os.listdir(label_dir)
            if os.path.splitext(f)[1].lower() in ALLOWED_IMG_EXTS
        ]
        if files:
            index[label] = files
    return index


# ─── Routes ───────────────────────────────────────────────────────────────────
@app.route('/')
def index():
    return render_template('index.html')


@app.route('/health')
def health():
    return jsonify({
        'status': 'ok',
        'model_loaded': model is not None,
        'timestamp': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    })


@app.route('/predict', methods=['POST'])
def predict_route():
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400

    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400

    allowed = {'png', 'jpg', 'jpeg', 'gif', 'bmp', 'tiff', 'webp'}
    ext = file.filename.rsplit('.', 1)[-1].lower() if '.' in file.filename else ''
    if ext not in allowed:
        return jsonify({'error': f'Unsupported file type: .{ext}'}), 400

    try:
        image_bytes = file.read()
        label, confidence, all_scores = predict(image_bytes)
        info = CLASS_INFO[label]

        return jsonify({
            'success': True,
            'prediction': label,
            'display_name': info['display'],
            'confidence': round(confidence, 2),
            'severity': info['severity'],
            'color': info['color'],
            'icon': info['icon'],
            'description': info['description'],
            'recommendation': info['recommendation'],
            'all_scores': all_scores
        })
    except Exception as e:
        logger.error(f"Prediction error: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/dataset-info')
def dataset_info():
    """Return available labels and counts from the dataset folder."""
    index = get_dataset_index()
    return jsonify({
        'available': {label: len(files) for label, files in index.items()},
        'total': sum(len(f) for f in index.values()),
        'dataset_dir': DATASET_DIR
    })


@app.route('/random-sample')
def random_sample():
    """Pick a random image from dataset/<label>/ and return it as base64 JSON."""
    label_filter = request.args.get('label', '').strip().lower()
    index = get_dataset_index()

    if not index:
        return jsonify({'error': f'No images found in "{DATASET_DIR}/" folder. '
                                 'Create subfolders named after each class and paste images inside.'}), 404

    # Filter by requested label if provided
    if label_filter:
        if label_filter not in index:
            return jsonify({'error': f'No images found for label "{label_filter}"'}), 404
        chosen_label = label_filter
    else:
        chosen_label = random.choice(list(index.keys()))

    chosen_file = random.choice(index[chosen_label])
    filename = os.path.basename(chosen_file)

    try:
        with open(chosen_file, 'rb') as f:
            raw = f.read()

        # Determine mime type
        ext = os.path.splitext(filename)[1].lower().lstrip('.')
        mime_map = {'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png',
                    'bmp': 'image/bmp', 'tiff': 'image/tiff', 'tif': 'image/tiff',
                    'webp': 'image/webp'}
        mime = mime_map.get(ext, 'image/jpeg')
        b64 = base64.b64encode(raw).decode('utf-8')

        logger.info(f"🎲 Random sample: {chosen_label}/{filename}")
        return jsonify({
            'success': True,
            'true_label': chosen_label,
            'display_label': chosen_label.replace('_', ' ').title(),
            'filename': filename,
            'mime': mime,
            'image_b64': b64
        })
    except Exception as e:
        logger.error(f"Random sample error: {e}")
        return jsonify({'error': str(e)}), 500


# ─── Entry Point ──────────────────────────────────────────────────────────────
if __name__ == '__main__':
    load_model()
    start_ping_thread()
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)
else:
    # Gunicorn / Render production entry point
    load_model()
    start_ping_thread()
