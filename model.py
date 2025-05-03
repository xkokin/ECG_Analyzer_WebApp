
import tensorflow as tf
from tensorflow.keras.models import load_model


def load_ecg_model(model_path):
    return load_model(model_path, compile=False)


def predict_beats(model, beats):
    return model.predict(beats)
