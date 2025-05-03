
import numpy as np
import pywt

def denoise(data):
    coeffs = pywt.wavedec(data=data, wavelet='db5', level=9)
    cA9, *details = coeffs
    threshold = (np.median(np.abs(details[-1])) / 0.6745) * (np.sqrt(2 * np.log(len(details[-1]))))
    details[-1][:] = 0
    details[-2][:] = 0
    for i in range(len(details) - 2):
        details[i] = pywt.threshold(details[i], threshold)
    coeffs = [cA9] + details
    return pywt.waverec(coeffs, 'db5')
